/**
 * 语音识别模块 - 基于 sherpa-onnx-node
 * 使用 streaming recognizer 实现实时中文语音识别
 * 录音通过 Electron 渲染进程的 Web Audio API 采集，音频数据通过 IPC 传入
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

let recognizer = null;
let stream = null;
let finalRecognizer = null;
let isRunning = false;
let engineMode = 'paraformer';
let finalEngineMode = '';
let qwen3FinalModel = '';
let qwen3Language = 'auto';
// Each stopped meeting owns its own final-transcription worker. Do not let a
// newer recording replace the process handle of an older meeting.
const activeQwen3Processes = new Map();
let finalSpeakerDiarization = true;
let audioChunks = [];
let lastConfigKey = '';

const MODELS_DIR = path.join(__dirname, '..', 'models');
const PARAFORMER_MODEL_SUBDIR = 'sherpa-onnx-streaming-paraformer-bilingual-zh-en';
const PARAFORMER_MODEL_FILE_SIZES = Object.freeze({
  'encoder.int8.onnx': 165462184,
  'decoder.int8.onnx': 71664561,
  'tokens.txt': 75756
});
const SENSEVOICE_INT8_MODEL_SUBDIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17-int8';
const QWEN3_ASR_DEFAULT_MODEL = 'Qwen/Qwen3-ASR-1.7B';
const QWEN3_ASR_WORKER = path.join(__dirname, '..', 'scripts', 'qwen3_asr_worker.py');
const QWEN3_ASR_PROJECT_PYTHON = path.join(__dirname, '..', '.venv-qwen3-asr', 'bin', 'python');

const ASR_MODEL_PRESETS = {
  'sensevoice-int8': {
    id: 'sensevoice-int8',
    engine: 'sensevoice',
    mode: 'offline',
    label: 'SenseVoice Small int8',
    modelDir: path.join(MODELS_DIR, SENSEVOICE_INT8_MODEL_SUBDIR),
    modelFile: 'model.int8.onnx',
    tokensFile: 'tokens.txt',
    requiresVocabSizeMetadata: true
  },
  'paraformer-streaming': {
    id: 'paraformer-streaming',
    engine: 'paraformer',
    mode: 'streaming',
    label: 'Paraformer bilingual streaming',
    modelDir: path.join(MODELS_DIR, PARAFORMER_MODEL_SUBDIR)
  },
  'paraformer-qwen3-final': {
    id: 'paraformer-qwen3-final',
    engine: 'hybrid',
    mode: 'streaming-final',
    label: 'Paraformer streaming + Qwen3-ASR final',
    modelDir: path.join(MODELS_DIR, PARAFORMER_MODEL_SUBDIR),
    finalEngine: 'qwen3-asr-python',
    finalModel: QWEN3_ASR_DEFAULT_MODEL
  },
  'qwen3-asr-python': {
    id: 'qwen3-asr-python',
    engine: 'qwen3-asr-python',
    mode: 'offline',
    label: 'Qwen3-ASR Python',
    modelDir: QWEN3_ASR_DEFAULT_MODEL
  },
  'sensevoice-custom': {
    id: 'sensevoice-custom',
    engine: 'sensevoice',
    mode: 'offline',
    label: 'Custom SenseVoice compatible export',
    modelDir: '',
    modelFile: 'model.onnx',
    tokensFile: 'tokens.json',
    requiresVocabSizeMetadata: true
  }
};

const DEFAULT_ASR_MODEL_PRESET = 'paraformer-qwen3-final';

/**
 * 检查模型文件是否存在
 */
function checkFiles(modelDir, files, hint) {
  for (const file of files) {
    const fullPath = path.join(modelDir, file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`${hint}: ${file}\n请确认模型目录下有完整的模型文件`);
    }
  }
}

