// Run with: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron test/integration.meeting-title.electron.js
// Uses the real renderer, preload, IPC and archive files with a local model stub.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createTranscriptArtifact } = require('../lib/meeting-session');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-title-integration-'));
const userData = path.join(temp, 'user-data'), archive = path.join(temp, 'meetings');
fs.mkdirSync(userData);
app.setPath('userData', userData);
app.setLoginItemSettings = () => {};
const requests = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    requests.push(JSON.parse(body));
    res.setHeader('Content-Type', 'application/json');
    const title = body.includes('库存') ? '库存补货与盘点流程' : '搜索系统迁移与上线验证';
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: title } }] }));
  });
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    provider: 'custom', providers: { custom: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'local-test', apiKey: 'test-only' } },
    meeting: { outputDir: archive, autoStartRecording: false, autoDetectMeeting: false, autoSaveArtifacts: false }
  }));
  const legacy = createTranscriptArtifact({ rootDir: archive, sessionId: 'legacy', title: '会议 7', startedAt: '2026-01-01T00:00:00Z',
    transcript: '大家好。今天讨论支付系统升级方案。还要做退款演练。' });
  const originalMetadata = fs.readFileSync(legacy.metadataPath, 'utf8');
  require('../main');
  await app.whenReady();
  const win = BrowserWindow.getAllWindows()[0];
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const ws = window.meetingWorkspace;
    const session = ws.sessions.get(ws.sessions.activeId), trainer = session.trainer;
    await trainer.loadTranscriptText('大家好。今天主要讨论搜索系统迁移方案。后续还要准备回滚预案。', { requestFeedback: false });
    await trainer.ensureMeetingTitle();
    const title = session.title;
    const fieldTitle = session.root.getElementById('meeting-title').value;
    await trainer.saveOriginalText();
    const rows = await window.api.listMeetingHistory({ query: '回滚预案' });
    const restored = await window.api.readMeetingHistory(rows.meetings[0].archiveId);
    await ws.history.show();
    const search = document.getElementById('history-search');
    search.value = '退款演练';
    await ws.history.load();
    const legacyTitle = document.querySelector('#history-list h3').textContent;
    trainer.clearAll();
    await trainer.loadTranscriptText('今天讨论库存补货与盘点流程。', { requestFeedback: false });
    await trainer.ensureMeetingTitle();
    const replacementTitle = session.title;
    const field = session.root.getElementById('meeting-title');
    field.value = '手动会议名'; field.dispatchEvent(new Event('change'));
    await trainer.ensureMeetingTitle();
    await trainer.saveOriginalText();
    const manualRows = await window.api.listMeetingHistory({ query: '手动会议名' });
    trainer.clearAll();
    return { title, fieldTitle, storedTitle: restored.meeting.title, legacyTitle, manualTitle: manualRows.meetings[0].title,
      replacementTitle, keptManualTitle: session.title,
      source: restored.meeting.metadata.titleSource, count: rows.meetings.length };
  })()`);
  assert.deepEqual(result, { title: '搜索系统迁移与上线验证', fieldTitle: '搜索系统迁移与上线验证', storedTitle: '搜索系统迁移与上线验证',
    legacyTitle: '支付系统升级方案', manualTitle: '手动会议名', replacementTitle: '库存补货与盘点流程', keptManualTitle: '手动会议名', source: 'auto', count: 1 });
  assert.equal(requests.length, 2, 'title generation is shared and only repeats after clearing automatic names');
  assert.equal(fs.readFileSync(legacy.metadataPath, 'utf8'), originalMetadata);
  console.log('Meeting title Electron integration passed: automatic title, real IPC and save, history content search, legacy display title without writes, manual rename persistence.');
  server.close();
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(0);
})().catch(error => { console.error(error); server.close(); app.exit(1); });
