# Safe Meeting Exit and Complete Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent application exit from losing meeting data by stopping active recording, waiting for the Qwen3 final transcript, saving every meeting's existing artifacts, and exiting only after all saves succeed.

**Architecture:** Electron's main process owns a small exit gate that intercepts every quit path and asks the renderer for a decision. A renderer-side `MeetingWorkspace` coordinator scans every session, including recently closed tabs, then delegates stop/wait/save work to each `ExpressionTrainer`; pure state helpers keep dirty detection testable. Existing transcript, audio, minutes, and report persistence APIs remain the only code that writes meeting content.

**Tech Stack:** Electron 33, browser JavaScript, Node.js `node:test`, existing Playwright browser harness, existing local artifact IPC.

---

## File map

- Create `lib/meeting-exit.js`: pure dirty-state classification and summary helpers shared by Node tests and the renderer.
- Create `test/meeting-exit.test.js`: unit tests for dirty classification, saved artifact revisions, closed sessions, and exit summaries.
- Create `lib/app-exit-gate.js`: pure main-process state machine preventing duplicate or premature exits.
- Create `test/app-exit-gate.test.js`: unit tests for `idle → awaiting-renderer → approved` transitions.
- Modify `main.js`: intercept main-window close and app quit; wire renderer approval/forced-exit IPC.
- Modify `preload.js`: expose minimal exit request subscription and approval methods.
- Modify `src/index.html`: load the pure exit helper and add one global exit modal outside per-session shadow roots.
- Modify `src/styles.css`: style exit confirmation, progress, failure choices, and destructive confirmation.
- Modify `src/app.js`: track artifact save snapshots; expose stop/wait/retry/save-existing-artifacts operations for one session.
- Modify `src/workspace.js`: coordinate the multi-session exit workflow and lock mutating controls while exiting.
- Modify `test/meeting-workspace.browser.js`: exercise active recording, pending final transcript, recently closed sessions, failures, retry, and single exit approval.
- Modify `README.md`: document safe-exit behavior and anonymous post-meeting speaker clustering.

### Task 1: Pure meeting dirty-state model

**Files:**
- Create: `lib/meeting-exit.js`
- Create: `test/meeting-exit.test.js`
- Modify: `src/index.html`

- [ ] **Step 1: Write failing dirty-state tests**

Create `test/meeting-exit.test.js` with explicit cases for blank, recording, pending-final, first save, post-save edits, generated artifacts, and closed sessions:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const { describeMeetingExitState, collectPendingMeetings } = require('../lib/meeting-exit');

function trainer(overrides = {}) {
  return {
    isRecording: false,
    isStoppingRecording: false,
    awaitingFinalTranscript: false,
    savePromise: null,
    fullText: '',
    transcriptRevision: 0,
    transcriptSource: 'realtime',
    pendingAudioPath: '',
    speakerSegments: [],
    lastMinutes: '',
    lastReport: '',
    savedSnapshot: null,
    savedArtifacts: { minutes: '', report: '' },
    ...overrides
  };
}

test('blank meeting is safe while recording and pending final are not', () => {
  const session = { id: 'a', title: 'A', open: true };
  assert.equal(describeMeetingExitState(session, trainer()).pending, false);
  assert.equal(describeMeetingExitState(session, trainer({ isRecording: true })).reason, 'recording');
  assert.equal(describeMeetingExitState(session, trainer({ awaitingFinalTranscript: true })).reason, 'finalizing');
});

test('content and generated artifacts remain pending until their exact revisions are saved', () => {
  const session = { id: 'a', title: 'A', open: false };
  const state = trainer({ fullText: '原文', transcriptRevision: 2, lastMinutes: '纪要', lastReport: '报告' });
  assert.deepEqual(describeMeetingExitState(session, state).artifacts, ['transcript', 'minutes', 'report']);
  state.savedSnapshot = { title: 'A', transcriptRevision: 2, transcriptSource: 'realtime' };
  state.savedArtifacts = { minutes: '纪要', report: '报告' };
  assert.equal(describeMeetingExitState(session, state).pending, false);
  state.transcriptRevision = 3;
  assert.equal(describeMeetingExitState(session, state).pending, true);
});