function checkFileSizes(modelDir, expectedFileSizes, hint) {
  for (const [file, expectedSize] of Object.entries(expectedFileSizes || {})) {
    const fullPath = path.join(modelDir, file);
    const actualSize = fs.statSync(fullPath).size;
    if (actualSize !== expectedSize) {
      throw new Error(
        `${hint}: ${file} 文件不完整或版本不匹配` +
        `（当前 ${actualSize} 字节，预期 ${expectedSize} 字节）\n` +
        '请从原始模型压缩包重新解压该文件'
      );
    }
  }
}

function fileContainsAscii(filePath, needle) {
  const fd = fs.openSync(filePath, 'r');
  const needleBuffer = Buffer.from(needle, 'utf8');
  const chunkSize = 1024 * 1024;
  const buffer = Buffer.alloc(chunkSize + needleBuffer.length - 1);
  let carryLength = 0;

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, carryLength, chunkSize, null);
      if (bytesRead === 0) return false;

      const searchLength = carryLength + bytesRead;
      if (buffer.subarray(0, searchLength).includes(needleBuffer)) return true;

      carryLength = Math.min(needleBuffer.length - 1, searchLength);
      buffer.copy(buffer, 0, searchLength - carryLength, searchLength);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 将语言设置归一化为 worker 的 --language 值。
 * 'auto' / 空 -> 'none'（worker 端再映射为 None，自动语种识别）；
 * 其它取值（Chinese / English / Chinese,English）原样透传。
 *
 * 优先级：显式传入的 language option > 环境变量 QWEN3_ASR_LANGUAGE > 默认 'auto'。
 * GUI/设置页总是显式传语言值（设置项优先于环境变量，环境变量不会与 GUI 设置对抗）；
 * 环境变量只在直接调用本模块且不传 language 时生效（如脚本/API 调用方）。
 */
function normalizeQwen3Language(value) {
  const raw = value == null ? 'auto' : String(value).trim();
  if (!raw || /^(auto|none|null)$/i.test(raw)) return 'none';
  return raw;
}

function resolvePreset(options = {}) {
  const legacyEngine = options.engine || options.modelType;
  const presetId = options.modelPreset || (legacyEngine === 'hybrid' ? 'paraformer-qwen3-final' : legacyEngine === 'paraformer' ? 'paraformer-streaming' : legacyEngine === 'sensevoice' ? 'sensevoice-custom' : legacyEngine === 'qwen3-asr-python' ? 'qwen3-asr-python' : DEFAULT_ASR_MODEL_PRESET);
  const preset = ASR_MODEL_PRESETS[presetId] || ASR_MODEL_PRESETS[DEFAULT_ASR_MODEL_PRESET];
  const qwen3ModelPath = options.qwen3ModelPath || options.finalModelPath;

  return {
    ...preset,
    modelDir: options.modelPath || preset.modelDir,
    finalModel: qwen3ModelPath || preset.finalModel || preset.finalModelDir,
    speakerDiarization: options.speakerDiarization !== false,
    qwen3Language: options.qwen3Language || 'auto'
  };
}

