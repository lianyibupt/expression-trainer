const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const LABELS = { neutral: '中性', happy: '愉快', sad: '悲伤', angry: '愤怒', fearful: '恐惧', disgusted: '厌恶', surprised: '惊讶' };

function classifyScores(result) {
  if (!Array.isArray(result?.labels) || !Array.isArray(result?.scores) ||
      !result.labels.length || result.labels.length !== result.scores.length ||
      result.scores.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error('情绪模型返回的类别分数无效');
  }
  const ranked = result.labels.map((label, i) => {
    // FunASR labels may use bilingual names, e.g. 生气/angry.
    const key = String(label).split('/').at(-1).toLowerCase().trim();
    return { key, label: LABELS[key], score: result.scores[i] };
  }).sort((a, b) => b.score - a.score);
  if (!ranked[0].label || ranked[0].score < 0.45) return { status: 'uncertain', candidates: [], message: '语气暂不明确' };
  return { status: 'result', candidates: ranked.filter(item => item.label && item.score >= 0.2).slice(0, 2) };
}

// A persistent worker, with one outstanding request. Installation/downloads are
// deliberately separate; recording never initiates network access.
class EmotionWorker {
  constructor({ spawnProcess = spawn, exists = fs.existsSync } = {}) {
    this.child = null; this.pending = null; this.nextId = 0;
    this.spawnProcess = spawnProcess; this.exists = exists;
  }

  start() {
    if (this.ready) return this.ready;
    const python = path.join(__dirname, '..', '.venv-emotion', 'bin', 'python');
    const model = path.join(__dirname, '..', 'models', 'emotion2vec_plus_base');
    if (!this.exists(python) || !['config.yaml', 'model.pt', 'tokens.txt'].every(file => this.exists(path.join(model, file)))) {
      return Promise.reject(new Error('请先运行 python3 scripts/setup_emotion.py 安装本地语气模型'));
    }
    this.ready = new Promise((resolve, reject) => {
      const child = this.child = this.spawnProcess(python, ['-u', path.join(__dirname, '..', 'scripts', 'emotion_worker.py'), '--model', model], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PYTORCH_ENABLE_MPS_FALLBACK: '1' }
      });
      let stderr = '';
      child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
      const startupTimer = setTimeout(() => fail(new Error('语气模型加载超时')), 90000);
      const fail = error => {
        clearTimeout(startupTimer);
        reject(error);
        if (this.child === child) this.close(error);
      };
      readline.createInterface({ input: child.stdout }).on('line', line => {
        if (!line.startsWith('{')) return;
        let payload;
        try { payload = JSON.parse(line); } catch { return; }
        if (payload.ready) { clearTimeout(startupTimer); resolve(); }
        else if (this.pending && payload.id === this.pending.id) {
          const pending = this.pending;
          this.pending = null;
          clearTimeout(pending.timer);
          if (payload.error) pending.reject(new Error(payload.error));
          else pending.resolve(payload);
        } else if (payload.error && payload.id == null) fail(new Error(payload.error));
      });
      child.on('error', fail);
      child.on('exit', () => fail(new Error(stderr.trim() || '语气模型进程已退出')));
      child.stdin.on('error', fail);
    });
    return this.ready;
  }

  async infer(samples) {
    await this.start();
    if (!this.child) throw new Error('语气分析已结束');
    if (this.pending) throw new Error('语气模型仍在处理上一段声音');
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => this.close(new Error('语气分析超时')), 15000);
      this.pending = { id, resolve, reject, timer };
      const bytes = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
      this.child.stdin.write(JSON.stringify({ id, pcm: bytes.toString('base64') }) + '\n');
    });
  }

  close(error = new Error('语气分析已结束')) {
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
    child?.kill();
  }
}

class LiveEmotion {
  constructor({ infer, warmup = () => Promise.resolve(), close = () => {} }) {
    this.infer = infer; this.warmup = warmup; this.closeWorker = close;
    this.generation = 0;
  }

