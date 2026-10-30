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
      window.testState = {
        finals: [], saves: [], artifactSaves: [], exports: [], pendingSaves: {}, requests: [],
        exitRequests: [], exitApproved: 0, exitCancelled: 0, forceExit: 0,
        failNextSave: false, retryCalls: 0, retryResult: null
      };
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
        saveMeetingTranscript: payload => {
          window.testState.saves.push(payload);
          if (window.testState.failNextSave) {
            window.testState.failNextSave = false;
            return Promise.resolve({ success: false, error: '测试保存失败' });
          }
          return new Promise(resolve => { window.testState.pendingSaves[payload.sessionId] = resolve; });
        },
        saveMeetingReport: async payload => { window.testState.artifactSaves.push({ kind: 'report', payload }); return { success: true, reportPath: `${payload.sessionDir}/report.md` }; },
        saveMeetingMinutes: async payload => { window.testState.artifactSaves.push({ kind: 'minutes', payload }); return { success: true, minutesPath: `${payload.sessionDir}/minutes.md` }; },
        saveFile: async (content, filename, options) => {
          window.testState.exports.push({ content, filename, options });
          return { success: true, path: `/exports/${filename}` };
        },
        transcribeAudioFile: async () => {
          window.testState.retryCalls += 1;
          return window.testState.retryResult || { success: false, error: '测试最终稿重试失败' };
        },
        onAppExitRequested: callback => window.testState.exitRequests.push(callback),
        approveAppExit: async () => { window.testState.exitApproved += 1; },
        cancelAppExit: async () => { window.testState.exitCancelled += 1; },
        forceAppExit: async () => { window.testState.forceExit += 1; },
        openSettings: ok, openPromptEditor: ok
      };
      const node = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, offset: { value: 0 }, gain: { value: 1 } });
      window.AudioContext = class {
        constructor() { this.destination = {}; this.sampleRate = 16000; }
        createMediaStreamSource() { return node(); }
        createGain() { return node(); }
        createChannelMerger() { return node(); }
        createConstantSource() { return node(); }
        createScriptProcessor() { return node(); }
        async close() {}
      };
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
        const track = { stop() {}, addEventListener() {}, removeEventListener() {} };
        return { getTracks: () => [track], getAudioTracks: () => [track] };
      } });
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
    await current().locator('#btn-export-text').click();
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

    await current().locator('#btn-new-session').click();
    const d = await page.evaluate(() => window.meetingWorkspace.sessions.activeId);
    await current().locator('#meeting-title').fill('连续会议待回写');
    await current().locator('#meeting-title').press('Tab');
    await current().locator('#btn-start').click();
    await page.evaluate(id => window.meetingWorkspace.sessions.get(id).trainer.handleASRResult({ text: '待保存的实时稿。', isFinal: true }), d);
    await current().locator('#btn-stop').click();
    await page.evaluate(id => { window.meetingWorkspace.sessions.get(id).trainer.confirmSaveTranscript(); }, d);
    await page.waitForFunction(id => window.testState.saves.some(item => item.sessionId === id), d);
    await page.evaluate(id => window.testState.pendingSaves[id]({ success: true, sessionDir: `/saved/${id}`, transcriptPath: `/saved/${id}/transcript.md` }), d);
    await page.waitForFunction(id => window.meetingWorkspace.sessions.get(id).trainer.savedSnapshot?.transcriptSource === 'realtime', d);
    await current().locator('#btn-new-session').click();
    const e = await page.evaluate(() => window.meetingWorkspace.sessions.activeId);
    await current().locator('#btn-start').click();
    await page.evaluate(id => {
      window.testState.finals.forEach(cb => cb({ sessionId: id, finalText: '分离后的最终稿。', speakerCount: 2,
        speakerSegments: [{ speaker: '说话人 1', start: 0, end: 1, text: '分离后的最终稿。' }] }));
    }, d);
    await page.waitForFunction(id => window.testState.saves.filter(item => item.sessionId === id).length === 2, d);
    const refreshed = await page.evaluate(id => window.testState.saves.filter(item => item.sessionId === id)[1], d);
    assert.equal(refreshed.transcriptSource, 'final');
    assert.equal(refreshed.transcript, '分离后的最终稿。');
    assert.equal(refreshed.speakerSegments[0].speaker, '说话人 1');
    assert.equal(refreshed.sessionId, d);
    assert.equal(await page.evaluate(id => window.testState.saves.some(item => item.sessionId === id), e), false);
    await page.evaluate(id => window.testState.pendingSaves[id]({ success: true, sessionDir: `/saved/${id}`, transcriptPath: `/saved/${id}/transcript.md` }), d);
    await current().locator('#btn-stop').click();
    await page.waitForFunction(() => !window.meetingWorkspace.sessions.recordingId);

    await page.evaluate(id => {
      const trainer = window.meetingWorkspace.sessions.get(id).trainer;
      trainer.lastMinutes = '退出前已有纪要';
      trainer.lastReport = '退出前已有报告';
      window.testState.prepareDone = null;
      trainer.prepareForExit().then(result => { window.testState.prepareDone = result; });
    }, e);
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => window.testState.prepareDone), null);
    await page.evaluate(async id => {
      await Promise.all(window.testState.finals.map(cb => cb({
        sessionId: id,
        finalText: '退出前最终稿。',
        speakerCount: 2,
        speakerSegments: [{ speaker: '说话人 1', start: 0, end: 1, text: '退出前最终稿。' }]
      })));
    }, e);
    await page.waitForFunction(id => window.testState.saves.some(item => item.sessionId === id), e);
    await page.evaluate(id => window.testState.pendingSaves[id]({
      success: true,
      sessionDir: `/saved/${id}`,
      transcriptPath: `/saved/${id}/transcript.md`
    }), e);
    await page.waitForFunction(() => window.testState.prepareDone?.success === true);
    const exitPrepared = await page.evaluate(id => ({
      result: window.testState.prepareDone,
      saves: window.testState.artifactSaves.filter(item => item.payload.sessionId === id)
        .map(item => [item.kind, item.kind === 'minutes' ? item.payload.minutes : item.payload.report])
    }), e);
    assert.equal(exitPrepared.result.sessionDir, `/saved/${e}`);
    assert.deepEqual(exitPrepared.saves, [['minutes', '退出前已有纪要'], ['report', '退出前已有报告']]);

    await current().getByRole('tab', { name: /产品评审/ }).click();
    await current().getByRole('button', { name: '关闭 产品评审', exact: true }).click();
    await current().getByRole('button', { name: '关闭 技术讨论', exact: true }).click();
    await current().getByRole('button', { name: '关闭 会议 3', exact: true }).click();
    await current().getByRole('button', { name: '关闭 连续会议待回写', exact: true }).click();
    assert.equal(await page.evaluate(() => [...window.meetingWorkspace.sessions.items.values()].filter(s => s.open).length), 1);
    assert.equal(await current().locator('#transcript-editor').inputValue(), '退出前最终稿。');

    // Safe exit: include a recently closed meeting, stop active recording, wait for final text,
    // persist sequentially, and approve exactly once after every save resolves.
    await page.reload();
    await page.waitForFunction(() => window.meetingWorkspace?.sessions.items.size === 1);
    const closedId = await page.evaluate(() => window.meetingWorkspace.sessions.activeId);
    await current().locator('#meeting-title').fill('最近关闭待保存');
    await current().locator('#meeting-title').press('Tab');
    await current().locator('[data-stage="transcript"]').click();
    await current().locator('#transcript-editor').fill('最近关闭会议的未保存原文');
    await current().getByRole('button', { name: '关闭 最近关闭待保存', exact: true }).click();
    const activeId = await page.evaluate(() => window.meetingWorkspace.sessions.activeId);
    await current().locator('#meeting-title').fill('退出时录音中');
    await current().locator('#meeting-title').press('Tab');
    await current().locator('#btn-start').click();
    await page.waitForFunction(id => window.meetingWorkspace.sessions.get(id).trainer.isRecording, activeId);
    await page.evaluate(id => window.meetingWorkspace.sessions.get(id).trainer.handleASRResult({ text: '退出时的实时稿。', isFinal: true }), activeId);
    await page.evaluate(() => {
      for (const request of window.testState.exitRequests) request();
    });
    assert.equal(await page.locator('#exit-modal').isVisible(), true);
    assert.match(await page.locator('#exit-progress').innerText(), /最近关闭待保存/);
    assert.match(await page.locator('#exit-progress').innerText(), /退出时录音中/);
    await page.locator('#btn-exit-save').click();
    await page.waitForFunction(id => window.testState.saves.some(item => item.sessionId === id), closedId);
    assert.equal(await page.evaluate(() => window.testState.exitApproved), 0);
    await page.evaluate(id => window.testState.pendingSaves[id]({
      success: true, sessionDir: `/saved/${id}`, transcriptPath: `/saved/${id}/transcript.md`
    }), closedId);
    await page.waitForFunction(id => {
      const trainer = window.meetingWorkspace.sessions.get(id).trainer;
      return !trainer.isRecording && trainer.awaitingFinalTranscript;
    }, activeId);
    assert.equal(await page.evaluate(() => window.testState.exitApproved), 0);
    await page.evaluate(async id => {
      await Promise.all(window.testState.finals.map(cb => cb({
        sessionId: id, finalText: '退出时最终稿。', speakerSegments: []
      })));
    }, activeId);
    await page.waitForFunction(id => window.testState.saves.some(item => item.sessionId === id), activeId);
    assert.equal(await page.evaluate(() => window.testState.exitApproved), 0);
    await page.evaluate(id => window.testState.pendingSaves[id]({
      success: true, sessionDir: `/saved/${id}`, transcriptPath: `/saved/${id}/transcript.md`
    }), activeId);
    await page.waitForFunction(() => window.testState.exitApproved === 1);
    assert.equal(await page.locator('#exit-progress').getByText('已保存', { exact: true }).count(), 2);

    // A failed save keeps the app open and can resume from the failed meeting.
    await page.reload();
    await page.waitForFunction(() => window.meetingWorkspace?.sessions.items.size === 1);
    const failedId = await page.evaluate(() => window.meetingWorkspace.sessions.activeId);
    await current().locator('[data-stage="transcript"]').click();
    await current().locator('#transcript-editor').fill('需要重试保存的原文');
    await page.evaluate(() => {
      window.testState.failNextSave = true;
      for (const request of window.testState.exitRequests) request();
    });
    await page.locator('#btn-exit-save').click();
    await page.waitForFunction(() => !document.getElementById('exit-error').classList.contains('hidden'));
    assert.match(await page.locator('#exit-error').innerText(), /测试保存失败/);
    assert.match(await page.locator('#exit-progress').innerText(), /失败/);
    assert.equal(await page.evaluate(() => window.testState.exitApproved), 0);
    assert.equal(await page.locator('#btn-exit-save').innerText(), '重试保存');
    await page.locator('#btn-exit-save').click();
    await page.waitForFunction(id => window.testState.saves.filter(item => item.sessionId === id).length === 2, failedId);
    await page.evaluate(id => window.testState.pendingSaves[id]({
      success: true, sessionDir: `/saved/${id}`, transcriptPath: `/saved/${id}/transcript.md`
    }), failedId);
    await page.waitForFunction(() => window.testState.exitApproved === 1);

    // A final-transcript failure exposes an explicit realtime fallback; it never auto-discards.
    await page.reload();
    await page.waitForFunction(() => window.meetingWorkspace?.sessions.items.size === 1);
    const fallbackId = await page.evaluate(() => window.meetingWorkspace.sessions.activeId);
    await current().locator('#btn-start').click();
    await page.waitForFunction(id => window.meetingWorkspace.sessions.get(id).trainer.isRecording, fallbackId);
    await page.evaluate(id => window.meetingWorkspace.sessions.get(id).trainer.handleASRResult({ text: '可降级保存的实时稿。', isFinal: true }), fallbackId);
    await page.evaluate(() => window.testState.exitRequests.forEach(request => request()));
    await page.locator('#btn-exit-save').click();
    await page.waitForFunction(id => window.meetingWorkspace.sessions.get(id).trainer.awaitingFinalTranscript, fallbackId);
    await page.evaluate(async id => {
      await Promise.all(window.testState.finals.map(cb => cb({ sessionId: id, finalTextError: '最终稿测试失败' })));
    }, fallbackId);
    await page.waitForFunction(() => !document.getElementById('exit-fallback-actions').classList.contains('hidden'));
    assert.equal(await page.evaluate(() => window.testState.exitApproved), 0);
    await page.locator('#btn-exit-save-realtime').click();
    await page.waitForFunction(id => window.testState.saves.some(item => item.sessionId === id), fallbackId);
    await page.evaluate(id => window.testState.pendingSaves[id]({
      success: true, sessionDir: `/saved/${id}`, transcriptPath: `/saved/${id}/transcript.md`
    }), fallbackId);
    await page.waitForFunction(() => window.testState.exitApproved === 1);

    // The same failure can instead retry Qwen and resume saving from that meeting.
    await page.reload();
    await page.waitForFunction(() => window.meetingWorkspace?.sessions.items.size === 1);
    const retryId = await page.evaluate(() => window.meetingWorkspace.sessions.activeId);
    await current().locator('#btn-start').click();
    await page.waitForFunction(id => window.meetingWorkspace.sessions.get(id).trainer.isRecording, retryId);
    await page.evaluate(id => {
      window.meetingWorkspace.sessions.get(id).trainer.handleASRResult({ text: '重试前实时稿。', isFinal: true });
      window.testState.retryResult = {
        success: true,
        transcription: {
          text: '重试得到的最终稿。',
          speaker_count: 1,
          speaker_segments: [{ speaker: '说话人 1', start: 0, end: 1, text: '重试得到的最终稿。' }]
        }
      };
      window.testState.exitRequests.forEach(request => request());
    }, retryId);
    await page.locator('#btn-exit-save').click();
    await page.waitForFunction(id => window.meetingWorkspace.sessions.get(id).trainer.awaitingFinalTranscript, retryId);
    await page.evaluate(async id => {
      await Promise.all(window.testState.finals.map(cb => cb({ sessionId: id, finalTextError: '首次最终稿失败' })));
    }, retryId);
    await page.waitForFunction(() => !document.getElementById('exit-fallback-actions').classList.contains('hidden'));
    await page.locator('#btn-exit-retry-final').click();
    await page.waitForFunction(id => window.testState.saves.some(item => item.sessionId === id), retryId);
    assert.equal(await page.evaluate(() => window.testState.retryCalls), 1);
    assert.equal(await page.evaluate(id => window.meetingWorkspace.sessions.get(id).trainer.fullText, retryId), '重试得到的最终稿。');
    await page.evaluate(id => window.testState.pendingSaves[id]({
      success: true, sessionDir: `/saved/${id}`, transcriptPath: `/saved/${id}/transcript.md`
    }), retryId);
    await page.waitForFunction(() => window.testState.exitApproved === 1);

    // Destructive exit always requires a second explicit click.
    await page.reload();
    await page.waitForFunction(() => window.meetingWorkspace?.sessions.items.size === 1);
    await current().locator('[data-stage="transcript"]').click();
    await current().locator('#transcript-editor').fill('将被明确放弃的内容');
    await page.evaluate(() => window.testState.exitRequests.forEach(request => request()));
    assert.equal(await current().locator('#transcript-editor').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#exit-modal').isVisible(), false);
    assert.equal(await current().locator('#transcript-editor').isEnabled(), true);
    assert.equal(await page.evaluate(() => window.testState.exitCancelled), 1);
    await page.evaluate(() => window.testState.exitRequests.forEach(request => request()));
    await page.locator('#btn-exit-discard').click();
    assert.equal(await page.evaluate(() => window.testState.forceExit), 0);
    assert.equal(await page.locator('#btn-exit-discard').innerText(), '确认放弃并退出');
    await page.locator('#btn-exit-discard').click();
    await page.waitForFunction(() => window.testState.forceExit === 1);

    assert.deepEqual(errors, []);
    console.log('Browser checks passed: recording ownership, close/reopen, out-of-order finalization, edited export, pending save/report, final transcript artifact refresh, complete exit preparation, safe exit, retry, realtime fallback, destructive confirmation, desktop/mobile, new recording preserves old meeting, edit/final conflict, close last tab.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