function buildParaformerConfig(modelDir) {
  return {
    featConfig: {
      sampleRate: 16000,
      featureDim: 80
    },
    modelConfig: {
      paraformer: {
        encoder: path.join(modelDir, 'encoder.int8.onnx'),
        decoder: path.join(modelDir, 'decoder.int8.onnx'),
      },
      tokens: path.join(modelDir, 'tokens.txt'),
      numThreads: 4,
      provider: 'cpu',
      debug: false
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: true,
    rule1MinTrailingSilence: 1.2,
    rule2MinTrailingSilence: 0.8,
    rule3MinUtteranceLength: 14
  };
}

function buildASRConfig(options = {}) {
  const preset = resolvePreset(options);

  if (preset.engine === 'hybrid') {
    return {
      engine: 'hybrid',
      mode: preset.mode,
      modelPreset: preset.id,
      modelDir: preset.modelDir,
      finalEngine: preset.finalEngine,
      finalModel: preset.finalModel,
      speakerDiarization: preset.speakerDiarization,
      qwen3Language: preset.qwen3Language,
      requiredFiles: ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt'],
      expectedFileSizes: PARAFORMER_MODEL_FILE_SIZES,
      sampleRate: 16000,
      recognizerConfig: buildParaformerConfig(preset.modelDir)
    };
  }

  if (preset.engine === 'qwen3-asr-python') {
    return {
      engine: 'qwen3-asr-python',
      mode: preset.mode,
      modelPreset: preset.id,
      modelDir: preset.modelDir,
      finalModel: preset.finalModel || preset.modelDir,
      speakerDiarization: preset.speakerDiarization,
      qwen3Language: preset.qwen3Language,
      sampleRate: 16000
    };
  }

  if (preset.engine === 'sensevoice') {
    const modelDir = preset.modelDir;
    const modelFile = preset.modelFile || 'model.onnx';
    const tokensFile = preset.tokensFile || 'tokens.txt';

    return {
      engine: 'sensevoice',
      mode: preset.mode,
      modelPreset: preset.id,
      modelDir,
      requiredFiles: [modelFile, tokensFile],
      requiresVocabSizeMetadata: Boolean(preset.requiresVocabSizeMetadata),
      sampleRate: 16000,
      recognizerConfig: {
        featConfig: {
          sampleRate: 16000,
          featureDim: 80
        },
        modelConfig: {
          senseVoice: {
            model: path.join(modelDir, modelFile),
            language: options.language || 'zh',
            useInverseTextNormalization: 1
          },
          tokens: path.join(modelDir, tokensFile),
          numThreads: 2,
          provider: 'cpu',
          debug: false
        }
      }
    };
  }

  const modelDir = preset.modelDir;
  return {
    engine: 'paraformer',
    mode: preset.mode,
    modelPreset: preset.id,
    modelDir,
    requiredFiles: ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt'],
    expectedFileSizes: PARAFORMER_MODEL_FILE_SIZES,
    sampleRate: 16000,
    recognizerConfig: buildParaformerConfig(modelDir)
  };
}

function checkModels(asrConfig) {
  if (asrConfig.engine === 'hybrid') {
    checkFiles(asrConfig.modelDir, asrConfig.requiredFiles, `实时字幕模型文件未找到，请确认 models/${PARAFORMER_MODEL_SUBDIR}/ 目录`);
    checkFileSizes(asrConfig.modelDir, asrConfig.expectedFileSizes, '实时字幕模型校验失败');
    checkFiles(path.dirname(QWEN3_ASR_WORKER), [path.basename(QWEN3_ASR_WORKER)], 'Qwen3-ASR worker 文件未找到');
    return;
  }

  if (asrConfig.engine === 'qwen3-asr-python') {
    checkFiles(path.dirname(QWEN3_ASR_WORKER), [path.basename(QWEN3_ASR_WORKER)], 'Qwen3-ASR worker 文件未找到');
    return;
  }

  if (asrConfig.engine === 'sensevoice') {
    checkFiles(asrConfig.modelDir, asrConfig.requiredFiles, 'SenseVoice 模型文件未找到');
    const modelPath = asrConfig.recognizerConfig.modelConfig.senseVoice.model;
    if (asrConfig.requiresVocabSizeMetadata && !fileContainsAscii(modelPath, 'vocab_size')) {
      throw new Error(
        'SenseVoice 模型无法被 sherpa-onnx-node 直接加载：model.onnx 缺少 vocab_size 元数据。' +
        '请下载 sherpa-onnx 兼容导出的 SenseVoice int8 模型，或在设置中切换到 Paraformer。'
      );
    }
    return;
  }

  checkFiles(asrConfig.modelDir, asrConfig.requiredFiles, `模型文件未找到，请确认 models/${PARAFORMER_MODEL_SUBDIR}/ 目录`);
  checkFileSizes(asrConfig.modelDir, asrConfig.expectedFileSizes, 'Paraformer 模型校验失败');
}

function concatSamples(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

function writeWav16kMono(samples, filePath) {
  const sampleRate = 16000;
  const dataBytes = samples.length * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);

  const pcm = Buffer.alloc(dataBytes);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }

  fs.writeFileSync(filePath, Buffer.concat([header, pcm]));
}

