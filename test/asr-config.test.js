const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { buildASRConfig } = require('../lib/asr');

test('buildASRConfig uses the hybrid Paraformer + Qwen3-ASR preset by default', () => {
  const config = buildASRConfig({});

  assert.equal(config.engine, 'hybrid');
  assert.equal(config.modelPreset, 'paraformer-qwen3-final');
  assert.equal(config.finalEngine, 'qwen3-asr-python');
  assert.equal(config.finalModel, 'Qwen/Qwen3-ASR-1.7B');
  assert.equal(config.sampleRate, 16000);
  assert.equal(config.recognizerConfig.modelConfig.paraformer.encoder.endsWith('encoder.int8.onnx'), true);
});

test('buildASRConfig keeps the existing streaming paraformer as a selectable preset', () => {
  const config = buildASRConfig({ modelPreset: 'paraformer-streaming' });

  assert.equal(config.engine, 'paraformer');
  assert.equal(config.modelPreset, 'paraformer-streaming');
  assert.equal(config.recognizerConfig.modelConfig.paraformer.encoder.endsWith('encoder.int8.onnx'), true);
  assert.equal(config.recognizerConfig.modelConfig.paraformer.decoder.endsWith('decoder.int8.onnx'), true);
  assert.equal(config.recognizerConfig.modelConfig.numThreads, 4);
  assert.equal(config.recognizerConfig.enableEndpoint, true);
  assert.equal(config.recognizerConfig.rule1MinTrailingSilence, 1.2);
  assert.equal(config.recognizerConfig.rule2MinTrailingSilence, 0.8);
  assert.equal(config.recognizerConfig.rule3MinUtteranceLength, 14);
});

test('buildASRConfig supports hybrid Paraformer realtime plus Qwen3-ASR final transcription', () => {
  const config = buildASRConfig({ modelPreset: 'paraformer-qwen3-final' });

  assert.equal(config.engine, 'hybrid');
  assert.equal(config.mode, 'streaming-final');
  assert.equal(config.finalEngine, 'qwen3-asr-python');
  assert.equal(config.finalModel, 'Qwen/Qwen3-ASR-1.7B');
  assert.equal(config.recognizerConfig.modelConfig.paraformer.encoder.endsWith('encoder.int8.onnx'), true);
});

test('buildASRConfig supports Qwen3-ASR as an offline final transcription preset', () => {
  const config = buildASRConfig({ modelPreset: 'qwen3-asr-python', qwen3ModelPath: '/models/qwen3-asr' });

  assert.equal(config.engine, 'qwen3-asr-python');
  assert.equal(config.mode, 'offline');
  assert.equal(config.finalModel, '/models/qwen3-asr');
});

test('buildASRConfig supports a custom SenseVoice directory for compatible exports', () => {
  const modelDir = '/tmp/custom-sensevoice';
  const config = buildASRConfig({ modelPreset: 'sensevoice-custom', modelPath: modelDir });

  assert.equal(config.engine, 'sensevoice');
  assert.equal(config.modelPreset, 'sensevoice-custom');
  assert.equal(config.recognizerConfig.modelConfig.senseVoice.model, path.join(modelDir, 'model.onnx'));
  assert.equal(config.recognizerConfig.modelConfig.tokens, path.join(modelDir, 'tokens.json'));
});

test('buildASRConfig defaults Qwen3-ASR language to auto recognition', () => {
  const config = buildASRConfig({ modelPreset: 'paraformer-qwen3-final' });
  assert.equal(config.qwen3Language, 'auto');
});

test('buildASRConfig passes an explicit Qwen3-ASR language through', () => {
  const config = buildASRConfig({ modelPreset: 'qwen3-asr-python', qwen3Language: 'Chinese' });
  assert.equal(config.qwen3Language, 'Chinese');
});

test('normalizeQwen3Language maps auto and blank values to the none sentinel', () => {
  const { normalizeQwen3Language } = require('../lib/asr');
  assert.equal(normalizeQwen3Language('auto'), 'none');
  assert.equal(normalizeQwen3Language(undefined), 'none');
  assert.equal(normalizeQwen3Language(''), 'none');
  assert.equal(normalizeQwen3Language('Chinese'), 'Chinese');
  assert.equal(normalizeQwen3Language('Chinese,English'), 'Chinese,English');
});