test('collector includes recently closed sessions', () => {
  const sessions = [{ id: 'open', title: 'Open', open: true, trainer: trainer() },
    { id: 'closed', title: 'Closed', open: false, trainer: trainer({ fullText: '未保存' }) }];
  assert.deepEqual(collectPendingMeetings(sessions).map(item => item.id), ['closed']);
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `node --test test/meeting-exit.test.js`

Expected: FAIL with `Cannot find module '../lib/meeting-exit'`.

- [ ] **Step 3: Implement the pure state model**

Create a UMD-style `lib/meeting-exit.js` so Node tests and `src/index.html` can use the same functions. Compare title/revision/source for transcripts and exact generated text for minutes/report:

```js
(function (root) {
  function describeMeetingExitState(session, trainer) {
    if (trainer.isRecording || trainer.isStoppingRecording) return { id: session.id, title: session.title, pending: true, reason: 'recording', artifacts: [] };
    if (trainer.awaitingFinalTranscript) return { id: session.id, title: session.title, pending: true, reason: 'finalizing', artifacts: [] };
    if (trainer.savePromise) return { id: session.id, title: session.title, pending: true, reason: 'saving', artifacts: [] };

    const artifacts = [];
    const hasTranscriptMaterial = Boolean(String(trainer.fullText || '').trim() || trainer.pendingAudioPath || trainer.speakerSegments?.length);
    const transcriptSaved = trainer.savedSnapshot &&
      trainer.savedSnapshot.title === session.title &&
      trainer.savedSnapshot.transcriptRevision === trainer.transcriptRevision &&
      trainer.savedSnapshot.transcriptSource === trainer.transcriptSource;
    if (hasTranscriptMaterial && !transcriptSaved) artifacts.push('transcript');
    if (trainer.lastMinutes && trainer.savedArtifacts?.minutes !== trainer.lastMinutes) artifacts.push('minutes');
    if (trainer.lastReport && trainer.savedArtifacts?.report !== trainer.lastReport) artifacts.push('report');
    return { id: session.id, title: session.title, pending: artifacts.length > 0, reason: artifacts.length ? 'unsaved' : 'clean', artifacts };
  }

  function collectPendingMeetings(sessions) {
    return sessions.map(session => describeMeetingExitState(session, session.trainer)).filter(item => item.pending);
  }

  const exports = { describeMeetingExitState, collectPendingMeetings };
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else Object.assign(root, exports);
})(globalThis);
```

Load it before `meeting-sessions.js`:

```html
<script src="../lib/meeting-exit.js"></script>
<script src="meeting-sessions.js"></script>
```

- [ ] **Step 4: Run focused and existing session tests**

Run: `node --test test/meeting-exit.test.js test/meeting-sessions.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit the pure state model**

```bash
git add lib/meeting-exit.js test/meeting-exit.test.js src/index.html
git commit -m "feat: classify unsaved meeting state"
```

### Task 2: Main-process exit gate and IPC

**Files:**
- Create: `lib/app-exit-gate.js`
- Create: `test/app-exit-gate.test.js`
- Modify: `main.js`
- Modify: `preload.js`

- [ ] **Step 1: Write failing state-machine tests**

Create `test/app-exit-gate.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const { AppExitGate } = require('../lib/app-exit-gate');

test('exit gate emits one renderer request and blocks until approved', () => {
  let requests = 0;
  const gate = new AppExitGate(() => { requests += 1; });
  assert.equal(gate.request(), false);
  assert.equal(gate.request(), false);
  assert.equal(requests, 1);
  gate.approve();
  assert.equal(gate.request(), true);
});

test('cancel returns the gate to idle', () => {
  let requests = 0;
  const gate = new AppExitGate(() => { requests += 1; });
  gate.request();
  gate.cancel();
  gate.request();
  assert.equal(requests, 2);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/app-exit-gate.test.js`

Expected: FAIL because `lib/app-exit-gate.js` does not exist.

- [ ] **Step 3: Implement the exit gate**

Create `lib/app-exit-gate.js`:

```js
class AppExitGate {
  constructor(notifyRenderer) { this.notifyRenderer = notifyRenderer; this.state = 'idle'; }
  request() {
    if (this.state === 'approved') return true;
    if (this.state === 'idle') { this.state = 'awaiting-renderer'; this.notifyRenderer(); }
    return false;
  }
  approve() { this.state = 'approved'; }
  cancel() { if (this.state !== 'approved') this.state = 'idle'; }
}
module.exports = { AppExitGate };
```

- [ ] **Step 4: Wire every Electron quit path**

In `main.js`, create one gate after the main window exists. The close handler and `before-quit` must both call `event.preventDefault()` unless `request()` returns true. Renderer approval sets `approved` and calls `app.quit()`; cancellation resets the gate; forced exit is accepted only after renderer-side second confirmation:

```js
const { AppExitGate } = require('./lib/app-exit-gate');
let exitGate;

function requestSafeExit(event) {
  if (exitGate?.request()) return;
  event.preventDefault();
}

exitGate = new AppExitGate(() => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app-exit-requested');
});
mainWindow.on('close', requestSafeExit);

app.on('before-quit', requestSafeExit);
ipcMain.handle('cancel-app-exit', () => exitGate?.cancel());
ipcMain.handle('approve-app-exit', () => { exitGate?.approve(); app.quit(); });
ipcMain.handle('force-app-exit', () => { exitGate?.approve(); app.quit(); });
```

Remove the existing duplicate `before-quit` listener and keep `stopNativeSystemAudio()` in the approved shutdown path so an intercepted exit does not prematurely stop capture.

Expose only the required methods in `preload.js`:

```js
onAppExitRequested: callback => ipcRenderer.on('app-exit-requested', () => callback()),
approveAppExit: () => ipcRenderer.invoke('approve-app-exit'),
cancelAppExit: () => ipcRenderer.invoke('cancel-app-exit'),
forceAppExit: () => ipcRenderer.invoke('force-app-exit'),
```

- [ ] **Step 5: Run the gate tests and syntax checks**

Run: `node --test test/app-exit-gate.test.js && node --check main.js && node --check preload.js`

Expected: tests PASS and both syntax checks exit 0.

- [ ] **Step 6: Commit main-process protection**

```bash
git add lib/app-exit-gate.js test/app-exit-gate.test.js main.js preload.js
git commit -m "feat: gate application exit on renderer approval"
```

### Task 3: Single-session stop, finalization, and complete artifact save

**Files:**
- Modify: `src/app.js`
- Modify: `src/meeting-sessions.js`
- Modify: `test/meeting-sessions.test.js`

- [ ] **Step 1: Extend save snapshots and write a failing snapshot test**

Update the existing snapshot test to require generated artifacts to be captured without mutation:

```js
const snapshot = createSaveSnapshot(session, trainer);
assert.equal(snapshot.minutes, '现有纪要');
assert.equal(snapshot.report, '现有报告');
assert.notEqual(snapshot.speakerSegments, trainer.speakerSegments);
```

Add `minutes` and `report` to `createSaveSnapshot()`:

```js
minutes: trainer.lastMinutes || '',
report: trainer.lastReport || '',
```

Also extend the test with an audio-only snapshot so exit persistence cannot reject a recording merely because ASR returned no text.

- [ ] **Step 2: Run the snapshot test red, then green**

Run before implementation: `node --test test/meeting-sessions.test.js`

Expected before: FAIL because snapshot fields are missing. Expected after: PASS.

- [ ] **Step 3: Make final transcript completion awaitable**

In `ExpressionTrainer`, maintain one deferred result whenever `stopRecording()` receives `finalTextPending`. Resolve it from every terminal branch in `bindASRFinalEvents()`:

```js
createFinalTranscriptWaiter() {
  if (this.finalTranscriptWaiter) return this.finalTranscriptWaiter.promise;
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  this.finalTranscriptWaiter = { promise, resolve };
  return promise;
}

finishFinalTranscriptWaiter(result) {
  this.finalTranscriptWaiter?.resolve(result);
  this.finalTranscriptWaiter = null;
}

async waitForFinalTranscript() {
  if (!this.awaitingFinalTranscript) return { success: true, source: this.transcriptSource };
  return this.createFinalTranscriptWaiter();
}
```

Call `createFinalTranscriptWaiter()` as soon as pending finalization is reported. Resolve success with the received result; resolve failure as `{ success: false, error, canSaveRealtime: Boolean(this.fullText.trim()) }`; resolve empty output as failure rather than silently treating it as complete.

- [ ] **Step 4: Implement retry and explicit realtime fallback**

Use the existing local `transcribeAudioFile` API and saved recording path for retry. The retry must set `awaitingFinalTranscript`, update the transcript/speaker state using the same conflict rules as the normal final event, and return a structured result:

```js
async retryFinalTranscript() {
  if (!this.pendingAudioPath) return { success: false, error: '没有可重试的录音文件' };
  const result = await this.api.transcribeAudioFile({ filePath: this.pendingAudioPath, jobId: `exit-${Date.now()}` });
  if (!result?.success || !result.transcription?.text) return { success: false, error: result?.error || '最终稿重试失败' };
  await this.applyFinalTranscriptResult({
    finalText: result.transcription.text,
    speakerSegments: result.transcription.speaker_segments || [],
    speakerCount: result.transcription.speaker_count || 0,
    recordingPath: this.pendingAudioPath
  });
  return { success: true };
}

acceptRealtimeTranscriptForExit() {
  if (!this.fullText.trim()) return { success: false, error: '没有可保存的实时稿' };
  this.awaitingFinalTranscript = false;
  this.finishFinalTranscriptWaiter({ success: true, source: 'realtime-fallback' });
  return { success: true };
}
```

Extract the existing final-result UI/state update into `applyFinalTranscriptResult()` so normal completion and retry cannot diverge.

- [ ] **Step 5: Implement complete existing-artifact saving**

Add `saveAllExistingArtifactsForExit(snapshot)` which waits for an existing save, persists the transcript/audio first, then saves already-generated minutes and report into that session directory. Update exact saved artifact values only after each corresponding IPC succeeds:

```js
async saveAllExistingArtifactsForExit(snapshot = createSaveSnapshot(this.session, this)) {
  if (this.savePromise) await this.savePromise;
  const transcriptResult = await this.saveMeetingTranscriptArtifact(snapshot, { allowAudioOnly: true });
  if (!transcriptResult?.success) return { success: false, error: transcriptResult?.error || '原文保存失败' };
  const sessionDir = transcriptResult.sessionDir;
  try {
    if (snapshot.minutes) {
      await this.saveMeetingMinutesArtifact(snapshot.minutes, snapshot, sessionDir);
      this.savedArtifacts.minutes = snapshot.minutes;
    }
    if (snapshot.report) {
      await this.saveMeetingReportArtifact(snapshot.report, snapshot, sessionDir);
      this.savedArtifacts.report = snapshot.report;
    }
    return { success: true, sessionDir };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

Extend `saveMeetingTranscriptArtifact(snapshot, options = {})` and `persistTranscriptSnapshot(snapshot, options = {})`. Keep normal manual saving's text requirement, but when `options.allowAudioOnly === true`, accept a snapshot with `snapshot.audioPath` and call `analyzeText()` only when transcript text is non-empty. This preserves the recorded WAV even when final and realtime ASR are both empty.

Initialize `this.savedArtifacts = { minutes: '', report: '' }`. Existing manual/automatic artifact saves must update the corresponding value only after success.

- [ ] **Step 6: Add the single-session safe-exit entry point**

```js
async prepareForExit() {
  if (this.isRecording || this.isStoppingRecording) {
    if (this.isRecording) await this.stopRecording({ suppressReview: true });
    while (this.isStoppingRecording) await new Promise(resolve => setTimeout(resolve, 25));
  }
  const final = await this.waitForFinalTranscript();
  if (!final.success) return { success: false, stage: 'final-transcript', ...final };
  const snapshot = createSaveSnapshot(this.session, this);
  const saved = await this.saveAllExistingArtifactsForExit(snapshot);
  return saved.success ? { success: true } : { success: false, stage: 'saving', ...saved };
}
```

Add `suppressReview` handling to `stopRecording()` so the ordinary post-recording review panel does not cover the global exit progress dialog.

- [ ] **Step 7: Run session and artifact regression tests**

Run: `node --test test/meeting-sessions.test.js test/meeting-session.test.js test/asr-jobs.test.js`

Expected: all tests PASS.

- [ ] **Step 8: Commit single-session exit preparation**

```bash
git add src/app.js src/meeting-sessions.js test/meeting-sessions.test.js
git commit -m "feat: prepare complete meeting artifacts for exit"
```

### Task 4: Workspace exit coordinator and accessible modal

**Files:**
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Modify: `src/workspace.js`
- Modify: `test/meeting-workspace.browser.js`

- [ ] **Step 1: Add failing browser scenarios**

Extend the mocked API with exit capture:

```js
window.testState.exitRequests = [];
window.testState.exitApproved = 0;
window.testState.exitCancelled = 0;
window.api.onAppExitRequested = callback => window.testState.exitRequests.push(callback);
window.api.approveAppExit = async () => { window.testState.exitApproved += 1; };
window.api.cancelAppExit = async () => { window.testState.exitCancelled += 1; };
window.api.forceAppExit = async () => { window.testState.forceExit = (window.testState.forceExit || 0) + 1; };
```

Add assertions that a pending recording opens the modal, “保存全部并退出” stops recording, waits while the final callback is outstanding, includes a closed meeting in saves, and approves exactly once only after all save promises resolve. Add a save rejection assertion proving approval remains zero and the failure row is visible.

- [ ] **Step 2: Run the browser test and verify missing exit UI**

Run: `NODE_PATH="$(npm root -g)" node test/meeting-workspace.browser.js`

Expected: FAIL because the exit subscription/modal does not exist.

- [ ] **Step 3: Add one global exit modal**

Place the modal after `#session-hosts`, outside the per-session template:

```html
<section id="exit-modal" class="exit-modal hidden" role="dialog" aria-modal="true" aria-labelledby="exit-title">
  <div class="exit-card">
    <h2 id="exit-title">退出前保存会议信息</h2>
    <p id="exit-summary"></p>
    <ul id="exit-progress" aria-live="polite"></ul>
    <p id="exit-error" class="exit-error hidden" role="alert"></p>
    <div id="exit-fallback-actions" class="hidden">
      <button id="btn-exit-retry-final" class="btn-secondary">重试最终稿</button>
      <button id="btn-exit-save-realtime" class="btn-secondary">保存现有实时稿</button>
    </div>
    <div class="exit-actions">
      <button id="btn-exit-discard" class="btn-danger-subtle">放弃未保存内容并退出</button>
      <button id="btn-exit-cancel" class="btn-secondary">取消退出</button>
      <button id="btn-exit-save" class="btn-primary">保存全部并退出</button>
    </div>
  </div>
</section>
```

Add a second-confirmation state inside the same card; the destructive button must require a subsequent explicit “确认放弃并退出” click.

- [ ] **Step 4: Implement workspace coordination**

Subscribe once in the `MeetingWorkspace` constructor. Use `collectPendingMeetings([...this.sessions.items.values()])` so closed tabs are included. The coordinator must be idempotent and sequential:

```js
async handleAppExitRequest() {
  if (this.exitState === 'saving') return;
  const pending = collectPendingMeetings([...this.sessions.items.values()]);
  if (!pending.length) return window.api.approveAppExit();
  this.exitPending = pending;
  this.renderExitModal();
}

async saveAllAndExit() {
  if (this.exitState === 'saving') return;
  this.exitState = 'saving';
  this.setExitLocked(true);
  for (const item of this.exitPending) {
    const session = this.sessions.get(item.id);
    const result = await session.trainer.prepareForExit();
    if (!result.success) return this.showExitFailure(session, result);
    this.markExitMeetingSaved(session.id);
  }
  this.exitState = 'approved';
  await window.api.approveAppExit();
}
```

On final-transcript failure, retry invokes `retryFinalTranscript()` and resumes from the same session; realtime fallback invokes `acceptRealtimeTranscriptForExit()` and resumes. On save failure, the primary button changes to “重试保存” and resumes from the failed index. Cancel hides the modal, unlocks the workspace, resets local exit state, and calls `cancelAppExit()`.

`setExitLocked(true)` disables new-session buttons and recording/content-generation actions in every session while leaving modal recovery controls enabled.

- [ ] **Step 5: Style modal and progress states**

Add fixed backdrop/card rules, visible keyboard focus, pending/success/failure row states, responsive layout, and a visually subdued destructive button. Do not use only color to communicate state; include text such as “等待最终稿”“已保存”“失败”。

- [ ] **Step 6: Run the browser test until all exit scenarios pass**

Run: `NODE_PATH="$(npm root -g)" node test/meeting-workspace.browser.js`

Expected final line includes `safe exit` and process exits 0 with no page errors.

- [ ] **Step 7: Commit the workspace flow**

```bash
git add src/index.html src/styles.css src/workspace.js test/meeting-workspace.browser.js
git commit -m "feat: save all meetings before exit"
```

### Task 5: Speaker wording, documentation, and full verification

**Files:**
- Modify: `src/settings.html`
- Modify: `README.md`
- Test: `test/*.test.js`

- [ ] **Step 1: Clarify the setting text**

Change the setting label and hint to:

```html
录音结束后按音色匿名区分说话人
```

```html
录音结束后在本机按音色聚类，并为最终原文添加“说话人 1/2”匿名标签；不会实时显示，也不会识别真实身份。
```

- [ ] **Step 2: Update README behavior and recovery guidance**

Replace the warning that unsaved data is simply lost on application exit with the new protected flow. Document that exiting during recording stops capture, waits for the final Qwen3 transcript, saves open and recently closed meetings, and stays open on failure. Keep the existing warning that speaker clustering can be wrong and requires listening verification.

- [ ] **Step 3: Run all automated Node tests**

Run: `npm test`

Expected: all `test/*.test.js` tests PASS with zero failures.

- [ ] **Step 4: Run browser integration coverage**

Run: `NODE_PATH="$(npm root -g)" node test/meeting-workspace.browser.js`

Expected: browser checks PASS with no page errors.

- [ ] **Step 5: Run static checks and inspect the diff**

Run: `node --check main.js && node --check preload.js && node --check src/app.js && node --check src/workspace.js && git diff --check && git status --short`

Expected: syntax checks exit 0, `git diff --check` prints nothing, and status contains only intended files.

- [ ] **Step 6: Perform macOS manual acceptance**

Run `npm start`, then verify all three entry points: red window close, application menu Quit, and `Command+Q`. For each, record a short meeting, leave one other meeting in “最近关闭”, trigger exit, confirm the UI waits for the final transcript, and inspect the saved session directories for `transcript.md`, `meeting.wav`, `metadata.json`, plus any pre-existing `minutes.md` and `report.md`. Simulate an unwritable save location and confirm the app remains open with a visible error.

- [ ] **Step 7: Commit documentation and final verification changes**

```bash
git add src/settings.html README.md
git commit -m "docs: explain safe exit and speaker clustering"
```

## Completion checklist

- [ ] Every normal exit entry point is gated.
- [ ] One ordinary close cannot silently discard existing meeting information.
- [ ] Active recording stops before finalization and saving.
- [ ] Qwen3 final transcript and anonymous speaker clustering complete before save, unless the user explicitly accepts realtime fallback after a failure.
- [ ] Open and recently closed sessions are both persisted.
- [ ] Existing transcript, audio, speaker segments, minutes, and report are saved without generating new LLM content.
- [ ] Any finalization or save failure keeps the application open.
- [ ] A destructive exit requires a second explicit confirmation.
- [ ] Exit approval is emitted exactly once after all saves succeed.
- [ ] Automated tests, browser checks, syntax checks, and manual macOS acceptance pass.