function getQwen3PythonCommand() {
  if (process.env.QWEN3_ASR_PYTHON) return process.env.QWEN3_ASR_PYTHON;
  if (fs.existsSync(QWEN3_ASR_PROJECT_PYTHON)) return QWEN3_ASR_PROJECT_PYTHON;
  return process.env.PYTHON || 'python3';
}

function transcribeWithQwen3Python(samples, model, { speakerDiarization = false, onProgress, jobId = require('crypto').randomUUID(), language } = {}) {
  return new Promise((resolve, reject) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-qwen3-'));
    const wavPath = path.join(tempDir, 'audio.wav');
    writeWav16kMono(samples, wavPath);

    const python = getQwen3PythonCommand();
    // 优先级：显式 language option > 环境变量 QWEN3_ASR_LANGUAGE > 'auto'；GUI/设置页总是传其设置值，env 仅对省略 language 的直接调用方生效
    const languageArg = normalizeQwen3Language(language ?? process.env.QWEN3_ASR_LANGUAGE ?? 'auto');
    const args = [
      QWEN3_ASR_WORKER,
      '--model', model || QWEN3_ASR_DEFAULT_MODEL,
      '--audio', wavPath,
      '--language', languageArg
    ];
    if (speakerDiarization) args.push('--speaker-diarization');
    args.push('--chunk-seconds', process.env.QWEN3_ASR_CHUNK_SECONDS || '45');

    const allowNetwork = process.env.QWEN3_ASR_ALLOW_NETWORK === '1';
    const child = spawn(python, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HF_HUB_OFFLINE: allowNetwork ? (process.env.HF_HUB_OFFLINE || '0') : '1',
        TRANSFORMERS_OFFLINE: allowNetwork ? (process.env.TRANSFORMERS_OFFLINE || '0') : '1'
      }
    });
    activeQwen3Processes.set(jobId, child);
    const reportProgress = (payload) => {
      if (typeof onProgress === 'function') onProgress(payload);
    };
    reportProgress({ stage: 'loading-model', processedSeconds: 0, totalSeconds: samples.length / 16000 });

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let settled = false;
    const estimatedDurationMs = (samples.length / 16000) * 1500;
    const defaultTimeoutMs = Math.max(10 * 60 * 1000, estimatedDurationMs + 5 * 60 * 1000);
    const timeoutMs = Number(process.env.QWEN3_ASR_TIMEOUT_MS || defaultTimeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      fs.rmSync(tempDir, { recursive: true, force: true });
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (activeQwen3Processes.get(jobId) === child) activeQwen3Processes.delete(jobId);
      cleanup();
      fn(value);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      settle(reject, new Error(`Qwen3-ASR 最终转写超时：${Math.round(timeoutMs / 1000)} 秒`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        try {
          const payload = JSON.parse(line);
          if (payload.progress) reportProgress(payload);
        } catch (_) {
          // Keep non-JSON worker logs for the final error message.
        }
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });

    child.on('error', error => {
      settle(reject, error);
    });

    child.on('exit', code => {
      if (code !== 0) {
        settle(reject, new Error(stderr.trim() || `Qwen3-ASR worker exited with code ${code}`));
        return;
      }

      try {
        const jsonLine = stdout.trim().split('\n').reverse().find(line => line.trim().startsWith('{')) || '';
        const result = JSON.parse(jsonLine);
        settle(resolve, result);
      } catch (error) {
        settle(reject, new Error(`Qwen3-ASR worker 输出无法解析: ${stdout.trim() || error.message}`));
      }
    });
  });
}

function cancelQwen3Transcription(jobId) {
  const child = activeQwen3Processes.get(jobId);
  if (!child) return false;
  child.kill('SIGTERM');
  return true;
}