  start(sessionId, emit) {
    if (this.sessionId) this.stop(this.sessionId);
    this.sessionId = sessionId; this.emit = emit; this.paused = false;
    this.sampleCount = 0; this.resetWindow();
    const generation = ++this.generation;
    this.send({ status: 'loading', message: '正在加载本地语气模型' });
    Promise.resolve().then(() => {
      if (generation === this.generation && this.sessionId) return this.warmup();
    }).then(() => {
      if (generation === this.generation && !this.paused && !this.disabled && this.lastStatus === 'loading') this.send({ status: 'collecting', message: '等待约 6 秒有效声音' });
    }).catch(error => {
      if (generation === this.generation) { this.disabled = true; this.send({ status: 'unavailable', message: error.message }); }
    });
  }

  resetWindow() {
    this.buffer = new Float32Array(96000); this.filled = 0; this.untilNext = 96000;
    this.pending = null; this.disabled = false;
  }

  send(payload) { this.lastStatus = payload.status; this.emit?.({ ...payload, sessionId: this.sessionId }); }

  feed(sessionId, samples) {
    if (!sessionId || sessionId !== this.sessionId || this.paused || this.disabled) return;
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(samples.length - offset, this.untilNext);
      if (take >= this.buffer.length) this.buffer.set(samples.subarray(offset + take - this.buffer.length, offset + take));
      else { this.buffer.copyWithin(0, take); this.buffer.set(samples.subarray(offset, offset + take), this.buffer.length - take); }
      this.filled = Math.min(this.buffer.length, this.filled + take);
      this.sampleCount += take; this.untilNext -= take; offset += take;
      if (!this.untilNext) {
        this.untilNext = 48000;
        this.pending = { samples: this.buffer.slice(), endSeconds: this.sampleCount / 16000, generation: this.generation };
        this.drain();
      }
    }
  }

  async drain() {
    if (this.busy || !this.pending || this.paused || !this.sessionId || this.disabled) return;
    const job = this.pending; this.pending = null; this.busy = true;
    try {
      let activeFrames = 0;
      for (let offset = 0; offset < job.samples.length; offset += 800) {
        let energy = 0;
        for (let i = offset; i < offset + 800; i++) energy += job.samples[i] ** 2;
        if (Math.sqrt(energy / 800) >= 0.008) activeFrames++;
      }
      const timing = { startSeconds: job.endSeconds - 6, endSeconds: job.endSeconds };
      if (activeFrames < 20) {
        this.send({ ...timing, status: 'silence', message: '有效声音不足，等待发言', candidates: [] });
      } else {
        this.send({ ...timing, status: 'analyzing', message: '正在分析最近一段语气' });
        const started = Date.now();
        const result = await this.infer(job.samples);
        if (job.generation === this.generation && this.sessionId && !this.paused) {
          this.send({ ...timing, ...classifyScores(result), inferenceMs: Date.now() - started });
        }
      }
    } catch (error) {
      if (job.generation === this.generation && this.sessionId) {
        this.disabled = true;
        this.send({ status: 'unavailable', message: error.message, candidates: [] });
      }
    } finally { this.busy = false; this.drain(); }
  }

  pause(sessionId, paused) {
    if (sessionId !== this.sessionId) return;
    this.generation++; this.paused = Boolean(paused); this.resetWindow();
    this.send({ status: paused ? 'paused' : 'collecting', message: paused ? '已暂停语气反馈' : '等待约 6 秒有效声音', candidates: [] });
  }

  stop(sessionId) {
    if (sessionId !== this.sessionId) return;
    this.generation++; this.resetWindow(); this.closeWorker();
    this.send({ status: 'stopped', message: '录音已结束', candidates: [] });
    this.sessionId = null;
  }
}

module.exports = { LiveEmotion, EmotionWorker, classifyScores };
