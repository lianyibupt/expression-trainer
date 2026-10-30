// Real Electron, preload IPC and filesystem; synthetic audio and a local model stub only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-electron-integration-'));
  const archive = path.join(temp, 'meetings'), userData = path.join(temp, 'user-data');
  fs.mkdirSync(userData);
  const requests = [];
  const modelText = '# 验证产物\n\n| 项目 | 结果 |\n| --- | --- |\n| 流程 | **通过** |\n\n<img src=x onerror="window.__unsafe=1">';
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push(JSON.parse(body));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: modelText } }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    provider: 'custom', providers: { deepseek: { model: 'deepseek-chat' }, custom: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'local-test', apiKey: 'test-only' } },
    meeting: { outputDir: archive, autoStartRecording: false, autoDetectMeeting: false, autoSaveArtifacts: false }
  }));
  const wrapper = path.join(temp, 'launch.cjs');
  fs.writeFileSync(wrapper, `const {app}=require('electron'); app.setPath('userData', ${JSON.stringify(userData)}); require(${JSON.stringify(path.join(root, 'main.js'))});`);
  const wav = path.join(temp, 'synthetic.wav'), pcm = Buffer.alloc(32000), header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40); fs.writeFileSync(wav, Buffer.concat([header, pcm]));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const errors = [];
  async function launch() {
    app = await electron.launch({ executablePath: require('electron'), args: [wrapper], cwd: root, env });
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.meetingWorkspace?.sessions.items.size === 1);
    return page;
  }
  const transcript = '我觉得然后开心。<img src=x onerror="window.__unsafe=1">\n\n第二段保留。';
  let id;
  try {
    let page = await launch();
    assert.equal(await page.evaluate(async () => (await window.api.getSettings()).providers.deepseek.model), 'deepseek-flash');
    assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).providers.deepseek.model, 'deepseek-chat');
    let current = () => page.locator('#session-hosts > div:not([hidden])');
    id = await page.evaluate(async ({ transcript, wav }) => {
      const ws = window.meetingWorkspace, session = ws.sessions.get(ws.sessions.activeId);
      session.title = '跨启动验收 <img src=x>';
      session.trainer.transcriptSource = 'pasted';
      await session.trainer.loadTranscriptText(transcript, { requestFeedback: false });
      session.trainer.pendingAudioPath = wav;
      return session.id;
    }, { transcript, wav });
    assert.equal(await current().locator('#subtitle-container img').count(), 0);
    await current().locator('[data-stage="transcript"]').click();
    await current().locator('#btn-save-text').click();
    await page.waitForFunction(id => Boolean(window.meetingWorkspace.sessions.get(id).trainer.savedSnapshot), id);
    await current().locator('[data-stage="report"]').click();
    await current().locator('#btn-report').click();
    await page.waitForFunction(id => Boolean(window.meetingWorkspace.sessions.get(id).trainer.lastReport), id);
    assert.equal(await current().locator('#report-body img').count(), 0);
    assert.equal(await current().locator('#report-body table').count(), 1);
    await current().locator('[data-stage="minutes"]').click();
    await current().locator('#btn-generate-minutes').click();
    await page.waitForFunction(id => Boolean(window.meetingWorkspace.sessions.get(id).trainer.lastMinutes), id);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await page.locator('#exit-modal').waitFor({ state: 'visible' });
    await page.locator('#btn-exit-cancel').click();
    assert.equal(await current().locator('#transcript-editor').inputValue(), transcript);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await page.locator('#exit-modal').waitFor({ state: 'visible' });
    await page.screenshot({ path: '/private/tmp/expression-safe-exit-verified.png' });
    const closed = app.waitForEvent('close');
    await page.locator('#btn-exit-save').click(); await closed; app = null;

    const directory = fs.readdirSync(archive)[0];
    const saved = path.join(archive, directory);
    assert.equal(fs.readFileSync(path.join(saved, 'transcript.txt'), 'utf8'), transcript);
    assert.equal(fs.readFileSync(path.join(saved, 'report-content.md'), 'utf8'), modelText);
    assert.equal(fs.readFileSync(path.join(saved, 'minutes-content.md'), 'utf8'), modelText);
    assert.equal(fs.statSync(path.join(saved, 'meeting.wav')).size, 32044);

    const manualSettings = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
    manualSettings.providers.deepseek.model = 'private-deepseek-model';
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(manualSettings));

    page = await launch(); current = () => page.locator('#session-hosts > div:not([hidden])');
    const settingsOpened = app.waitForEvent('window');
    await page.evaluate(() => window.api.openSettings());
    const settingsPage = await settingsOpened;
    await settingsPage.waitForFunction(() => document.getElementById('provider')?.value === 'custom');
    await settingsPage.locator('#provider').selectOption('deepseek');
    assert.equal(await settingsPage.locator('#model').inputValue(), 'private-deepseek-model');
    assert.equal(await settingsPage.locator('#model option[value="deepseek-flash"]').count(), 1);
    await settingsPage.close();
    await current().locator('#btn-history').click();
    await page.locator('#history-list .history-item').waitFor();
    assert.equal(await page.locator('#history-list img').count(), 0);
    await page.screenshot({ path: '/private/tmp/expression-history-verified.png' });
    await page.getByRole('button', { name: '打开会议', exact: true }).click();
    await page.waitForFunction(id => window.meetingWorkspace.sessions.activeId === id, id);
    assert.equal(await current().locator('#transcript-editor').inputValue(), transcript);
    const restored = await page.evaluate(id => {
      const t = window.meetingWorkspace.sessions.get(id).trainer;
      return { report: t.lastReport, minutes: t.lastMinutes, recording: t.isRecording, audio: t.audioPlayer.src };
    }, id);
    assert.equal(restored.report, modelText); assert.equal(restored.minutes, modelText);
    assert.equal(restored.recording, false); assert.match(restored.audio, /meeting.wav$/);
    await current().locator('#transcript-editor').fill('编辑后的历史原文。');
    await current().locator('#btn-save-text').click();
    await page.waitForFunction(id => window.meetingWorkspace.sessions.get(id).trainer.savedSnapshot?.transcript === '编辑后的历史原文。', id);
    assert.equal(fs.readdirSync(archive).length, 1);
    assert.equal(fs.readFileSync(path.join(saved, 'transcript.txt'), 'utf8'), '编辑后的历史原文。');
    await current().locator('#btn-history').click();
    await page.locator('#history-list .history-item').waitFor();
    await page.getByRole('button', { name: '打开会议', exact: true }).click();
    assert.equal(await current().locator('#transcript-editor').inputValue(), '编辑后的历史原文。');
    assert.equal(await page.evaluate(() => window.__unsafe || 0), 0);
    assert.deepEqual(errors, []);
    assert.equal(requests.length, 2);
    const nativeExit = await app.evaluate(async ({ BrowserWindow, dialog }) => {
      let prompts = 0;
      dialog.showMessageBoxSync = () => prompts++ === 0 ? 0 : 1;
      const win = BrowserWindow.getAllWindows()[0];
      await new Promise(resolve => {
        win.webContents.once('render-process-gone', resolve);
        win.webContents.forcefullyCrashRenderer();
      });
      win.close();
      return { keptOpen: !win.isDestroyed(), prompts };
    });
    assert.deepEqual(nativeExit, { keptOpen: true, prompts: 1 });
    const crashedClosed = app.waitForEvent('close');
    await app.evaluate(({ app }) => { setImmediate(() => app.quit()); });
    await crashedClosed; app = null;
    console.log('Electron integration passed: real IPC, archive writes, synthetic WAV, cancel/confirm close, restart, history restore, safe HTML/table rendering, duplicate open, edit and save to the same folder, DeepSeek read-time migration and custom model preservation in the real settings window.');
    console.log('Renderer crash fault injection passed: native confirmation dispatch, keep-open choice, then explicit quit choice (native dialog response stubbed).');
    console.log(`Evidence: /private/tmp/expression-safe-exit-verified.png; /private/tmp/expression-history-verified.png; test data: ${temp}`);
  } finally {
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