/**
 * 初始化 ASR 引擎
 */
async function initASR(options = {}) {
  const asrConfig = buildASRConfig(options);
  const configKey = JSON.stringify({
    engine: asrConfig.engine,
    modelDir: asrConfig.modelDir,
    finalEngine: asrConfig.finalEngine,
    finalModel: asrConfig.finalModel,
    speakerDiarization: asrConfig.speakerDiarization
  });

  if (recognizer && lastConfigKey === configKey) {
    stream = asrConfig.engine === 'paraformer' || asrConfig.engine === 'hybrid' ? recognizer.createStream() : null;
    engineMode = asrConfig.engine;
    finalEngineMode = asrConfig.finalEngine || '';
    qwen3FinalModel = asrConfig.finalModel || '';
    finalSpeakerDiarization = asrConfig.speakerDiarization !== false;
    qwen3Language = asrConfig.qwen3Language || 'auto';
    audioChunks = [];
    isRunning = true;
    console.log(`[ASR] 重用已有 ${engineMode} 引擎`);
    return { engine: engineMode, finalEngine: finalEngineMode, mode: asrConfig.mode, modelPreset: asrConfig.modelPreset };
  }

  checkModels(asrConfig);

  const sherpa = require('sherpa-onnx-node');

  try {
    if (asrConfig.engine === 'sensevoice') {
      recognizer = sherpa.OfflineRecognizer.createAsync
        ? await sherpa.OfflineRecognizer.createAsync(asrConfig.recognizerConfig)
        : new sherpa.OfflineRecognizer(asrConfig.recognizerConfig);
      stream = null;
      finalRecognizer = null;
    } else if (asrConfig.engine === 'hybrid') {
      recognizer = new sherpa.OnlineRecognizer(asrConfig.recognizerConfig);
      stream = recognizer.createStream();
      finalRecognizer = null;
    } else if (asrConfig.engine === 'qwen3-asr-python') {
      recognizer = null;
      stream = null;
      finalRecognizer = null;
    } else {
      recognizer = new sherpa.OnlineRecognizer(asrConfig.recognizerConfig);
      stream = recognizer.createStream();
      finalRecognizer = null;
    }
  } catch (error) {
    if (asrConfig.engine === 'sensevoice' && /vocab_size/.test(error.message)) {
      throw new Error(
        'SenseVoice 模型无法被 sherpa-onnx-node 直接加载：model.onnx 缺少 vocab_size 元数据。' +
        '请使用 sherpa-onnx 兼容导出的 SenseVoice 模型，或在设置中切换到 Paraformer。'
      );
    }
    throw error;
  }

  engineMode = asrConfig.engine;
  finalEngineMode = asrConfig.finalEngine || '';
  qwen3FinalModel = asrConfig.finalModel || '';
  finalSpeakerDiarization = asrConfig.speakerDiarization !== false;
  qwen3Language = asrConfig.qwen3Language || 'auto';
  audioChunks = [];
  lastConfigKey = configKey;
  isRunning = true;

  console.log(`[ASR] ${engineMode} 识别引擎初始化完成`);
  return { engine: engineMode, finalEngine: finalEngineMode, mode: asrConfig.mode, modelPreset: asrConfig.modelPreset };
}

/**
 * 接收渲染进程发来的音频数据进行识别
 * @param {Float32Array} samples - 16kHz 单声道音频采样
 * @returns {{ text: string, isFinal: boolean } | null}
 */
function feedAudio(samples) {
  if (!isRunning) return null;
  const startedAt = Date.now();
  audioChunks.push(new Float32Array(samples));

  if (engineMode === 'sensevoice' || engineMode === 'qwen3-asr-python') {
    return null;
  }

  if (!stream) return null;

  // sherpa-onnx-node API: acceptWaveform({ samples, sampleRate })
  stream.acceptWaveform({ samples, sampleRate: 16000 });

  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
  }

  const result = recognizer.getResult(stream);
  const text = (result.text || '').trim();
  const isEndpoint = recognizer.isEndpoint(stream);

  if (isEndpoint && text) {
    recognizer.reset(stream);
    return { text, isFinal: true, asrMs: Date.now() - startedAt, mode: engineMode };
  } else if (text) {
    return { text, isFinal: false, asrMs: Date.now() - startedAt, mode: engineMode };
  }

  return null;
}

