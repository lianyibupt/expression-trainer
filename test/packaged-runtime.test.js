const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('packaged ASR resolves downloaded models even with an unrelated system Python variable', () => {
  const root = path.join(__dirname, '..');
  const script = `
    const {configureRuntime}=require('./lib/runtime-paths');
    configureRuntime({isPackaged:true,getPath:()=>'/isolated-user'});
    const {buildASRConfig}=require('./lib/asr');
    console.log(JSON.stringify(buildASRConfig({})));
  `;
  const config = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: root, env: { ...process.env, PYTHON: '/does-not-exist' }, encoding: 'utf8' }));
  assert.equal(config.modelDir, '/isolated-user/resources/v1/models/sherpa-onnx-streaming-paraformer-bilingual-zh-en');
  assert.equal(config.finalModel, '/isolated-user/resources/v1/models/qwen3-asr');
});

test('packaged openSMILE cannot silently use a Homebrew environment', () => {
  const script = `
    require('./lib/runtime-paths').configureRuntime({isPackaged:true,getPath:()=>'/isolated-user'});
    console.log(require('./lib/opensmile').resolvePython());
  `;
  const result = execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), env: { ...process.env, OPENSMILE_PYTHON: '/opt/homebrew/python' }, encoding: 'utf8' }).trim();
  assert.equal(result, '/isolated-user/resources/v1/envs/asr/bin/python3');
});
