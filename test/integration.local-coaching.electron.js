// Real Electron UI, preload, local analyzer, history and filesystem. No microphone or LLM.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createTranscriptArtifact } = require('../lib/meeting-session');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-coaching-integration-'));
app.setPath('userData', path.join(temp, 'user-data'));
app.setLoginItemSettings = () => {};
fs.mkdirSync(app.getPath('userData'), { recursive: true });
const archive = path.join(temp, 'meetings');
const source = '说话人 1：呃，嗯，我们开始。这个这个接口效果很好。\n'
  + '说话人 2：我觉得可能应该调整。这一块之后再说。后续我们尽快跟进一下。\n'
  + '说话人 1：我们先讨论背景然后讨论限制然后看看实现然后回到背景然后再考虑细节。这个做法对吧，后面再说对吧，大家理解对吧。';
const saved = createTranscriptArtifact({ rootDir: archive, sessionId: 'local-history-test',
  title: '本地表达建议测试', titleSource: 'manual', startedAt: '2026-10-01T00:00:00Z', transcript: source,
  stats: { totalWords: 999, duration: 90 } });
const originalMetadata = fs.readFileSync(saved.metadataPath, 'utf8');
const originalTranscript = fs.readFileSync(path.join(saved.sessionDir, 'transcript.txt'), 'utf8');
fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({
  provider: 'custom', providers: { custom: { baseUrl: 'http://127.0.0.1:1/v1', customModel: 'unused' } },
  meeting: { outputDir: archive, expressionOptimizationEnabled: false,
    autoStartRecording: false, autoDetectMeeting: false, autoSaveArtifacts: false }
}));
let modelRequests = 0;
global.fetch = async () => { modelRequests++; throw new Error('Unexpected model request'); };
const timeout = setTimeout(() => { console.error('Local coaching integration timed out'); app.exit(1); }, 30000);

(async () => {
  require('../main');
  await app.whenReady();
  const win = BrowserWindow.getAllWindows()[0];
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const ws = window.meetingWorkspace;
    const t = ws.sessions.get(ws.sessions.activeId).trainer;
    await t.getSettings(); t.session.titleSource = 'manual';
    await t.loadTranscriptText(${JSON.stringify(source)});
    t.switchStage('optimize');
    const dimensions = new Set(t.localAnalysis.findings.map(item => item.category)).size;
    const cards = t.localCoachingContent.querySelectorAll('.coaching-card').length;
    const sourceBefore = t.fullText;
    const option = t.localCoachingFilter;
    option.value = 'action'; option.dispatchEvent(new Event('change'));
    const filtered = t.localCoachingContent.querySelectorAll('.coaching-card').length;
    const expected = t.localAnalysis.findings.find(item => item.category === 'action').evidence;
    t.localCoachingContent.querySelector('button').click();
    const selected = t.transcriptEditor.value.slice(t.transcriptEditor.selectionStart, t.transcriptEditor.selectionEnd);
    const location = t.currentStage;
    const unchanged = sourceBefore === t.fullText;
    t.transcriptEditor.value = '我想先看一下日志，然后做接口测试，可能存在缓存问题。';
    t.transcriptEditor.dispatchEvent(new Event('input'));
    await new Promise(resolve => setTimeout(resolve, 230));
    const naturalFindings = t.localAnalysis.findings.length;
    const naturalHighlight = t.highlightText(t.fullText);
    const density = t.statDensity.textContent;
    await t.loadTranscriptText('我觉得可能应该先验证。', { requestFeedback: false });
    const finalFindings = t.localAnalysis.findings.map(item => item.category);
    const record = await window.api.readMeetingHistory(${JSON.stringify(path.basename(saved.sessionDir))});
    if (!record.success) throw new Error(record.error);
    await ws.openArchivedMeeting(record.meeting);
    const restored = ws.sessions.get(ws.sessions.activeId).trainer;
    await restored.getSettings(); restored.switchStage('optimize');
    const restoredFindings = restored.localAnalysis.findings.length;
    const attribution = restored.localCoachingContent.textContent.includes('说话人 2');
    restored.localCoachingFilter.value = 'action'; restored.renderLocalCoaching();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const panel = restored.root.querySelector('[data-panel="optimize"]');
    const geometry = { bottom: panel.getBoundingClientRect().bottom, viewport: innerHeight,
      listHeight: restored.localCoachingContent.getBoundingClientRect().height };
    return { dimensions, cards, filtered, selected, expected, location, unchanged, naturalFindings,
      naturalHighlight, density, finalFindings, restoredFindings, attribution, geometry,
      restoredWords: restored.stats.totalWords };
  })()`);
  assert.equal(result.dimensions, 8);
  assert.ok(result.cards >= 8);
  assert.equal(result.filtered, 1);
  assert.equal(result.selected, result.expected);
  assert.equal(result.location, 'transcript');
  assert.equal(result.unchanged, true);
  assert.equal(result.naturalFindings, 0);
  assert.doesNotMatch(result.naturalHighlight, /<span/);
  assert.equal(result.density, '100%');
  assert.deepEqual(result.finalFindings, ['hedging']);
  assert.ok(result.restoredFindings >= 8);
  assert.equal(result.attribution, true);
  assert.notEqual(result.restoredWords, 999, 'legacy counters are recalculated for display');
  assert.ok(result.geometry.listHeight > 100);
  assert.ok(result.geometry.bottom <= result.geometry.viewport + 2);
  assert.equal(modelRequests, 0, 'all local analysis and history operations must work without LLM calls');
  assert.equal(fs.readFileSync(saved.metadataPath, 'utf8'), originalMetadata);
  assert.equal(fs.readFileSync(path.join(saved.sessionDir, 'transcript.txt'), 'utf8'), originalTranscript);
  const screenshot = path.join(os.tmpdir(), 'local-coaching-action.png');
  fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
  console.log('Local coaching Electron integration passed: eight categories, filters, source selection, edit debounce, final replacement, history refresh without writes, speaker attribution, layout and zero model requests. Screenshot:', screenshot);
  clearTimeout(timeout);
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(0);
})().catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
