# 识别结果断句补标点（v1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给引擎生成的会议文本（实时字幕、最终稿、导入转写展示）自动做"句末补标点 + 一句一行"，并提供可选的 LLM 精修按钮；粘贴与手动编辑内容不受影响，默认可用设置关闭。

**Architecture:** 纯本地规则函数收在 `lib/sentence-segment.js`（CJS，Node 单测）。引擎产物转换发生在**主进程**（`stop-asr` 的最终稿 payload/result、`transcribe-audio-file` 返回值）与**实时字幕 flush 的同步 IPC**（`segment-text`）。renderer 是浏览器脚本不能 require lib，因此一律通过 `window.api` 调用；粘贴/编辑路径不经过任何转换点。LLM 精修「AI 补标点/断句」复用润稿通道同构（prompt → executor → IPC → preload → UI 按钮，编辑稿语义）。

**Tech Stack:** Node 18+ / Electron；`lib/sentence-segment.js` CJS；测试用 `node --test test/*.test.js`（node 在 /opt/homebrew/bin，需 `export PATH="/opt/homebrew/bin:$PATH"`）。

关键事实（实现时不再重新推断）：
- 现有功能分支已合入 `main`（HEAD dfb3b03，60/60 绿）。本计划从 `main` 建新分支 `feat/transcript-segmentation`。
- `stop-asr` IPC（main.js ~530-541）：`recordingController.stop(sessionId, payload => sender.send('asr-final-result', payload))`；`payload.finalText` 与返回结果里的 `finalText` 都要转换。
- 实时 flush：`src/app.js` `flushRealtimePhraseBuffer()`（~1117-1135），当前把整段 buffer 作为一句 push/analyze/render。
- 音频展示：`src/app.js` `runAudioAnalysis(transcribe)`（~340-343）与 `renderAudioAnalysis(analysis, transcription)`（~385-411）展示 `transcription.text`。
- 「AI 修正错字」同构参考：prompts `getTranscriptPolishPrompt`、executor `sendTranscriptPolish`（lib/ai-feedback.js）、IPC `polish-transcript`、preload `polishTranscript`、app.js `polishTranscript()` 方法（generation+revision 双守卫、无变化短路、finally 无条件恢复）。

---

### Task 0: 基线

- [ ] **Step 1: 确认 main 上全量测试为绿**

```bash
git checkout main && git pull --ff-only
export PATH="/opt/homebrew/bin:$PATH"
node --test test/*.test.js
```
Expected: 60/60 pass。然后建分支并登记：
```bash
git checkout -b feat/transcript-segmentation
```

---

### Task 1: 纯本地规则模块 `lib/sentence-segment.js`

**Files:**
- Create: `lib/sentence-segment.js`
- Test: `test/sentence-segment.test.js`（新建）

- [ ] **Step 1: 写失败测试**

创建 `test/sentence-segment.test.js`：

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const { segmentLine, segmentTranscript } = require('../lib/sentence-segment');

test('unpunctuated Chinese text gets one sentence per line with terminal periods', () => {
  const input = '我们这次会议主要讨论下周的上线计划然后还要同步一下人力安排所以请大家提前准备好数据';
  const lines = segmentTranscript(input).split('\n').filter(Boolean);
  assert.ok(lines.length >= 3, `expected >=3 sentences, got ${lines.length}: ${lines.join(' | ')}`);
  for (const line of lines) assert.match(line, /[。！？!?]$/);
  // 内容无丢失：去掉句末标点后拼接 == 输入
  const content = lines.map(l => l.replace(/[。！？!?]$/, '')).join('');
  assert.equal(content, input);
});

test('already punctuated text is respected without duplicated endings', () => {
  const input = '你好。然后我们去开会吧？下周见。';
  const out = segmentTranscript(input);
  assert.equal(out.includes('你好。'), true);
  assert.equal(out.includes('下周见。'), true);
  assert.doesNotMatch(out, /。。/);
  assert.equal(out.split('\n').filter(Boolean).length >= 2, true);
});

test('English-dominant sentences end with an ASCII period', () => {
  const input = 'we need to ship this release today and tomorrow we will discuss the roadmap with the team';
  const lines = segmentTranscript(input).split('\n').filter(Boolean);
  assert.ok(lines.length >= 2);
  for (const line of lines) assert.match(line, /[.!?]$/);
});

