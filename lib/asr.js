/**
 * 语音识别模块 - 基于 sherpa-onnx-node
 * 使用 streaming recognizer 实现实时中文语音识别
 * 录音通过 Electron 渲染进程的 Web Audio API 采集，音频数据通过 IPC 传入
 */

const path = require('path');
const fs = require('fs');

let recognizer = null;
let stream = null;
let isRunning = false;
let engineMode = 'paraformer';
let audioChunks = [];
let lastConfigKey = '';

const MODELS_DIR = path.join(__dirname, '..', 'models');
const PARAFORMER_MODEL_SUBDIR = 'sherpa-onnx-streaming-paraformer-bilingual-zh-en';
const SENSEVOICE_INT8_MODEL_SUBDIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17-int8';

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

const DEFAULT_ASR_MODEL_PRESET = 'sensevoice-int8';

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

function resolvePreset(options = {}) {
  const legacyEngine = options.engine || options.modelType;
  const presetId = options.modelPreset || (legacyEngine === 'paraformer' ? 'paraformer-streaming' : legacyEngine === 'sensevoice' ? 'sensevoice-custom' : DEFAULT_ASR_MODEL_PRESET);
  const preset = ASR_MODEL_PRESETS[presetId] || ASR_MODEL_PRESETS[DEFAULT_ASR_MODEL_PRESET];

  return {
    ...preset,
    modelDir: options.modelPath || preset.modelDir
  };
}

function buildASRConfig(options = {}) {
  const preset = resolvePreset(options);

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
    sampleRate: 16000,
    recognizerConfig: {
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
        numThreads: 2,
        provider: 'cpu',
        debug: false
      },
      decodingMethod: 'greedy_search',
      maxActivePaths: 4,
      enableEndpoint: true,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 20
    }
  };
}

function checkModels(asrConfig) {
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

/**
 * 初始化 ASR 引擎
 */
async function initASR(options = {}) {
  const asrConfig = buildASRConfig(options);
  const configKey = JSON.stringify({ engine: asrConfig.engine, modelDir: asrConfig.modelDir });

  if (recognizer && lastConfigKey === configKey) {
    stream = asrConfig.engine === 'paraformer' ? recognizer.createStream() : null;
    engineMode = asrConfig.engine;
    audioChunks = [];
    isRunning = true;
    console.log(`[ASR] 重用已有 ${engineMode} 引擎`);
    return;
  }

  checkModels(asrConfig);

  const sherpa = require('sherpa-onnx-node');

  try {
    if (asrConfig.engine === 'sensevoice') {
      recognizer = sherpa.OfflineRecognizer.createAsync
        ? await sherpa.OfflineRecognizer.createAsync(asrConfig.recognizerConfig)
        : new sherpa.OfflineRecognizer(asrConfig.recognizerConfig);
      stream = null;
    } else {
      recognizer = new sherpa.OnlineRecognizer(asrConfig.recognizerConfig);
      stream = recognizer.createStream();
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
  audioChunks = [];
  lastConfigKey = configKey;
  isRunning = true;

  console.log(`[ASR] ${engineMode} 识别引擎初始化完成`);
}

/**
 * 接收渲染进程发来的音频数据进行识别
 * @param {Float32Array} samples - 16kHz 单声道音频采样
 * @returns {{ text: string, isFinal: boolean } | null}
 */
function feedAudio(samples) {
  if (!isRunning || !recognizer) return null;

  if (engineMode === 'sensevoice') {
    audioChunks.push(new Float32Array(samples));
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
    return { text, isFinal: true };
  } else if (text) {
    return { text, isFinal: false };
  }

  return null;
}

/**
 * 停止识别
 * @returns {string} 最后的未确认文本
 */
function stopRecognition() {
  isRunning = false;

  let finalText = '';
  if (engineMode === 'sensevoice' && recognizer && audioChunks.length > 0) {
    const offlineStream = recognizer.createStream();
    offlineStream.acceptWaveform({ samples: concatSamples(audioChunks), sampleRate: 16000 });
    recognizer.decode(offlineStream);
    const result = recognizer.getResult(offlineStream);
    finalText = (result.text || '').trim();
    audioChunks = [];
    console.log('[ASR] 停止录制，SenseVoice 转写完成');
    return finalText;
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

  console.log('[ASR] 停止录制');
  return finalText;
}

module.exports = { initASR, feedAudio, stopRecognition, buildASRConfig, ASR_MODEL_PRESETS };
