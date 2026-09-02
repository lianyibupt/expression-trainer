# Meeting Minutes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent formal meeting-minutes stage after the transcript stage, with fixed Markdown structure, long-text handling, copy/save actions, and session-folder persistence.

**Architecture:** Keep real-time ASR and expression report behavior unchanged. Add a dedicated minutes prompt and AI module method, expose generation and persistence through Electron IPC, then add a renderer stage that reads the current transcript editor value. Long transcripts are summarized in bounded chunks before a final structured minutes request; failures preserve the transcript and any previous minutes.

**Tech Stack:** Electron, CommonJS Node.js, renderer-side vanilla JavaScript, Markdown prompts, Node test runner, existing provider abstraction.

---

### Task 1: Add fixed minutes prompt contract

**Files:**
- Modify: `lib/prompts.js`
- Modify: `lib/ai-feedback.js`
- Test: `test/meeting-minutes.test.js`

- [ ] **Step 1: Write failing prompt tests**

Add tests that import the new prompt helper and assert the system prompt contains the exact required headings and table columns:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { getMeetingMinutesPrompt } = require('../lib/prompts');

test('meeting minutes prompt requires the fixed formal structure', () => {
  const prompt = getMeetingMinutesPrompt('说话人 1：我们决定下周发布。', {});

  assert.match(prompt.system, /# 会议纪要/);
  assert.match(prompt.system, /## 会议主题/);
  assert.match(prompt.system, /## 核心结论/);
  assert.match(prompt.system, /## 讨论要点/);
  assert.match(prompt.system, /## 决策事项/);
  assert.match(prompt.system, /\| 决策 \| 依据 \| 影响 \|/);
  assert.match(prompt.system, /\| 待办事项 \| 负责人 \| 截止时间 \| 状态 \|/);
  assert.match(prompt.system, /未明确/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test test/meeting-minutes.test.js
```

Expected: FAIL because `getMeetingMinutesPrompt` is not defined.

- [ ] **Step 3: Implement the prompt helper**

Add `getMeetingMinutesPrompt(fullText, options)` in `lib/prompts.js`. Its system content must require exactly these sections:

```text
# 会议纪要
## 会议主题
## 核心结论
## 讨论要点
## 决策事项
| 决策 | 依据 | 影响 |
|------|------|------|
## 待办事项
| 待办事项 | 负责人 | 截止时间 | 状态 |
|----------|------|------|------|
## 风险与未决问题
## 下一步行动
```

The prompt must state that missing information is `未明确`, empty sections use `暂无明确内容`, speaker labels remain anonymous, and the model must not invent owners, dates, decisions, or impact. Include the transcript in the user message.

- [ ] **Step 4: Add the AI module entry point**

In `lib/ai-feedback.js`, import `getMeetingMinutesPrompt` and add:

```js
async function sendMeetingMinutes(fullText, stats, settings, customPrompt) {
  const config = getProviderConfig(settings);
  const prompt = getMeetingMinutesPrompt(fullText, stats, customPrompt);
  return callAPI(config.endpoint, config.apiKey, config.model, [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ], 8192);
}
```

Export `sendMeetingMinutes`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test test/meeting-minutes.test.js
```

Expected: PASS.

### Task 2: Add bounded long-text minutes generation

**Files:**
- Modify: `lib/ai-feedback.js`
- Modify: `main.js`
- Modify: `preload.js`
- Test: `test/meeting-minutes.test.js`

- [ ] **Step 1: Write failing long-text and IPC contract tests**

Add pure helper tests for an exported `splitMeetingText` function:

```js
const { splitMeetingText } = require('../lib/ai-feedback');

test('splitMeetingText keeps chunks under the configured character limit', () => {
  const chunks = splitMeetingText('甲'.repeat(2500), 1000);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every(chunk => chunk.length <= 1000));
});
```

Add a prompt-level test that summary chunks are labeled as intermediate material and final output must use the fixed structure. Keep provider-network tests out of the unit suite; generation orchestration will be tested with a dependency-injected callback if the helper is extracted.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test test/meeting-minutes.test.js
```

Expected: FAIL because `splitMeetingText` is not exported.

- [ ] **Step 3: Implement bounded splitting and extend generation**

Add a conservative `MEETING_MINUTES_CHUNK_CHARS` constant, defaulting to `12000`. Split preferentially on blank lines, then Chinese sentence punctuation, then hard boundaries. Extend the `sendMeetingMinutes` function created in Task 1 with this behavior rather than defining a second function:

```js
async function sendMeetingMinutes(fullText, stats, settings, customPrompt) {
  const chunks = splitMeetingText(fullText, MEETING_MINUTES_CHUNK_CHARS);
  if (chunks.length === 1) return sendMinutesRequest(chunks[0], stats, settings, customPrompt);

  const summaries = [];
  for (const chunk of chunks) {
    summaries.push(await sendMinutesChunkSummary(chunk, settings, customPrompt));
  }
  return sendMinutesRequest(summaries.join('\n\n'), stats, settings, customPrompt);
}
```

The chunk-summary prompt must extract only factual topics, conclusions, decisions, action items, risks, and unresolved questions. It must not invent missing owners or deadlines. Keep the final prompt responsible for the exact Markdown structure.

- [ ] **Step 4: Add Electron IPC**

In `main.js`, import `sendMeetingMinutes`, add an `ipcMain.handle('get-meeting-minutes', ...)` handler that loads settings/provider/custom prompt and returns `{ success: true, minutes }` or `{ success: false, error }`.

In `preload.js`, expose:

```js
getMeetingMinutes: (data) => ipcRenderer.invoke('get-meeting-minutes', data)
```

- [ ] **Step 5: Run tests and syntax checks**

Run:

```bash
node --test test/meeting-minutes.test.js
node --check lib/ai-feedback.js
node --check main.js
node --check preload.js
```

Expected: all pass.

### Task 3: Persist minutes in meeting sessions

**Files:**
- Modify: `lib/meeting-session.js`
- Modify: `main.js`
- Modify: `preload.js`
- Test: `test/meeting-session.test.js`

- [ ] **Step 1: Write the failing persistence test**

Add a test that creates a transcript session, calls `saveMeetingMinutes`, then asserts `minutes.md` exists and metadata contains:

```js
assert.equal(result.minutesPath.endsWith('/minutes.md'), true);
assert.equal(metadata.files.minutes, 'minutes.md');
```

Call the function a second time and assert the same session path is reused and the file content is replaced.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test test/meeting-session.test.js
```

Expected: FAIL because the minutes persistence function does not exist.

- [ ] **Step 3: Implement `saveMinutesArtifact`**

In `lib/meeting-session.js`, add:

```js
function saveMinutesArtifact({ sessionDir, now = new Date(), transcript, minutes, stats = {} }) {
  if (!sessionDir) throw new Error('sessionDir is required');
  const minutesPath = path.join(sessionDir, 'minutes.md');
  const cleanMinutes = String(minutes || '').trim();
  fs.writeFileSync(minutesPath, cleanMinutes + '\n', 'utf8');

  const metadataPath = path.join(sessionDir, 'metadata.json');
  const metadata = fs.existsSync(metadataPath)
    ? JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    : { createdAt: now.toISOString(), stats, files: {} };
  metadata.stats = stats;
  metadata.files = { ...(metadata.files || {}), minutes: 'minutes.md' };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  return { sessionDir, minutesPath, metadataPath };
}
```

Export it without changing existing transcript/report behavior.

- [ ] **Step 4: Add the main-process handler**

Add `ipcMain.handle('save-meeting-minutes', ...)` in `main.js`, import `saveMinutesArtifact`, and expose `saveMeetingMinutes` in `preload.js`.

- [ ] **Step 5: Run focused and full tests**

Run:

```bash
node --test test/meeting-session.test.js
npm test
```

Expected: all pass.

### Task 4: Add the independent renderer stage

**Files:**
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Modify: `src/app.js`

- [ ] **Step 1: Add the renderer contract check**

Add `test/meeting-minutes-ui.test.js` that reads `src/index.html` with `fs.readFileSync` and asserts the required stage and DOM ids exist. The required DOM ids are:

```text
data-stage="minutes"
data-panel="minutes"
btn-generate-minutes
btn-copy-minutes
btn-save-minutes
minutes-body
```

The test must fail before the markup is added because the new stage and ids do not exist.

- [ ] **Step 2: Add the stage markup**

Insert “会议纪要” after “会议原文”, renumbering later labels. Add a `stage-panel` with:

```html
<section class="stage-panel" data-panel="minutes">
  <div class="panel-heading">
    <div>
      <p class="panel-eyebrow">Minutes</p>
      <h2>会议纪要</h2>
    </div>
    <div class="stage-actions">
      <button id="btn-copy-minutes" class="btn-sm hidden">复制全文</button>
      <button id="btn-save-minutes" class="btn-sm hidden">保存</button>
      <button id="btn-generate-minutes" class="btn-primary">生成纪要</button>
    </div>
  </div>
  <div id="minutes-body" class="report-body">
    <p class="empty-state">完成录音或粘贴原文后，可以在这里生成正式会议纪要。</p>
  </div>
</section>
```

- [ ] **Step 3: Add renderer state and event handlers**

In `src/app.js`, add `lastMinutes`, `minutesBody`, `btnGenerateMinutes`, `btnCopyMinutes`, and `btnSaveMinutes` to element initialization. Bind the generate, copy, and save actions. Add `generateMinutes()` that:

1. Reads `transcriptEditor.value.trim()`.
2. If empty, switches to `transcript`, focuses the editor, and adds a feedback message.
3. Sets stage status to `生成纪要中` and shows an inline loading state.
4. Calls `window.api.getMeetingMinutes({ fullText: text, stats: this.stats })`.
5. On success, stores `lastMinutes`, renders Markdown, reveals copy/save buttons, and sets status to `纪要已生成`.
6. On failure, keeps the previous body if available or shows an error and sets status to `纪要生成失败`.

Use the same restricted Markdown rendering approach already used by `renderReport`; do not add a new frontend dependency.

- [ ] **Step 4: Add standalone saving**

Implement `saveMinutes()` using `window.api.saveFile`, filename `会议纪要-YYYY-MM-DD-HHmm.md`, and keep the body unchanged if the dialog is canceled or saving fails.

- [ ] **Step 5: Add session-folder saving**

When `meetingSession.sessionDir` exists and automatic artifact saving is enabled, call `window.api.saveMeetingMinutes` after generation. Report this in the existing feedback stream. Do not create a new session directory from the minutes path.

- [ ] **Step 6: Style and verify the stage**

Add only the required spacing/button styles; reuse `.report-body`, `.stage-panel`, `.panel-heading`, and existing button classes. Run:

```bash
node --check src/app.js
npm test
```

### Task 5: Final integration verification

**Files:**
- Modify: `README.md` only if the run instructions need the new feature documented.
- Test: `test/meeting-minutes.test.js`, `test/meeting-session.test.js`

- [ ] **Step 1: Test the fixed prompt and persistence together**

Run:

```bash
node --test test/meeting-minutes.test.js test/meeting-session.test.js
```

Expected: all focused tests pass.

- [ ] **Step 2: Run the complete verification set**

Run:

```bash
python3 -m py_compile scripts/qwen3_asr_worker.py
node --check lib/ai-feedback.js
node --check lib/meeting-session.js
node --check main.js
node --check preload.js
node --check src/app.js
node --check src/settings.js
npm test
npm run check:qwen3-asr
```

Expected: no syntax errors, all Node tests pass, and Qwen3 dependency check returns `ok: true`.

- [ ] **Step 3: Manual Electron smoke test**

Run `npm start` and verify:

1. “会议纪要” appears after “会议原文”.
2. Empty state redirects to the transcript editor.
3. Pasted transcript generates the exact fixed headings and tables.
4. Copy and standalone save do not alter the transcript.
5. Saved meeting sessions contain `transcript.md`, `minutes.md`, and later `report.md` when those operations are used.
6. A failed AI request preserves the previous minutes content.
