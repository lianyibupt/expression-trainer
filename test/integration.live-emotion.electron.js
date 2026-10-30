// Public model fixture -> real local worker -> windowing -> Electron IPC -> renderer.
// No microphone, private audio, ASR runtime or external APIs are used.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EmotionWorker, LiveEmotion, classifyScores } = require('../lib/live-emotion');
const { readWav16kMono } = require('../lib/audio-analysis');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-ui-integration-'));
app.setPath('userData', temp);
app.setLoginItemSettings = () => {};
fs.writeFileSync(path.join(temp, 'settings.json'), JSON.stringify({ meeting: {
  autoStartRecording: false, autoDetectMeeting: false, expressionOptimizationEnabled: false } }));
const worker = new EmotionWorker();
const timeout = setTimeout(() => { console.error('Emotion integration timed out'); worker.close(); app.exit(1); }, 60000);

(async () => {
  require('../main');
  await app.whenReady();
  const win = BrowserWindow.getAllWindows()[0];
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  const id = await win.webContents.executeJavaScript(`(async () => {
    const ws = window.meetingWorkspace, t = ws.sessions.get(ws.sessions.activeId).trainer;
    await t.getSettings(); t.isRecording = true;
    t.audioSourceSelection = { microphone: true, system: false };
    return t.session.id;
  })()`);
  await worker.start();
  const input = readWav16kMono(path.join(__dirname, '../models/emotion2vec_plus_base/example/test.wav'));
  const samples = new Float32Array(96000);
  samples.set(input.subarray(0, samples.length));
  let live;
  const result = await new Promise((resolve, reject) => {
    live = new LiveEmotion({ infer: values => worker.infer(values) });
    live.start(id, payload => {
      win.webContents.send('live-emotion', payload);
      if (payload.status === 'result') resolve(payload);
      if (payload.status === 'unavailable') reject(new Error(payload.message));
    });
    for (let offset = 0; offset < samples.length; offset += 2048) live.feed(id, samples.subarray(offset, offset + 2048));
  });
  const displayed = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const t = window.meetingWorkspace.sessions.get(${JSON.stringify(id)}).trainer;
    const start = Date.now();
    const check = () => {
      if (t.liveEmotionStatus.dataset.status === 'result') return resolve({ labels: t.liveEmotionCategories.textContent,
        detail: t.liveEmotionDetail.textContent, diagnostics: t.liveEmotionDiagnostics.textContent });
      if (Date.now() - start > 5000) return reject(new Error('Emotion IPC not rendered'));
      setTimeout(check, 10);
    }; check();
  })`);
  assert.ok(displayed.labels.includes(result.candidates[0].label));
  assert.doesNotMatch(displayed.labels, /%/);
  assert.match(displayed.detail, /麦克风声音/);
  assert.match(displayed.diagnostics, /未经校准/);
  assert.match(displayed.diagnostics, /RMS/);
  assert.equal(result.distribution.length, 9);
  assert.ok(result.inputQuality.rms > 0);

  await win.webContents.executeJavaScript(`window.meetingWorkspace.sessions.get(${JSON.stringify(id)}).trainer.audioSourceSelection = { microphone: true, system: true }`);
  const saturated = classifyScores({ labels: ['neutral', 'happy', 'angry'], scores: [1, 1e-9, 1e-10] });
  win.webContents.send('live-emotion', { ...saturated, sessionId: id, startSeconds: 99, endSeconds: 105, inputQuality: result.inputQuality });
  const neutral = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const t = window.meetingWorkspace.sessions.get(${JSON.stringify(id)}).trainer, start = Date.now();
    const check = () => {
      if (t.liveEmotionDetail.textContent.includes('01:39')) return resolve({ labels: t.liveEmotionCategories.textContent, detail: t.liveEmotionDetail.textContent });
      if (Date.now() - start > 5000) return reject(new Error('Saturated result not rendered'));
      setTimeout(check, 10);
    }; check();
  })`);
  assert.match(neutral.labels, /中性倾向/);
  assert.doesNotMatch(neutral.labels, /100%/);
  assert.match(neutral.detail, /饱和/);
  assert.match(neutral.detail, /混合/);
  await win.webContents.executeJavaScript(`(async () => {
    const t = window.meetingWorkspace.sessions.get(${JSON.stringify(id)}).trainer;
    t.liveEmotionDiagnostics.closest('details').open = true;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  const screenshot = path.join(os.tmpdir(), 'live-emotion-saturated-reference.png');
  fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
  live.pause(id, true);
  const cleared = await win.webContents.executeJavaScript(`new Promise(resolve => {
    const t = window.meetingWorkspace.sessions.get(${JSON.stringify(id)}).trainer;
    const check = () => t.liveEmotionStatus.dataset.status === 'paused'
      ? resolve({ labels: t.liveEmotionCategories.textContent, diagnostics: t.liveEmotionDiagnostics.textContent }) : setTimeout(check, 10);
    check();
  })`);
  assert.deepEqual(cleared, { labels: '', diagnostics: '' });
  live.stop(id); worker.close();
  clearTimeout(timeout);
  console.log('Live emotion integration passed: real public-fixture model, windowing, IPC, raw score distribution, input levels, saturation label without percentages, mixed-source explanation, pause reset. Screenshot:', screenshot);
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(0);
})().catch(error => { console.error(error); clearTimeout(timeout); worker.close(); app.exit(1); });