/**
 * 停止识别
 * @returns {string} 最后的未确认文本
 */
async function stopRecognition({ onFinalResult } = {}) {
  isRunning = false;

  // Preserve the captured PCM for local post-meeting analysis before ASR clears it.
  let recordingPath = '';
  if (audioChunks.length > 0) {
    const recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-recording-'));
    recordingPath = path.join(recordingDir, 'meeting.wav');
    writeWav16kMono(concatSamples(audioChunks), recordingPath);
  }

  let finalText = '';
  if ((engineMode === 'qwen3-asr-python' || finalEngineMode === 'qwen3-asr-python') && audioChunks.length > 0) {
    const samples = concatSamples(audioChunks);
    audioChunks = [];
    transcribeWithQwen3Python(samples, qwen3FinalModel, {
      speakerDiarization: Boolean(finalSpeakerDiarization),
      language: qwen3Language
    })
      .then(result => {
        const text = typeof result === 'string' ? result : (result.text || '').trim();
        console.log('[ASR] 停止录制，Qwen3-ASR 最终转写完成');
        if (onFinalResult) onFinalResult({
          finalText: text,
          finalTextSource: 'qwen3-asr',
          recordingPath,
          speakerSegments: result?.speaker_segments || [],
          speakerCount: result?.speaker_count || 0,
          speakerError: result?.speaker_error || ''
        });
      })
      .catch(error => {
        console.error('[ASR] Qwen3-ASR 最终转写失败，保留实时转写:', error.message);
        if (onFinalResult) {
          onFinalResult({
            finalText: '',
            finalTextSource: 'realtime',
            finalTextError: `Qwen3-ASR 最终转写失败：${error.message}`
          });
        }
      });

    return { finalText: '', finalTextSource: 'pending', finalTextPending: true, recordingPath };
  }

  const offlineRecognizer = finalRecognizer || (engineMode === 'sensevoice' ? recognizer : null);
  if (offlineRecognizer && audioChunks.length > 0) {
    const offlineStream = offlineRecognizer.createStream();
    offlineStream.acceptWaveform({ samples: concatSamples(audioChunks), sampleRate: 16000 });
    offlineRecognizer.decode(offlineStream);
    const result = offlineRecognizer.getResult(offlineStream);
    finalText = (result.text || '').trim();
    audioChunks = [];
    console.log(`[ASR] 停止录制，${finalEngineMode || engineMode} 最终转写完成`);
    return { finalText, finalTextSource: finalEngineMode || engineMode, recordingPath };
  }

  if (stream && recognizer) {
    stream.inputFinished();
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }
    const result = recognizer.getResult(stream);
    finalText = (result.text || '').trim();
    stream = null;
  }

  audioChunks = [];
  console.log('[ASR] 停止录制');
  return { finalText, finalTextSource: engineMode, recordingPath };
}

async function transcribeAudioFile(filePath, model, { speakerDiarization = true, onProgress, jobId, language } = {}) {
  const { readWav16kMono } = require('./audio-analysis');
  const samples = readWav16kMono(filePath);
  return transcribeWithQwen3Python(samples, model || QWEN3_ASR_DEFAULT_MODEL, { speakerDiarization, onProgress, jobId, language });
}

module.exports = { initASR, feedAudio, stopRecognition, transcribeAudioFile, cancelQwen3Transcription, buildASRConfig, normalizeQwen3Language, ASR_MODEL_PRESETS, QWEN3_ASR_DEFAULT_MODEL, QWEN3_ASR_WORKER };
