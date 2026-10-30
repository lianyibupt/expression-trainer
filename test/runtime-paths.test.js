const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRuntimePaths } = require('../lib/runtime-paths');

test('installed app uses user resources and external workers without relying on the source tree', () => {
  const paths = createRuntimePaths({ packaged: true, userData: '/user/app', resources: '/App/Contents/Resources', project: '/source' });
  assert.equal(paths.models, '/user/app/resources/v1/models');
  assert.equal(paths.python('asr'), '/user/app/resources/v1/envs/asr/bin/python3');
  assert.equal(paths.worker('qwen3_asr_worker.py'), '/App/Contents/Resources/workers/qwen3_asr_worker.py');
  assert.equal(paths.helper, '/App/Contents/Resources/bin/system-audio-probe');
  assert.equal(paths.ffmpeg, '/user/app/resources/v1/envs/audio/bin/ffmpeg');
});

test('source runs keep existing models, environments and workers', () => {
  const paths = createRuntimePaths({ packaged: false, project: '/source', userData: '/user/app', resources: '/electron' });
  assert.equal(paths.models, '/source/models');
  assert.equal(paths.python('emotion'), '/source/.venv-emotion/bin/python');
  assert.equal(paths.worker('emotion_worker.py'), path.join('/source', 'scripts', 'emotion_worker.py'));
});