test('mixed zh/en keeps speaker labels and blank lines and never merges lines', () => {
  const input = '说话人 1：我们先看需求然后你补充一下细节\n\n说话人 2：好的 没问题';
  const out = segmentTranscript(input);
  assert.match(out, /说话人 1：/);
  assert.match(out, /说话人 2：/);
  assert.equal(out.includes('\n\n'), true);
});

test('declarative sentences keep 。 while clear questions get ？', () => {
  const input = '你觉得这个方案整体上是可行吗我们要不要先做一个小范围的实验来验证';
  const lines = segmentTranscript(input).split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '你觉得这个方案整体上是可行吗？');
  assert.equal(lines[1], '我们要不要先做一个小范围的实验来验证。');
});

test('segmentLine returns [] for empty/whitespace input', () => {
  assert.deepEqual(segmentLine('   '), []);
  assert.deepEqual(segmentLine(''), []);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/sentence-segment.test.js
```
Expected: FAIL（`Cannot find module '../lib/sentence-segment'`）。

- [ ] **Step 3: 实现模块**

创建 `lib/sentence-segment.js`：

```js
/**
 * 识别结果断句补标点（本地规则）。
 *
 * 目标：对无标点/少标点的引擎转写做“句末补标点 + 一句一行”。
 * 约束：只补句末标点，不插句内标点；尊重已有标点（不重复加）；
 * 保留说话人行、空行与填充词；不改写任何词语。
 * 纯函数，无 IO，Node 与浏览器规则一致（被主进程 require，规则在主进程执行）。
 */

'use strict';

const CJK_PUNCT_END = /[。！？!?]/;
// ASCII 句号切分仅当后跟空白或行尾，且前一个字符不是数字（避免 3.14）也不是单个大写字母（避免 U.S. 简写误断）
const ASCII_END_RE = /[.!?](?=\s|$)/;
const CJK_RE = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
const LATIN_WORD_RE = /[A-Za-z]+/g;

const START_MARKERS = [
  '然后', '但是', '不过', '所以', '而且', '其实', '反正', '就是', '还有',
  '再说', '另外', '如果', '因为', '只是', '可是', '比如', '比如说', '于是',
  '接着', '后来', '那么', '这样', '现在', '接下来', '首先', '其次', '最后',
  '重点', '主要', '我觉得', '我感觉', '也就是说', '换句话说'
];
const PARTICLE_STARTERS = new Set(['那', '就', '我', '我们', '你', '他', '她', '它', '大家']);
const END_PARTICLES = new Set(['吧', '吗', '呢', '啊', '呀', '哦', '噢', '嘛', '哈', '么']);
const QUESTION_RE = /(吗|呢|怎么|怎样|如何|为什么|哪些|什么|是不是|能不能|可不可以|why|what|how|whether)\s*$/i;

const DEFAULT_OPTS = { minChars: 14, maxChars: 40, maxWords: 16 };

function countCjk(text) {
  let n = 0;
  for (const ch of text) if (CJK_RE.test(ch)) n += 1;
  return n;
}

function countLatinWords(text) {
  const m = text.match(LATIN_WORD_RE);
  return m ? m.length : 0;
}

function isCjkDominant(text) {
  return countCjk(text) >= countLatinWords(text);
}

function terminalFor(text, isQuestion) {
  if (isQuestion) return '？';
  return isCjkDominant(text) ? '。' : '.';
}

function looksLikeQuestion(text) {
  return QUESTION_RE.test(text.trim());
}

/** 切分已有句末标点：返回带标点的片段数组；末段可能无标点。 */
function splitAtExistingEnds(text) {
  const parts = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    let isEnd = false;
    if (CJK_PUNCT_END.test(ch)) {
      isEnd = true;
    } else if ((ch === '.' || ch === '!' || ch === '?') && (index + 1 === text.length || /\s/.test(text[index + 1]))) {
      const prev = index > 0 ? text[index - 1] : '';
      if (!/\d/.test(prev) && !(prev >= 'A' && prev <= 'Z')) isEnd = true; // 跳过数字与单字母缩写
    }
    if (isEnd) {
      parts.push(text.slice(start, index + 1));
      start = index + 1;
    }
    index += 1;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

/** 找 [from, to) 区间内最靠后的切点：优先“语气词后”，其次“下一句起始标记前”，否则返回 -1。 */
function findLastCut(from, to, text, minChars) {
  let cut = -1;
  // 语气词：cut 落在语气词之后
  for (let i = Math.max(from + minChars - 1, from); i < to && i < text.length; i++) {
    if (END_PARTICLES.has(text[i])) cut = i + 1;
  }
  // 起始标记：cut 落在标记之前；若没有语气词切点或标记更靠后则优先标记（保“下一句”结构）
  for (let i = from + minChars; i < to && i < text.length; i++) {
    for (const marker of START_MARKERS) {
      if (text.startsWith(marker, i)) {
        if (cut === -1 || i > cut - 1) cut = i;
        break;
      }
    }
  }
  return cut;
}

/** 纯 ASCII/空格文本按词切句。 */
function segmentLatin(text, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [words.join(' ')];
  const out = [];
  let buffer = [];
  for (const word of words) {
    buffer.push(word);
    if (buffer.length >= maxWords) {
      out.push(buffer.join(' '));
      buffer = [];
    }
  }
  if (buffer.length) out.push(buffer.join(' '));
  return out;
}

/** 无句末标点行：按“语气词/起始标记 + 长度”断成若干句（不含标点）。 */
function segmentUnpunctuated(text, opts) {
  const minChars = opts.minChars;
  const maxChars = opts.maxChars;
  const cjk = isCjkDominant(text);
  if (!cjk) {
    return segmentLatin(text, opts.maxWords);
  }
  const pieces = [];
  let start = 0;
  while (start < text.length) {
    const windowEnd = Math.min(start + maxChars, text.length);
    if (windowEnd - start < minChars) {
      pieces.push(text.slice(start));
      break;
    }
    const cut = findLastCut(start, windowEnd, text, minChars);
    const end = cut > start ? cut : windowEnd;
    pieces.push(text.slice(start, end));
    start = end;
  }
  return pieces;
}

/** 断句：输入一行文本，返回若干句（每句含句末标点；已带标点的行尊重原标点）。 */
function segmentLine(line, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const text = String(line || '').trim();
  if (!text) return [];
  if (CJK_PUNCT_END.test(text)) {
    // 已有句末标点：直接按标点切分，不补不重复
    const parts = splitAtExistingEnds(text);
    const out = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (CJK_PUNCT_END.test(trimmed)) {
        out.push(trimmed);
      } else {
        // 行尾残句缺标点：按缺标点规则补全
        const ends = segmentUnpunctuated(trimmed, o);
        for (const piece of ends) {
          out.push(piece + (looksLikeQuestion(piece) ? '？' : terminalFor(piece, false)));
        }
      }
    }
    return out;
  }
  const pieces = segmentUnpunctuated(text, o);
  return pieces.map(piece => {
    const trimmed = piece.trim();
    if (!trimmed) return '';
    const question = looksLikeQuestion(trimmed);
    return trimmed + terminalFor(trimmed, question);
  }).filter(Boolean);
}

/**
 * 全文断句：按物理行处理，保留空行结构，不跨行合并；返回“一句一行”的文本。
 */
function segmentTranscript(text) {
  const source = String(text == null ? '' : text);
  const lines = source.split('\n');
  const out = [];
  for (const rawLine of lines) {
    const line = String(rawLine).trim();
    if (!line) {
      out.push('');
      continue;
    }
    const sentences = segmentLine(line);
    if (sentences.length) out.push(...sentences);
  }
  return out.join('\n');
}

module.exports = { segmentLine, segmentTranscript, DEFAULT_OPTS };
```

（规则说明：CJK 文本在“语气词之后”或“下一句起始标记之前”切，且整句 ≥ minChars，超过 maxChars 强制切；行内已有标点则直接按标点分行，仅对行尾残句补全。）

- [ ] **Step 4: 跑测试确认通过**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/sentence-segment.test.js
```
Expected: PASS（如个别断言因断点选择未命中，调整的是测试里的示例措辞而不是放宽规则，保证：内容无损、每句有尾标点、不重复标点、不跨行）。

- [ ] **Step 5: 全量回归并提交**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/*.test.js
git add lib/sentence-segment.js test/sentence-segment.test.js
git commit -m "feat: add local sentence segmentation and punctuation module"
```

---

### Task 2: 设置项 `settings.asr.autoSegment`（默认开）

**Files:**
- Modify: `src/settings.html`
- Modify: `src/settings.js`
- Modify: `settings.example.json`
- Modify: `main.js`（`DEFAULT_ASR_CONFIG`）
- Test: `test/asr-segment-settings.test.js`（新建，内容断言）

- [ ] **Step 1: 写失败测试**

创建 `test/asr-segment-settings.test.js`：

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.html'), 'utf8');
const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const example = fs.readFileSync(path.join(__dirname, '..', 'settings.example.json'), 'utf8');

test('settings page exposes the auto-segment toggle', () => {
  assert.match(html, /id="auto-segment"/);
  assert.match(html, /自动断句补标点/);
});

test('settings page loads and saves the auto-segment field', () => {
  assert.match(settings, /autoSegmentInput = document\.getElementById\('auto-segment'\)/);
  assert.match(settings, /autoSegment: this\.autoSegmentInput\.checked/);
  assert.match(settings, /asr\.autoSegment !== false/);
});

test('default asr config and example json enable auto segmentation', () => {
  assert.match(main, /autoSegment: true/);
  assert.match(example, /autoSegment/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/asr-segment-settings.test.js
```
Expected: FAIL（字段不存在）。

- [ ] **Step 3: 实现**

(3a) `src/settings.html`：在「会议录音」节里 `speaker-diarization` checkbox 块之后（该块含 hint div，位于 `#group-qwen3-path` 关闭之后、`meeting-output-dir` 之前）插入：

```html
      <label class="checkbox-row">
        <input type="checkbox" id="auto-segment" checked>
        识别结果自动断句补标点
      </label>
      <div class="hint" style="margin:-5px 0 14px 28px;">对实时字幕、最终稿与导入转写自动补句末标点并按句分行；只作用于识别结果，不会改写你粘贴或手动编辑的内容。</div>
```

(3b) `src/settings.js`：
- 构造函数在 `speakerDiarizationInput` 行后加：
```js
    this.autoSegmentInput = document.getElementById('auto-segment');
```
- `loadMeetingFields()` 在 `speakerDiarizationInput.checked = asr.speakerDiarization !== false;` 后加：
```js
    this.autoSegmentInput.checked = asr.autoSegment !== false;
```
- `save()` 的 `settings.asr = {...}` 在 `qwen3Language` 行后加：
```js
      autoSegment: this.autoSegmentInput.checked,
```

(3c) `settings.example.json` 的 `asr` 对象加：`"autoSegment": true`。

(3d) `main.js` 的 `DEFAULT_ASR_CONFIG`（asr 对象）加 `autoSegment: true`（放在 `qwen3Language` 行附近；检查该常量是否存在 `qwen3Language`，Task 前序已完成）。

- [ ] **Step 4: 跑测试确认通过**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/asr-segment-settings.test.js
```
Expected: PASS。再跑全量 `node --test test/*.test.js`，Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add src/settings.html src/settings.js settings.example.json main.js test/asr-segment-settings.test.js
git commit -m "feat: add auto-segment setting (default on)"
```

---

### Task 3: 主进程转换点 + `segment-text` 通道

**Files:**
- Modify: `main.js`
- Modify: `preload.js`
- Test: `test/segment-ipc.test.js`（新建，内容断言）

- [ ] **Step 1: 写失败测试**

创建 `test/segment-ipc.test.js`：

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

test('main transforms final transcript text with the auto-segment rule', () => {
  assert.match(main, /require\('\.\/lib\/sentence-segment'\)/);
  assert.match(main, /applyAutoSegmentText/);
  assert.match(main, /ipcMain\.handle\('segment-text'/);
  assert.match(main, /payload\.finalText = applyAutoSegmentText\(payload\.finalText\)/);
});

test('preload exposes segmentText', () => {
  assert.match(preload, /segmentText: \(text\) => ipcRenderer\.invoke\('segment-text', \{ text \}\)/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/segment-ipc.test.js
```
Expected: FAIL。

- [ ] **Step 3: 实现**

(3a) `main.js` 顶部 require 区加：
```js
const { segmentTranscript } = require('./lib/sentence-segment');
```

(3b) 在 `getCurrentProviderSettings` 附近加主进程助手（放在任意顶层函数区即可）：
```js
function autoSegmentEnabled() {
  return loadSettings()?.asr?.autoSegment !== false;
}

function applyAutoSegmentText(text) {
  const value = String(text || '').trim();
  if (!value) return value;
  return autoSegmentEnabled() ? segmentTranscript(value) : value;
}
```

(3c) `stop-asr` handler：`recordingController.stop(sessionId, payload => { ... })` 的回调里，在 `sender.send('asr-final-result', payload)` 之前把 `payload.finalText` 转换：
```js
  const result = await recordingController.stop(sessionId, (payload) => {
    if (payload?.finalText) payload.finalText = applyAutoSegmentText(payload.finalText);
    if (!sender.isDestroyed()) {
      sender.send('asr-final-result', payload);
    }
  });
```
并在随后返回里（`return { success: true, ...result };` 前的 `result`）同样处理：在 stop 返回后加
```js
  if (typeof result === 'object' && result?.finalText) result.finalText = applyAutoSegmentText(result.finalText);
  if (typeof result === 'string') return { success: true, finalText: applyAutoSegmentText(result) };
```
（把现有一段 `if (typeof result === 'string') return { success: true, finalText: result };` 与 `return { success: true, ...result };` 相应替换。）

(3d) 新增同步 IPC（放在其他 AI/文本 handler 附近）：
```js
ipcMain.handle('segment-text', (event, { text }) => ({ success: true, text: applyAutoSegmentText(text) }));
```

(3e) `preload.js` 加：
```js
  segmentText: (text) => ipcRenderer.invoke('segment-text', { text }),
```

- [ ] **Step 4: 跑测试确认通过**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/segment-ipc.test.js
```
Expected: PASS。全量 `node --test test/*.test.js` Expected: 全绿；`node --check main.js` OK。

- [ ] **Step 5: 提交**

```bash
git add main.js preload.js test/segment-ipc.test.js
git commit -m "feat: segment engine transcripts in main and expose segment-text IPC"
```

---

### Task 4: 实时字幕 flush 断句 + 音频转写展示断句

**Files:**
- Modify: `src/app.js`
- Test: `test/segment-ui.test.js`（新建，内容断言）

- [ ] **Step 1: 写失败测试**

创建 `test/segment-ui.test.js`：

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');

test('realtime flush segments the buffered phrase into sentences', () => {
  assert.match(app, /this\.api\.segmentText\(text\)/);
  assert.match(app, /\.split\('\\n'\)/);
  assert.match(app, /autoSegment/);
});

test('audio analysis display segments the transcription text', () => {
  assert.match(app, /segmentText\(transcription\?\.text \|\| ''\)/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/segment-ui.test.js
```
Expected: FAIL。

- [ ] **Step 3: 实现**

(3a) 给 `ExpressionTrainer` 增加一个设置读取方法（放在 `getSettings()` 之后即可，若已有同名则跳过）：
```js
  autoSegmentEnabled() {
    return this.settings?.asr?.autoSegment !== false;
  }
```

(3b) 重写 `flushRealtimePhraseBuffer()`（现 ~1117-1135）。原实现先取 `const text = this.realtimePhraseBuffer.trim(); if (!text) return;`，随后把整个 text 作为一句 push。改为先按开关断句、逐句落库/分析/渲染：

```js
  async flushRealtimePhraseBuffer() {
    const text = this.realtimePhraseBuffer.trim();
    if (!text) return;

    this.realtimePhraseBuffer = '';
    this.realtimePhraseLastAt = 0;

    let sentences = [text];
    if (this.autoSegmentEnabled()) {
      const segmented = await this.api.segmentText(text);
      if (segmented?.success && segmented.text) {
        sentences = segmented.text.split('\n').map(s => s.trim()).filter(Boolean);
      }
    }

    for (const sentence of sentences) {
      this.sentences.push(sentence);
      this.fullText += `${this.fullText ? '\n' : ''}${sentence}`;
      this.transcriptRevision++;
      this.syncTranscriptEditor();
      this.updateTextActionVisibility();
      this.analyzeCurrentSentence(sentence);
      this.renderSubtitle(sentence, true);
    }

    if (this.fullText.length - this.lastFeedbackText.length >= 30) {
      this.requestRealtimeFeedback();
    }
  }
```

(3c) `runAudioAnalysis(transcribe)` 在拿到 `transcriptionResult.transcription` 后、调用 `renderAudioAnalysis` 前，把展示文本断句（约 340-343 处）：
```js
        const transcription = transcriptionResult.transcription;
        let displayText = transcription?.text || '';
        if (transcription && this.autoSegmentEnabled()) {
          const segmented = await this.api.segmentText(displayText);
          if (segmented?.success && segmented.text) displayText = segmented.text;
        }
        this.renderAudioAnalysis(transcriptionResult.audioAnalysis, transcription ? { ...transcription, text: displayText } : null);
```

注意：断句只影响展示与复制出的文本，`transcription.speaker_segments`（含时间戳的逐说话人原文）保持不变。

- [ ] **Step 4: 跑测试确认通过**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/segment-ui.test.js
```
Expected: PASS。全量 `node --test test/*.test.js` Expected: 全绿；`node --check src/app.js` OK。

- [ ] **Step 5: 提交**

```bash
git add src/app.js test/segment-ui.test.js
git commit -m "feat: segment realtime subtitle flushes and audio transcription display"
```

---

### Task 5: LLM 精修提示词 `getTranscriptPunctuatePrompt`

**Files:**
- Modify: `lib/prompts.js`
- Test: `test/transcript-punctuate-prompt.test.js`（新建）

- [ ] **Step 1: 写失败测试**

创建 `test/transcript-punctuate-prompt.test.js`：

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const { getTranscriptPunctuatePrompt } = require('../lib/prompts');

test('punctuate prompt only adds sentence punctuation and line breaks', () => {
  const source = '说话人 1：我们下周上线然后同步人力安排';
  const prompt = getTranscriptPunctuatePrompt(source);

  assert.match(prompt.system, /只增补句子结尾的标点/);
  assert.match(prompt.system, /不得增删改写/);
  assert.match(prompt.system, /填充词/);
  assert.match(prompt.system, /说话人/);
  assert.match(prompt.system, /一句一行/);
  assert.equal(prompt.user.includes(source), true);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/transcript-punctuate-prompt.test.js
```
Expected: FAIL（not a function）。

- [ ] **Step 3: 实现**

在 `lib/prompts.js` 的 `getTranscriptPolishPrompt` 之后、导出语句前新增：

```js
/**
 * AI 补标点/断句提示词。
 * 只增补句子结尾标点并按句分行，不改变任何文字内容。
 */
function getTranscriptPunctuatePrompt(fullText = '', customPrompt) {
  return {
    system: `你是会议逐字稿的断句与标点助手。
只增补句子结尾的标点，并按“一句一行”分行：
- 中文句子结尾补“。”；明显疑问句补“？”；英文句子结尾补“.”或“?”。
- 已有的句子结尾标点保持不变，不要重复添加。
- 保留全部文字与顺序，不得增删改写任何词语，不得吞掉填充词（如“嗯、那个、就是”）、犹豫词、重复或口语。
- 保留“说话人 N：”标签；只在其所在行内断句，不得跨行或跨说话人合并内容。
- 不得把标点插到句中（不插逗号/分号/顿号）。
只输出修正后的全文，不要任何解释、前言或 Markdown 格式。`,
    user: `会议逐字稿：\n\n---\n${String(fullText || '').trim()}\n---`
  };
}
```

导出语句改为同时导出该函数（保留现有全部导出名）。

- [ ] **Step 4: 跑测试确认通过**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/transcript-punctuate-prompt.test.js
```
Expected: PASS。全量 Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add lib/prompts.js test/transcript-punctuate-prompt.test.js
git commit -m "feat: add LLM punctuate prompt"
```

---

### Task 6: LLM 执行器 + IPC `punctuate-transcript` + preload

**Files:**
- Modify: `lib/ai-feedback.js`
- Modify: `main.js`
- Modify: `preload.js`
- Test: `test/transcript-punctuate-ipc.test.js`（新建，内容断言）

- [ ] **Step 1: 写失败测试**

创建 `test/transcript-punctuate-ipc.test.js`：

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const feedback = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ai-feedback.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

test('ai-feedback exposes a punctuate executor reusing the polish chunker', () => {
  assert.match(feedback, /sendTranscriptPunctuate/);
  assert.match(feedback, /splitTranscriptForPolish\(/);
  assert.match(feedback, /getTranscriptPunctuatePrompt\(/);
});

test('main exposes punctuate-transcript channel', () => {
  assert.match(main, /sendTranscriptPunctuate/);
  assert.match(main, /ipcMain\.handle\('punctuate-transcript'/);
});

test('preload exposes punctuateTranscript', () => {
  assert.match(preload, /punctuateTranscript: \(payload\) => ipcRenderer\.invoke\('punctuate-transcript', payload\)/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/transcript-punctuate-ipc.test.js
```
Expected: FAIL。

- [ ] **Step 3: 实现**

(3a) `lib/ai-feedback.js`：
- require 加 `getTranscriptPunctuatePrompt`；
- 在 `sendTranscriptPolish` 后新增（复用 `splitTranscriptForPolish` 与 `callAPI`）：
```js
async function sendTranscriptPunctuate(fullText, settings, customPrompt) {
  const source = String(fullText || '').trim();
  if (!source) return '';
  const config = getProviderConfig(settings);
  const chunks = splitTranscriptForPolish(source);
  const parts = [];
  for (const chunk of chunks) {
    if (!chunk) continue;
    const prompt = getTranscriptPunctuatePrompt(chunk, customPrompt);
    const result = await callAPI(config.endpoint, config.apiKey, config.model, [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ], 8192);
    parts.push((result || '').trim());
  }
  return parts.join('\n');
}
```
- 导出加 `sendTranscriptPunctuate`。

(3b) `main.js`：
- require 加 `sendTranscriptPunctuate`；
- 在 `polish-transcript` handler 之后新增：
```js
ipcMain.handle('punctuate-transcript', async (event, { fullText }) => {
  const settings = loadSettings();
  const providerConfig = getCurrentProviderSettings(settings);
  const customPrompt = loadCustomPrompt();
  try {
    const text = await sendTranscriptPunctuate(fullText, { ...settings, ...providerConfig }, customPrompt);
    return { success: true, text };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

(3c) `preload.js` 在 `polishTranscript` 后加：
```js
  punctuateTranscript: (payload) => ipcRenderer.invoke('punctuate-transcript', payload),
```

- [ ] **Step 4: 跑测试确认通过**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/transcript-punctuate-ipc.test.js
```
Expected: PASS。全量 Expected: 全绿；`node --check` 三个改过的 .js 均 OK。

- [ ] **Step 5: 提交**

```bash
git add lib/ai-feedback.js main.js preload.js test/transcript-punctuate-ipc.test.js
git commit -m "feat: add LLM punctuate executor and IPC channel"
```

---

### Task 7: 「AI 补标点/断句」按钮与方法

**Files:**
- Modify: `src/index.html`
- Modify: `src/app.js`
- Test: `test/transcript-punctuate-ui.test.js`（新建，内容断言）

- [ ] **Step 1: 写失败测试**

创建 `test/transcript-punctuate-ui.test.js`：

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');

test('transcript stage offers an AI punctuate button', () => {
  assert.match(html, /id="btn-punctuate-transcript"/);
  assert.match(html, />AI 补标点\/断句</);
  assert.match(app, /btnPunctuateTranscript = this\.root\.getElementById\('btn-punctuate-transcript'\)/);
});

test('punctuate writes back as an edited draft with polish-style guards', () => {
  assert.match(app, /async punctuateTranscript\(\)/);
  assert.match(app, /this\.api\.punctuateTranscript\(\{ fullText: text \}\)/);
  assert.match(app, /this\.transcriptRevision !== punctuateRevision/);
  assert.match(app, /polished === text/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/transcript-punctuate-ui.test.js
```
Expected: FAIL。

- [ ] **Step 3: 实现**

(3a) `src/index.html`：在 `transcript-actions` 里 `btn-polish-transcript` 之后加：
```html
            <button id="btn-punctuate-transcript" class="btn-secondary" title="按句子补全句末标点并按句分行，不改变内容；结果写回编辑框，需自行保存">AI 补标点/断句</button>
```

(3b) `src/app.js`：
- 元素引用（`this.btnPolishTranscript = ...` 后）加：
```js
    this.btnPunctuateTranscript = this.root.getElementById('btn-punctuate-transcript');
```
- bindEvents（`btnPolishTranscript` 监听后）加：
```js
    this.btnPunctuateTranscript.addEventListener('click', () => this.punctuateTranscript());
```
- 类末尾（`polishTranscript()` 后、类闭合前）新增，完整复制 polish 的防护语义：

```js
  async punctuateTranscript() {
    const generation = this.activeSessionGeneration;
    const punctuateRevision = this.transcriptRevision;
    const text = (this.transcriptEditor.value || this.fullText || '').trim();
    if (!text) {
      this.workspace.notice('请先录制或粘贴会议原文，再执行补标点/断句。');
      this.transcriptEditor.focus();
      return;
    }
    this.btnPunctuateTranscript.disabled = true;
    const label = this.btnPunctuateTranscript.textContent;
    this.btnPunctuateTranscript.textContent = '处理中…';
    try {
      const result = await this.api.punctuateTranscript({ fullText: text });
      if (!this.isSessionCurrent(generation)) return;
      if (!result.success || !result.text) throw new Error(result.error || '补标点/断句失败');
      const polished = result.text.trim();
      if (this.transcriptRevision !== punctuateRevision) {
        this.workspace.notice('等待期间原文已变化，已放弃本次结果，请再次点击。');
        return;
      }
      if (polished === text) {
        this.workspace.notice('原文已具备完整句末标点，无需调整。');
        return;
      }
      this.transcriptEditor.value = polished;
      this.handleTranscriptEditorInput();
      this.workspace.notice('补标点/断句完成，请审阅后点“保存”入库。');
      this.setSessionStatus('已修正，待审阅');
    } catch (error) {
      if (this.isSessionCurrent(generation)) {
        this.workspace.notice(`补标点/断句失败：${error.message}`);
        this.setSessionStatus('补标点/断句失败');
      }
    } finally {
      this.btnPunctuateTranscript.disabled = false;
      this.btnPunctuateTranscript.textContent = label;
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/transcript-punctuate-ui.test.js
```
Expected: PASS。全量 Expected: 全绿；`node --check src/app.js` OK。

- [ ] **Step 5: 提交**

```bash
git add src/index.html src/app.js test/transcript-punctuate-ui.test.js
git commit -m "feat: add manual AI punctuate button to the transcript stage"
```

---

### Task 8: README + 全量回归 + 收尾

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 说明**

在「错字润稿（AI）」小节（README 中 Task 8 上一特性加入的块）之后插入：

```markdown
**识别结果自动断句补标点**

- 实时字幕、最终稿与导入转写会按句子自动补句末标点并分行（中文句补“。”、英文句补“.”，明显疑问句补“？”），只作用于识别结果，不改变内容，也不会改写你粘贴或手动编辑的文本。
- 设置页「识别结果自动断句补标点」可关闭（默认开启）。
- 「会议原文」面板的 **AI 补标点/断句** 按钮可对当前原文做一次 LLM 精修（更符合语气与英文习惯），结果写回编辑框，审阅后点“保存”入库。
```

（锚点：README 中有 `**错字润稿（AI）**` 小节与其末尾 `- 结果为“编辑稿”，写回编辑框（按钮上悬停可见说明）；审阅后点“保存”才会写入会议产物，不会自动覆盖最终稿。`，在其后插入上块。）

- [ ] **Step 2: 全量回归**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/*.test.js
```
Expected: 全绿（原 60 + 新增 sentence-segment/asr-segment-settings/segment-ipc/segment-ui/transcript-punctuate-prompt/transcript-punctuate-ipc/transcript-punctuate-ui）。

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "docs: document auto segmentation and AI punctuate"
```

- [ ] **Step 4: 收尾检查**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/*.test.js
git status --short
git log --oneline main..HEAD
```
Expected: 全绿、clean、任务提交按序排列。
