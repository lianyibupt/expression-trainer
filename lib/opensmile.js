const { spawn } = require('child_process');
const path = require('path');
const { startTask } = require('./runtime-log');

const WORKER = path.join(__dirname, '..', 'scripts', 'opensmile_worker.py');
const PROJECT_PYTHON = path.join(__dirname, '..', '.venv-qwen3-asr', 'bin', 'python');

function resolvePython(pythonPath = '') {
  if (pythonPath) return pythonPath;
  if (process.env.OPENSMILE_PYTHON) return process.env.OPENSMILE_PYTHON;
  if (process.env.QWEN3_ASR_PYTHON) return process.env.QWEN3_ASR_PYTHON;
  if (process.env.PYTHON) return process.env.PYTHON;
  return require('fs').existsSync(PROJECT_PYTHON) ? PROJECT_PYTHON : 'python3';
}

function runOpenSmile(filePath, segments = [], pythonPath = '') {
  return new Promise((resolve, reject) => {
    const python = resolvePython(pythonPath);
    const child = spawn(python, [WORKER, '--audio', filePath, '--segments', JSON.stringify(segments)], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const task = startTask('openSMILE', '提取声学特征', { segments: segments.length, pid: child.pid });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      const error = new Error('openSMILE 分析超时');
      task.fail(error);
      reject(error);
    }, 120000);
    const clear = () => clearTimeout(timeout);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clear(); task.fail(error); reject(error); });
    child.on('exit', code => {
      clear();
      if (code !== 0) {
        const error = new Error(stderr.trim() || `openSMILE worker exited with code ${code}`);
        task.fail(error, { exitCode: code });
        reject(error);
        return;
      }
      try {
        const line = stdout.trim().split('\n').reverse().find(item => item.trim().startsWith('{'));
        const result = JSON.parse(line);
        task.done();
        resolve(result);
      } catch (error) {
        task.fail(error);
        reject(new Error(`openSMILE worker 输出无法解析: ${error.message}`));
      }
    });
  });
}

function isOpenSmileAvailable(pythonPath = '') {
  return new Promise(resolve => {
    const python = resolvePython(pythonPath);
    const child = spawn(python, ['-c', 'import opensmile'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', code => resolve(code === 0));
  });
}

module.exports = { runOpenSmile, isOpenSmileAvailable, resolvePython, WORKER };
