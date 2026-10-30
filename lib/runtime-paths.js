const path = require('node:path');
let context;

function createRuntimePaths({ packaged = false, userData, resources = '', project = path.join(__dirname, '..') }) {
  const root = path.join(userData || project, 'resources', 'v1');
  return {
    packaged, root,
    models: packaged ? path.join(root, 'models') : path.join(project, 'models'),
    python: kind => packaged ? path.join(root, 'envs', kind, 'bin', 'python3') : path.join(project, kind === 'emotion' ? '.venv-emotion' : '.venv-qwen3-asr', 'bin', 'python'),
    worker: filename => path.join(packaged ? path.join(resources, 'workers') : path.join(project, 'scripts'), filename),
    helper: packaged ? path.join(resources, 'bin', 'system-audio-probe') : path.join(project, 'native', 'system-audio-helper', '.build', 'debug', 'system-audio-probe'),
    ffmpeg: packaged ? path.join(root, 'envs', 'audio', 'bin', 'ffmpeg') : 'ffmpeg'
  };
}

function configureRuntime(app) {
  context = { packaged: app.isPackaged, userData: app.getPath('userData'), resources: process.resourcesPath };
}
function getRuntimePaths() { return createRuntimePaths(context || {}); }
module.exports = { createRuntimePaths, configureRuntime, getRuntimePaths };
