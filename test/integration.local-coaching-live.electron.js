// Real renderer and local IPC with simulated ASR text; no microphone or model calls.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'coaching-live-integration-'));
app.setPath('userData', temp);
app.setLoginItemSettings = () => {};
fs.writeFileSync(path.join(temp, 'settings.json'), JSON.stringify({ meeting: {
  autoStartRecording: false, autoDetectMeeting: false, expressionOptimizationEnabled: false, autoSaveArtifacts: false } }));
let requests = 0;
global.fetch = async () => { requests++; throw new Error('Unexpected model request'); };
const timeout = setTimeout(() => { console.error('Live coaching integration timed out'); app.exit(1); }, 20000);

(async () => {
  require('../main'); await app.whenReady();
  const win = BrowserWindow.getAllWindows()[0];
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const t = window.meetingWorkspace.sessions.get(window.meetingWorkspace.sessions.activeId).trainer;
    await t.getSettings(); t.session.titleSource = 'manual'; t.isRecording = true;
    t.switchStage('optimize');
    const waitFor = async fn => {
      const start = performance.now();
      while (!fn()) {
        if (performance.now() - start > 2500) throw new Error('UI condition timed out');
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    };
    const painted = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const started = performance.now();
    t.handleASRResult({ text: '这个这个接口', isFinal: true });
    await waitFor(() => t.localAnalysis?.findings.length > 0);
    const previewMs = Math.round(performance.now() - started);
    const preview = { text: t.fullText, count: t.stats.fillers,
      disabled: t.localCoachingContent.querySelector('button').disabled,
      labelled: t.localCoachingContent.textContent.includes('识别中') };

    t.realtimePhraseBuffer = ''; t.resetStats();
    t.handleASRResult({ text: '这个这个参数', isFinal: false });
    await waitFor(() => t.localAnalysis?.findings.length > 0);
    t.handleASRResult({ text: '这个接口负责读日志', isFinal: false });
    await waitFor(() => t.localAnalysis?.findings.length === 0);

    const segment = t.api.segmentText;
    t.api.segmentText = text => new Promise(resolve => { window.finishCoachingSegment = () => resolve({ success: true, text }); });
    t.realtimePhraseBuffer = ''; t.resetStats();
    t.handleASRResult({ text: '这个这个接口。', isFinal: true });
    await waitFor(() => t.localAnalysis?.findings.length > 0);
    const beforeSegment = { text: t.fullText, disabled: t.localCoachingContent.querySelector('button').disabled };
    window.finishCoachingSegment(); await t.realtimeFlushChain;
    const afterSegment = { text: t.fullText, disabled: t.localCoachingContent.querySelector('button').disabled };
    t.api.segmentText = segment;

    const corpus = Array.from({ length: 10 }, (_, i) =>
      '这个这个接口第' + i + '项。后续我们尽快跟进一下。效果很好。这一块之后再说。').join('\\n');
    await t.loadTranscriptText(corpus, { requestFeedback: false });
    t.setLocalCoachingFollowLatest(true); await painted();
    const list = t.localCoachingContent;
    const distance = () => list.scrollHeight - list.clientHeight - list.scrollTop;
    const atLatest = distance();
    const recentEvidence = list.querySelector('.coaching-card:last-child').dataset.coachingId;

    list.dispatchEvent(new WheelEvent('wheel', { deltaY: -500 }));
    const cards = [...list.querySelectorAll('.coaching-card')];
    const anchor = cards[5];
    list.scrollTop += anchor.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.dispatchEvent(new Event('scroll'));
    const anchorId = anchor.dataset.coachingId, anchorTop = anchor.getBoundingClientRect().top;
    const paused = t.localCoachingFollowLatest === false;
    t.handleASRResult({ text: '这个这个新接口。', isFinal: true });
    await t.realtimeFlushChain; await painted();
    const nextAnchor = [...list.querySelectorAll('.coaching-card')].find(card => card.dataset.coachingId === anchorId);
    const anchorDrift = nextAnchor ? Math.abs(nextAnchor.getBoundingClientRect().top - anchorTop) : null;
    const stillPaused = t.localCoachingFollowLatest === false;
    t.btnLocalCoachingFollow.click(); await painted();
    const resumed = { follow: t.localCoachingFollowLatest, distance: distance() };

    list.dispatchEvent(new WheelEvent('wheel', { deltaY: -300 }));
    list.scrollTop = 0; list.dispatchEvent(new Event('scroll'));
    list.scrollTop = list.scrollHeight; list.dispatchEvent(new Event('scroll')); await painted();
    const bottomResumes = t.localCoachingFollowLatest;
    t.localCoachingFilter.value = 'repetition'; t.localCoachingFilter.dispatchEvent(new Event('change')); await painted();
    const newest = t.localAnalysis.findings.filter(item => item.category === 'repetition').sort((a,b) => a.start - b.start).at(-1);
    const lastButton = list.querySelector('.coaching-card:last-child button');
    const newestVisible = Number(lastButton.dataset.coachingStart) === newest.start;
    lastButton.click();
    const location = t.transcriptEditor.value.slice(t.transcriptEditor.selectionStart, t.transcriptEditor.selectionEnd);
    const unchanged = t.transcriptEditor.value === t.fullText;
    t.switchStage('optimize'); t.setLocalCoachingFollowLatest(true); await painted();
    const independent = window.meetingWorkspace.create(); await independent.getSettings();
    const newMeetingFollows = independent.localCoachingFollowLatest;
    window.meetingWorkspace.select(t.session.id);
    t.isRecording = false; await painted();
    return { previewMs, preview, beforeSegment, afterSegment, atLatest, recentEvidence, paused, stillPaused,
      anchorDrift, resumed, bottomResumes, newestVisible, location, unchanged, newMeetingFollows,
      overflow: list.scrollHeight > list.clientHeight };
  })()`);
  assert.ok(result.previewMs < 500, JSON.stringify(result));
  assert.deepEqual(result.preview, { text: '', count: 0, disabled: true, labelled: true });
  assert.deepEqual(result.beforeSegment, { text: '', disabled: true });
  assert.deepEqual(result.afterSegment, { text: '这个这个接口。', disabled: false });
  assert.ok(result.atLatest <= 2);
  assert.equal(result.overflow, true);
  assert.equal(result.paused, true);
  assert.equal(result.stillPaused, true);
  assert.ok(result.anchorDrift !== null && result.anchorDrift < 3, JSON.stringify(result));
  assert.equal(result.resumed.follow, true);
  assert.ok(result.resumed.distance <= 2);
  assert.equal(result.bottomResumes, true);
  assert.equal(result.newestVisible, true);
  assert.equal(result.location, '这个这个');
  assert.equal(result.unchanged, true);
  assert.equal(result.newMeetingFollows, true);
  assert.equal(requests, 0);
  const screenshot = path.join(os.tmpdir(), 'local-coaching-live-follow.png');
  fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
  console.log('Live local coaching integration passed:', JSON.stringify(result), 'Screenshot:', screenshot);
  clearTimeout(timeout); fs.rmSync(temp, { recursive: true, force: true }); app.exit(0);
})().catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
