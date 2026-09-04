// Run with NODE_PATH pointing to a Playwright installation. No microphone or LLM is used.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.testState = { finals: [], saves: [], exports: [], pendingSaves: {}, requests: [] };
      const ok = async () => ({ success: true });
      window.api = {
        getSettings: async () => ({ meeting: { captureSystemAudio: false, autoSaveArtifacts: true, autoGenerateReport: true } }),
        initASR: async sessionId => ({ success: true, sessionId, mode: 'streaming-final' }),
        feedAudio: async () => null,
        stopASR: async sessionId => ({ success: true, sessionId, finalTextPending: true, recordingPath: `/audio/${sessionId}.wav` }),
        stopNativeSystemAudio: ok, markMeetingRecordingStarted: ok, markMeetingRecordingStopped: ok,
        updateMeetingActivity: async () => ({}), onNativeSystemAudioSamples: () => {}, onNativeSystemAudioEvent: () => {},
        onAudioAnalysisProgress: () => {}, onASRFinalResult: cb => window.testState.finals.push(cb),
        analyzeText: async text => ({ fillers: [], hedges: [], vagueWords: [], totalWords: text.length }),
        getRealtimeFeedback: async () => ({ success: true, feedback: '' }),
        getFinalReport: async data => { window.testState.requests.push(data); return { success: true, report: 'Report' }; },
        getMeetingMinutes: async () => ({ success: true, minutes: 'Minutes' }),
        saveMeetingTranscript: payload => new Promise(resolve => {
          window.testState.saves.push(payload);
          window.testState.pendingSaves[payload.sessionId] = resolve;
        }),
        saveMeetingReport: ok, saveMeetingMinutes: ok,
        saveFile: async (content, filename, options) => {
          window.testState.exports.push({ content, filename, options });
          return { success: true, path: `/exports/${filename}` };
        },
        openSettings: ok, openPromptEditor: ok
      };
      const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1 } });
      window.AudioContext = class {
        constructor() { this.destination = {}; }
        createMediaStreamSource() { return node(); }
        createGain() { return node(); }
        createScriptProcessor() { return node(); }
        async close() {}
      };
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => ({ getTracks: () => [{ stop() {} }] }) });
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'src/index.html')).href);
    await page.waitForFunction(() => window.meetingWorkspace?.sessions.items.size === 1);
    const current = () => page.locator('#session-hosts > div:not([hidden])');
    const a = await page.evaluate(() => window.meetingWorkspace.sessions.activeId);
    await current().locator('#meeting-title').fill('产品评审');
    await current().locator('#meeting-title').press('Tab');
    await current().locator('#btn-start').click();
    await page.waitForFunction(id => window.meetingWorkspace.sessions.get(id).trainer.isRecording, a);
    assert.equal(await current().getByRole('button', { name: '关闭 产品评审', exact: true }).isDisabled(), true);
    await page.evaluate(id => window.meetingWorkspace.sessions.get(id).trainer.handleASRResult({ text: '第一场会议的实时内容。', isFinal: true }), a);
    await current().locator('#btn-stop').click();
    await page.waitForFunction(() => !window.meetingWorkspace.sessions.recordingId);
    await current().locator('#btn-new-session').click();
    const b = await page.evaluate(() => window.meetingWorkspace.sessions.activeId);
    await current().locator('#meeting-title').fill('技术讨论');
    await current().locator('#meeting-title').press('Tab');
    await current().locator('#btn-start').click();
    await page.waitForFunction(id => window.meetingWorkspace.sessions.get(id).trainer.isRecording, b);
    await current().getByRole('tab', { name: /产品评审/ }).click();
    assert.match(await current().locator('#recording-banner-text').innerText(), /技术讨论/);
    await current().getByRole('button', { name: '关闭 产品评审', exact: true }).click();
    assert.equal(await page.evaluate(() => window.meetingWorkspace.sessions.activeId), b);
    await current().locator('#btn-stop').click();
    await page.waitForFunction(() => !window.meetingWorkspace.sessions.recordingId);
    await page.evaluate(async ({ a, b }) => {
      for (const id of [b, a]) {
        const result = { sessionId: id, finalText: id === a ? '第一场最终原文。' : '第二场最终原文。',
          speakerSegments: [{ speaker: id === a ? 'A speaker' : 'B speaker', start: 0, end: 1 }] };
        await Promise.all(window.testState.finals.map(cb => cb(result)));
      }
    }, { a, b });
    assert.equal(await current().locator('#transcript-editor').inputValue(), '第二场最终原文。');
    await current().locator('#recent-sessions').selectOption(a);
    assert.equal(await current().locator('#transcript-editor').inputValue(), '第一场最终原文。');
    await current().locator('[data-stage="transcript"]').click();
    await current().locator('#transcript-editor').fill('人工修改的第一场原文。');
    await current().locator('#btn-save-text').click();
    await page.waitForFunction(() => window.testState.exports.length === 1);
    const exported = await page.evaluate(() => window.testState.exports[0]);
    assert.match(exported.content, /人工修改的第一场原文/);
    assert.ok(exported.content.includes(a));
    assert.ok(!exported.content.includes(b));
    assert.match(exported.options.title, /产品评审/);
    await page.evaluate(id => { window.meetingWorkspace.sessions.get(id).trainer.confirmSaveAndReport(); }, a);
    await page.waitForFunction(() => window.testState.saves.length === 1);
    await current().getByRole('button', { name: '关闭 产品评审', exact: true }).click();
    await page.evaluate(id => window.testState.pendingSaves[id]({ success: true, sessionDir: `/saved/${id}`, transcriptPath: `/saved/${id}/transcript.md` }), a);
    await page.waitForFunction(id => window.meetingWorkspace.sessions.get(id).trainer.lastReport === 'Report', a);
    const result = await page.evaluate(({ a, b }) => ({
      saved: window.meetingWorkspace.sessions.get(a).trainer.meetingSession.sessionDir,
      request: window.testState.requests[0].fullText,
      other: window.meetingWorkspace.sessions.get(b).trainer.fullText,
      otherSaved: window.meetingWorkspace.sessions.get(b).trainer.meetingSession,
      speakers: [...window.meetingWorkspace.sessions.items.values()].map(s => s.trainer.speakerSegments[0]?.speaker)
    }), { a, b });
    assert.equal(result.saved, `/saved/${a}`);
    assert.equal(result.request, '人工修改的第一场原文。');
    assert.equal(result.other, '第二场最终原文。');
    assert.equal(result.otherSaved, null);
    assert.deepEqual(result.speakers, ['A speaker', 'B speaker']);
    await current().locator('#recent-sessions').selectOption(a);
    await current().locator('[data-stage="transcript"]').click();
    assert.equal(await current().locator('#audio-waveform').evaluate(canvas => canvas.height), 232);
    await page.screenshot({ path: '/tmp/expression-trainer-meeting-tabs.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: '/tmp/expression-trainer-meeting-tabs-mobile.png' });
    await page.setViewportSize({ width: 1200, height: 900 });
    await current().locator('[data-stage="live"]').click();
    await current().locator('#btn-start').click();
    const c = await page.evaluate(() => window.meetingWorkspace.sessions.activeId);
    assert.notEqual(c, a);
    await page.waitForFunction(id => window.meetingWorkspace.sessions.get(id).trainer.isRecording, c);
    assert.equal(await page.evaluate(id => window.meetingWorkspace.sessions.get(id).trainer.fullText, a), '人工修改的第一场原文。');
    await current().locator('#btn-stop').click();
    await page.waitForFunction(() => !window.meetingWorkspace.sessions.recordingId);
    await current().locator('[data-stage="transcript"]').click();
    await current().locator('#transcript-editor').fill('第三场人工编辑稿');
    await page.evaluate(async id => {
      await Promise.all(window.testState.finals.map(cb => cb({ sessionId: id, finalText: '第三场最终稿' })));
    }, c);
    assert.equal(await current().locator('#transcript-editor').inputValue(), '第三场人工编辑稿');
    assert.equal(await current().locator('#btn-adopt-final').isVisible(), true);
    await current().locator('#btn-adopt-final').click();
    assert.equal(await current().locator('#transcript-editor').inputValue(), '第三场最终稿');
    await current().getByRole('tab', { name: /产品评审/ }).click();
    await current().getByRole('button', { name: '关闭 产品评审', exact: true }).click();
    await current().getByRole('button', { name: '关闭 技术讨论', exact: true }).click();
    await current().getByRole('button', { name: '关闭 会议 3', exact: true }).click();
    assert.equal(await page.evaluate(() => [...window.meetingWorkspace.sessions.items.values()].filter(s => s.open).length), 1);
    assert.equal(await current().locator('#transcript-editor').inputValue(), '');
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: recording ownership, close/reopen, out-of-order finalization, edited export, pending save/report, desktop/mobile, new recording preserves old meeting, edit/final conflict, close last tab.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
