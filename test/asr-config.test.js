const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { buildASRConfig } = require('../lib/asr');

test('buildASRConfig uses the sherpa-onnx SenseVoice int8 preset by default', () => {
  const config = buildASRConfig({});

  assert.equal(config.engine, 'sensevoice');
  assert.equal(config.modelPreset, 'sensevoice-int8');
  assert.equal(config.sampleRate, 16000);
  assert.equal(config.recognizerConfig.modelConfig.senseVoice.model.endsWith('model.int8.onnx'), true);
  assert.equal(config.recognizerConfig.modelConfig.tokens.endsWith('tokens.txt'), true);
  assert.equal(config.recognizerConfig.modelConfig.senseVoice.language, 'zh');
  assert.equal(config.recognizerConfig.modelConfig.senseVoice.useInverseTextNormalization, 1);
});

test('buildASRConfig keeps the existing streaming paraformer as a selectable preset', () => {
  const config = buildASRConfig({ modelPreset: 'paraformer-streaming' });

  assert.equal(config.engine, 'paraformer');
  assert.equal(config.modelPreset, 'paraformer-streaming');
  assert.equal(config.recognizerConfig.modelConfig.paraformer.encoder.endsWith('encoder.int8.onnx'), true);
  assert.equal(config.recognizerConfig.modelConfig.paraformer.decoder.endsWith('decoder.int8.onnx'), true);
  assert.equal(config.recognizerConfig.enableEndpoint, true);
});

test('buildASRConfig supports a custom SenseVoice directory for compatible exports', () => {
  const modelDir = '/tmp/custom-sensevoice';
  const config = buildASRConfig({ modelPreset: 'sensevoice-custom', modelPath: modelDir });

  assert.equal(config.engine, 'sensevoice');
  assert.equal(config.modelPreset, 'sensevoice-custom');
  assert.equal(config.recognizerConfig.modelConfig.senseVoice.model, path.join(modelDir, 'model.onnx'));
  assert.equal(config.recognizerConfig.modelConfig.tokens, path.join(modelDir, 'tokens.json'));
});
