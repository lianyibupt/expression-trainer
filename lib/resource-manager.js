const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { downloadFile, safeResourcePath, fileMatches } = require('./resource-download');
const REQUIREMENTS = require('./runtime-requirements.json');

const PYTHON = {
  url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20261026/cpython-3.13.18%2B20261026-aarch64-apple-darwin-install_only_stripped.tar.gz',
  size: 25265774, sha256: '8392b6ea51d94391befb2c31ebe75463f045d0b69dfcf5e1bb3234e1f5fa3405'
};
const ENVIRONMENTS = [
  { id: 'audio', label: '音频导入环境', kind: 'environment', description: '导入 MP3、M4A 等音频所需的转换工具。', requirements: REQUIREMENTS.audio, probe: "import imageio_ffmpeg, shutil, sys; shutil.copy2(imageio_ffmpeg.get_ffmpeg_exe(), sys.argv[1])", sizeHint: '依赖约数十 MB' },
  { id: 'asr', label: '最终转写与音频分析环境', kind: 'environment', description: 'Qwen3 转写、说话人分离和 openSMILE 声学分析。', requirements: REQUIREMENTS.asr, probe: 'import qwen_asr, torch, sklearn, opensmile; opensmile.Smile(feature_set=opensmile.FeatureSet.eGeMAPSv02, feature_level=opensmile.FeatureLevel.Functionals)', sizeHint: '依赖约 1–2 GB；以下载结果为准' },
  { id: 'emotion', label: '实时语气分析环境', kind: 'environment', description: '实时语气模型所需的独立运行环境。', requirements: REQUIREMENTS.emotion, probe: 'import torch, torchaudio, funasr, numpy', sizeHint: '依赖约 1–2 GB；以下载结果为准' }
];
const MODEL_DEPENDENCIES = { qwen: ['asr'], 'emotion-model': ['emotion'] };
function defaultCatalog() {
  const models = require('./resource-catalog.json').map(item => ({ ...item, dependencies: MODEL_DEPENDENCIES[item.id] || [] }));
  const byId = new Map([...ENVIRONMENTS, ...models].map(item => [item.id, item]));
  return ['paraformer', 'audio', 'asr', 'qwen', 'emotion', 'emotion-model', 'sensevoice'].map(id => byId.get(id));
}

