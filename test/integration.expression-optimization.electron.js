// Real renderer, preload, IPC and settings persistence; only the model is a local HTTP stub.
// Run: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron test/integration.expression-optimization.electron.js
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-optimization-'));
app.setPath('userData', temp);
app.setLoginItemSettings = () => {};
const requests = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    requests.push(JSON.parse(body));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '建议先说明结论' } }] }));
  });
});
const timeout = setTimeout(() => { console.error('Integration timed out'); app.exit(1); }, 30000);

async function loaded(win) {
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const ws = window.meetingWorkspace;
      if (ws && ws.sessions.get(ws.sessions.activeId)?.trainer.settings) return resolve();
      if (Date.now() - started > 5000) return reject(new Error('Renderer not ready'));
      setTimeout(check, 10);
    }; check();
  })`);
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const settingsFile = path.join(temp, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({
    provider: 'custom', providers: { custom: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, customModel: 'test', model: 'test', apiKey: 'test' } },
    meeting: { autoStartRecording: false, autoDetectMeeting: false, autoSaveArtifacts: false }
  }));
  require('../main');
  await app.whenReady();
  const win = BrowserWindow.getAllWindows()[0];
  await loaded(win);
  const initial = await win.webContents.executeJavaScript(`(async () => {
    const ws = window.meetingWorkspace, a = ws.sessions.get(ws.sessions.activeId).trainer;
    const b = ws.create();
    a.session.titleSource = b.session.titleSource = 'manual';
    await b.getSettings();
    const initial = a.btnExpressionOptimization.getAttribute('aria-checked');
    await a.loadTranscriptText('今天我们讨论迁移方案，需要补充验证步骤。', { requestFeedback: false });
    await a.requestRealtimeFeedback();
    a.btnExpressionOptimization.click();
    while (a.btnExpressionOptimization.disabled) await new Promise(resolve => setTimeout(resolve, 10));
    await a.requestRealtimeFeedback();
    const bypass = await window.api.getRealtimeFeedback('绕过界面请求');
    await b.loadTranscriptText('第二场会议也不需要实时表达反馈。');
    const c = ws.create(); await c.getSettings();
    ws.select(a.session.id); a.switchStage('optimize');
    return { initial, states: [a, b, c].map(t => t.btnExpressionOptimization.getAttribute('aria-checked')),
      bypass: bypass.skipped, words: a.stats.totalWords, text: a.fullText };
  })()`);
  assert.equal(initial.initial, 'true');
  assert.deepEqual(initial.states, ['false', 'false', 'false']);
  assert.equal(initial.bypass, true);
  assert.ok(initial.words > 0);
  assert.match(initial.text, /迁移方案/);
  assert.equal(requests.length, 1, 'disabled sessions and direct IPC must not reach the model');
  assert.equal(JSON.parse(fs.readFileSync(settingsFile)).meeting.expressionOptimizationEnabled, false);
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const screenshot = path.join(os.tmpdir(), 'expression-optimization-off.png');
  fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());

  await win.webContents.executeJavaScript('window.api.openSettings()');
  const settingsWin = BrowserWindow.getAllWindows().find(item => item !== win);
  if (settingsWin.webContents.isLoading()) await new Promise(resolve => settingsWin.webContents.once('did-finish-load', resolve));
  const wasOff = await settingsWin.webContents.executeJavaScript(`(async () => {
    while (!document.getElementById('custom-base-url').value) await new Promise(resolve => setTimeout(resolve, 10));
    const checkbox = document.getElementById('expression-optimization-enabled');
    const wasOff = !checkbox.checked;
    checkbox.checked = true;
    document.getElementById('btn-save').click();
    return wasOff;
  })()`);
  assert.equal(wasOff, true, 'settings page loads the disabled preference');
  const external = await win.webContents.executeJavaScript(`(async () => {
    const ws = window.meetingWorkspace;
    while (![...ws.sessions.items.values()].every(s => s.trainer.expressionOptimizationEnabled())) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const a = ws.sessions.get(ws.sessions.activeId).trainer;
    await a.requestRealtimeFeedback();
    await a.toggleExpressionOptimization();
    const minutes = await window.api.getMeetingMinutes({ fullText: a.fullText, stats: a.stats });
    const report = await window.api.getFinalReport({ fullText: a.fullText, stats: a.stats });
    return { minutes: minutes.success, report: report.success };
  })()`);
  assert.deepEqual(external, { minutes: true, report: true });
  // Enabled feedback, settings connection test, enabled feedback, minutes and report.
  assert.equal(requests.length, 5);
  win.reload();
  await loaded(win);
  const reloaded = await win.webContents.executeJavaScript(`(async () => {
    const trainer = window.meetingWorkspace.sessions.get(window.meetingWorkspace.sessions.activeId).trainer;
    trainer.session.titleSource = 'manual';
    await trainer.loadTranscriptText('重载后仍然只记录会议。');
    return trainer.btnExpressionOptimization.getAttribute('aria-checked');
  })()`);
  assert.equal(reloaded, 'false');
  assert.equal(requests.length, 5);
  console.log('Expression optimization Electron integration passed: UI toggle, model request counts, all/new sessions, local analysis, settings page save and broadcast, reload persistence, manual minutes/report. Screenshot:', screenshot);
  clearTimeout(timeout);
  server.close();
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(0);
})().catch(error => { console.error(error); clearTimeout(timeout); server.close(); app.exit(1); });