class ResourceManager extends EventEmitter {
  constructor({ root, catalog = defaultCatalog(), download = downloadFile, fetchImpl, workers }) {
    super(); this.root = root; this.catalog = catalog; this.download = options => download({ ...options, fetchImpl }); this.workers = workers;
    this.states = new Map(); this.active = null;
  }
  marker(item) { return safeResourcePath(this.root, `installed/${item.id}.json`); }
  fingerprint(item) { return crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex'); }
  ready(item) {
    try {
      const mark = JSON.parse(fs.readFileSync(this.marker(item), 'utf8'));
      if (mark.fingerprint !== this.fingerprint(item)) return false;
      if (item.kind === 'environment') return fs.existsSync(path.join(this.root, 'envs', item.id, 'bin', 'python3')) && (item.id !== 'audio' || fs.existsSync(path.join(this.root, 'envs', 'audio', 'bin', 'ffmpeg')));
      return item.files.every(file => fs.statSync(safeResourcePath(this.root, `${item.directory}/${file.path}`)).size === file.size);
    } catch { return false; }
  }
  status() {
    return this.catalog.map(item => ({ id: item.id, label: item.label, description: item.description || ({ paraformer: '录制时显示实时字幕。', qwen: '停止录音后的高质量最终稿。', sensevoice: '可选的离线识别预设。', 'emotion-model': '录制中的语气提示。' }[item.id]), kind: item.kind, bytes: item.files?.reduce((sum, file) => sum + file.size, 0), sizeHint: item.sizeHint, ready: this.ready(item), ...(this.states.get(item.id) || {}), busy: Boolean(this.active) }));
  }
  update(id, patch) { this.states.set(id, { ...this.states.get(id), ...patch }); this.emit('progress', this.status()); }
  async install(id) { return this.start([id]); }
  async installAll() { return this.start(this.catalog.map(item => item.id)); }
  async start(ids) {
    if (this.active) throw new Error('已有资源正在准备，请等待或取消');
    for (const id of ids) if (!this.catalog.some(item => item.id === id)) throw new Error('未知资源');
    const controller = new AbortController(); this.active = controller;
    try { for (const id of ids) await this.installItem(id, controller.signal); }
    finally { this.active = null; this.emit('progress', this.status()); }
    return this.status();
  }
  cancel() { this.active?.abort(new Error('资源准备已取消，可再次点击继续')); }
  async installItem(id, signal) {
    signal.throwIfAborted();
    const item = this.catalog.find(entry => entry.id === id);
    if (this.ready(item)) return;
    try {
      for (const dependency of item.dependencies || []) await this.installItem(dependency, signal);
      this.update(id, { stage: '准备中', detail: '', error: '', received: 0, total: 0 });
      if (item.kind === 'environment') await this.installEnvironment(item, signal);
      else {
        const total = item.files.reduce((sum, file) => sum + file.size, 0); let complete = 0;
        for (const file of item.files) {
          signal.throwIfAborted();
          const destination = safeResourcePath(this.root, `${item.directory}/${file.path}`);
          await this.download({ ...file, destination, signal, onProgress: progress => this.update(id, { stage: '下载并校验', received: complete + progress.received, total }) });
          if (!await fileMatches(destination, file)) throw new Error('资源文件校验失败');
          complete += file.size;
        }
      }
      signal.throwIfAborted();
      fs.mkdirSync(path.dirname(this.marker(item)), { recursive: true });
      fs.writeFileSync(this.marker(item), JSON.stringify({ fingerprint: this.fingerprint(item), installedAt: new Date().toISOString() }));
      this.update(id, { stage: '已就绪', detail: '', error: '' });
    } catch (error) { this.update(id, { stage: signal.aborted ? '已取消' : '准备失败', error: error.message }); throw error; }
  }
  async ensurePython(id, signal) {
    const python = path.join(this.root, 'python', 'bin', 'python3');
    const marker = path.join(this.root, 'python', '.ready');
    if (fs.existsSync(python) && fs.existsSync(marker)) return python;
    this.update(id, { stage: '下载独立运行环境' });
    const archive = path.join(this.root, 'downloads', 'python.tar.gz');
    await this.download({ ...PYTHON, destination: archive, signal, onProgress: value => this.update(id, { received: value.received, total: value.total }) });
    const staging = path.join(this.root, 'downloads', 'python-staging');
    fs.rmSync(staging, { recursive: true, force: true }); fs.mkdirSync(staging, { recursive: true });
    await this.run('/usr/bin/tar', ['-xzf', archive, '-C', staging], signal, id);
    await this.run(path.join(staging, 'python', 'bin', 'python3'), ['-c', 'import ssl, venv, ensurepip; print("Python ready")'], signal, id);
    fs.rmSync(path.join(this.root, 'python'), { recursive: true, force: true });
    fs.renameSync(path.join(staging, 'python'), path.join(this.root, 'python'));
    fs.writeFileSync(marker, PYTHON.sha256);
    fs.rmSync(archive, { force: true }); fs.rmSync(staging, { recursive: true, force: true });
    return python;
  }
  async installEnvironment(item, signal) {
    const basePython = await this.ensurePython(item.id, signal);
    const environment = path.join(this.root, 'envs', item.id);
    fs.mkdirSync(path.dirname(environment), { recursive: true });
    this.update(item.id, { stage: '创建独立环境', received: 0, total: 0 });
    await this.run(basePython, ['-m', 'venv', environment], signal, item.id);
    const python = path.join(environment, 'bin', 'python3');
    this.update(item.id, { stage: '下载并安装依赖（首次可能较久）' });
    await this.run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', '--prefer-binary', '--index-url', 'https://pypi.org/simple', ...item.requirements], signal, item.id, true);
    this.update(item.id, { stage: '检查运行环境' });
    await this.run(python, ['-c', item.probe, ...(item.id === 'audio' ? [path.join(environment, 'bin', 'ffmpeg')] : [])], signal, item.id);
    if (item.id === 'audio') await this.run(path.join(environment, 'bin', 'ffmpeg'), ['-version'], signal, item.id);
  }
  run(command, args, signal, id, pip = false) {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const env = { ...process.env, PYTHONNOUSERSITE: '1', PIP_CONFIG_FILE: '/dev/null', PIP_NO_INPUT: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };
      for (const key of ['PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV', 'PIP_TARGET', 'PIP_PREFIX', 'PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL']) delete env[key];
      const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env });
      let diagnostic = '', timer;
      const abort = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 1500); timer.unref?.(); };
      signal.addEventListener('abort', abort, { once: true });
      const observe = chunk => {
        diagnostic = (diagnostic + chunk.toString()).slice(-4000);
        if (pip) {
          const line = chunk.toString().split(/[\r\n]/).find(value => /^(Collecting|Downloading|Installing collected packages|Successfully installed|Requirement already satisfied)/.test(value.trim()));
          if (line) this.update(id, { detail: line.trim().slice(0, 180) });
        }
      };
      child.stdout.on('data', observe); child.stderr.on('data', observe);
      const clean = () => { signal.removeEventListener('abort', abort); clearTimeout(timer); };
      child.on('error', error => { clean(); reject(error); });
      child.on('close', code => { clean(); if (signal.aborted) reject(signal.reason); else if (code !== 0) reject(new Error(`运行环境准备失败：${diagnostic.slice(-1400) || `退出码 ${code}`}`)); else resolve(); });
    });
  }
}
module.exports = { ResourceManager, defaultCatalog, PYTHON };
