# 会议逐字稿中英混说准确率提升（本地快速优化 v1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改架构的前提下，通过「Qwen3-ASR 语言提示默认自动 + 可配置」「升级 qwen-asr Python 包」「会议原文手动 AI 错字润稿」三件事提升中英混说会议逐字稿准确率。

**Architecture:** Qwen3-ASR 最终转写由 Python worker 子进程完成：`lib/asr.js` 组参数并 spawn `scripts/qwen3_asr_worker.py`。语言提示现在硬编码为 `Chinese`（对混说不利），改为默认自动语种识别（`None`）并透传设置值。AI 润稿沿用既有 LLM 链路：`lib/prompts.js` 出提示词 → `lib/ai-feedback.js` 执行（分块 + callAPI）→ `main.js` IPC → `preload.js` → 「会议原文」面板按钮写回编辑框（不自动保存）。

**Tech Stack:** Node.js 18+ / Electron（renderer 端）；Python venv `.venv-qwen3-asr`（qwen-asr + torch）；测试用 Node 内置 `node:test`（`npm test` = `node --test test/*.test.js`）。

执行说明：

- 所有命令在仓库根目录运行。本机 node 不在默认 PATH，运行测试前先 `export PATH="/opt/homebrew/bin:$PATH"`（或直接调用 `/opt/homebrew/bin/node`）。
- 测试风格：仓库同时用「纯函数单元断言」和「源码内容断言」（读文件后 `assert.match`），本计划沿用两种。
- 每个任务都按「先写失败测试 → 跑失败 → 实现 → 跑绿 → 提交」进行。

---

### Task 0: 基线：确认改动前全量测试为绿

**Files:** 无改动

- [ ] **Step 1: 运行全量测试确认基线**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/*.test.js
```

Expected: 全部 PASS（当前仓库应干净通过）。若有失败，先停下排查，不要带着红基线开工。

---

### Task 1: worker 语言归一化（auto→None，支持英文列表）

**Files:**
- Modify: `scripts/qwen3_asr_worker.py`
- Test: `test/qwen3-worker.test.js`（新建，源码内容断言）

- [ ] **Step 1: 写失败测试**

创建 `test/qwen3-worker.test.js`：

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const worker = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'qwen3_asr_worker.py'), 'utf8');

test('qwen3 worker normalizes auto/blank language to auto-detection', () => {
  assert.match(worker, /def normalize_language/);
  assert.match(worker, /auto|none|null/i);
  assert.match(worker, /known\.get\(tok\.lower\(\), tok\)/);
});

test('qwen3 worker falls back to auto-detection when the package rejects a language list', () => {
  assert.match(worker, /isinstance\(language, list\)/);
  assert.match(worker, /language=None/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/qwen3-worker.test.js
```

Expected: FAIL（断言找不到 `normalize_language` / `isinstance(language, list)`）。

- [ ] **Step 3: 实现**

在 `scripts/qwen3_asr_worker.py` 的 `SAMPLE_RATE = 16000` 之后（约第 44 行）新增：

```python
def normalize_language(value):
    """Map worker language hints to qwen_asr accepted values.

    None -> auto detection (recommended for mixed zh/en speech).
    Single token -> that language string.
    Comma separated -> list of languages (requires a qwen-asr release that
    supports per-utterance language lists).
    """
    if value is None:
        return None
    raw = str(value).strip()
    if raw.lower() in {"", "none", "null", "auto"}:
        return None
    known = {"chinese": "Chinese", "english": "English"}
    tokens = [tok.strip() for tok in raw.split(",") if tok.strip()]
    if not tokens:
        return None
    if len(tokens) == 1:
        token = tokens[0]
        return known.get(token.lower(), token)
    return [known.get(tok.lower(), tok) for tok in tokens]
```

把 `main()` 里现有的语言归一化（约第 347-349 行）：

```python
    language = args.language
    if language.lower() in {"", "none", "null", "auto"}:
        language = None
```

替换为：

```python
    language = normalize_language(args.language)
```

把 `transcribe_audio_chunks()` 里 `flush()` 的转写调用（约第 250-253 行）：

```python
        results = model.transcribe(
            audio=[(chunk, SAMPLE_RATE) for chunk in current],
            language=language,
        )
```

替换为（旧版 qwen-asr 不支持语言列表时降级为自动识别）：

```python
        try:
            results = model.transcribe(
                audio=[(chunk, SAMPLE_RATE) for chunk in current],
                language=language,
            )
        except TypeError:
            if not isinstance(language, list):
                raise
            # 旧版 qwen-asr 不支持按语言列表混说：降级为自动语种识别
            results = model.transcribe(
                audio=[(chunk, SAMPLE_RATE) for chunk in current],
                language=None,
            )
```

- [ ] **Step 4: 跑测试确认通过**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/qwen3-worker.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add scripts/qwen3_asr_worker.py test/qwen3-worker.test.js
git commit -m "feat: let Qwen3-ASR worker auto-detect language and support language lists"
```

---

### Task 2: asr.js 语言提示默认自动并透传到 worker

**Files:**
- Modify: `lib/asr.js`（多处，见下）
- Modify: `main.js`（`transcribe-audio-file` handler 透传语言）
- Modify: `test/asr-config.test.js`（追加单测）
- Test: `test/asr-language.test.js`（新建，内容断言：不再硬编码 Chinese）

- [ ] **Step 1: 写失败测试**

向 `test/asr-config.test.js` 末尾追加：

```js
test('buildASRConfig defaults Qwen3-ASR language to auto recognition', () => {
  const config = buildASRConfig({ modelPreset: 'paraformer-qwen3-final' });
  assert.equal(config.qwen3Language, 'auto');
});

test('buildASRConfig passes an explicit Qwen3-ASR language through', () => {
  const config = buildASRConfig({ modelPreset: 'qwen3-asr-python', qwen3Language: 'Chinese' });
  assert.equal(config.qwen3Language, 'Chinese');
});

test('normalizeQwen3Language maps auto and blank values to the none sentinel', () => {
  const { normalizeQwen3Language } = require('../lib/asr');
  assert.equal(normalizeQwen3Language('auto'), 'none');
  assert.equal(normalizeQwen3Language(undefined), 'none');
  assert.equal(normalizeQwen3Language(''), 'none');
  assert.equal(normalizeQwen3Language('Chinese'), 'Chinese');
  assert.equal(normalizeQwen3Language('Chinese,English'), 'Chinese,English');
});
```

创建 `test/asr-language.test.js`：

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const asr = fs.readFileSync(path.join(__dirname, '..', 'lib', 'asr.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('asr.js no longer hardcodes Chinese as the Qwen3-ASR language', () => {
  assert.doesNotMatch(asr, /'--language', 'Chinese'/);
  assert.match(asr, /QWEN3_ASR_LANGUAGE/);
  assert.match(asr, /language: qwen3Language/);
});

test('audio file transcription passes the configured language through', () => {
  assert.match(main, /settings\.asr\?\.qwen3Language/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/asr-config.test.js test/asr-language.test.js
```

Expected: FAIL（`config.qwen3Language` 为 undefined；内容断言不匹配）。

- [ ] **Step 3: 实现**

**3a.** `lib/asr.js` 在 `let qwen3FinalModel = '';`（约第 18 行）后新增模块状态：

```js
let qwen3Language = 'auto';
```

**3b.** 在 `fileContainsAscii` 函数之后（约第 114 行后）新增：

```js
/**
 * 将语言设置归一化为 worker 的 --language 值。
 * 'auto' / 空 -> 'none'（worker 端再映射为 None，自动语种识别）；
 * 其它取值（Chinese / English / Chinese,English）原样透传。
 */
function normalizeQwen3Language(value) {
  const raw = value == null ? 'auto' : String(value).trim();
  if (!raw || /^(auto|none|null)$/i.test(raw)) return 'none';
  return raw;
}
```

**3c.** `resolvePreset()` 的 return（约第 122-127 行）补上语言字段：

```js
  return {
    ...preset,
    modelDir: options.modelPath || preset.modelDir,
    finalModel: qwen3ModelPath || preset.finalModel || preset.finalModelDir,
    speakerDiarization: options.speakerDiarization !== false,
    qwen3Language: options.qwen3Language || 'auto'
  };
```

**3d.** `buildASRConfig()` 的 hybrid 分支 return（约第 159-170 行）与 `qwen3-asr-python` 分支 return（约第 174-182 行）各加一行 `qwen3Language: preset.qwen3Language,`（放在 `speakerDiarization: preset.speakerDiarization,` 之后）。

**3e.** `transcribeWithQwen3Python()` 的解构（约第 303 行）加上 `language`：

```js
function transcribeWithQwen3Python(samples, model, { speakerDiarization = false, onProgress, jobId = require('crypto').randomUUID(), language } = {}) {
```

并把构造参数处（约第 310-315 行）：

```js
    const args = [
      QWEN3_ASR_WORKER,
      '--model', model || QWEN3_ASR_DEFAULT_MODEL,
      '--audio', wavPath,
      '--language', 'Chinese'
    ];
```

替换为：

```js
    const languageArg = normalizeQwen3Language(language ?? process.env.QWEN3_ASR_LANGUAGE ?? 'auto');
    const args = [
      QWEN3_ASR_WORKER,
      '--model', model || QWEN3_ASR_DEFAULT_MODEL,
      '--audio', wavPath,
      '--language', languageArg
    ];
```

**3f.** `initASR()` 两处写入模块状态：reuse 分支（约第 416-426 行，在 `finalSpeakerDiarization = asrConfig.speakerDiarization !== false;` 后）与正常初始化分支（约第 462-465 行同样位置）都加：

```js
    qwen3Language = asrConfig.qwen3Language || 'auto';
```

**3g.** `stopRecognition()` 里调用 `transcribeWithQwen3Python`（约第 530 行）：

```js
    transcribeWithQwen3Python(samples, qwen3FinalModel, {
      speakerDiarization: Boolean(finalSpeakerDiarization)
    })
```

替换为：

```js
    transcribeWithQwen3Python(samples, qwen3FinalModel, {
      speakerDiarization: Boolean(finalSpeakerDiarization),
      language: qwen3Language
    })
```

**3h.** `transcribeAudioFile()`（约第 586-590 行）解构加 `language` 并透传：

```js
async function transcribeAudioFile(filePath, model, { speakerDiarization = true, onProgress, jobId, language } = {}) {
  const { readWav16kMono } = require('./audio-analysis');
  const samples = readWav16kMono(filePath);
  return transcribeWithQwen3Python(samples, model || QWEN3_ASR_DEFAULT_MODEL, { speakerDiarization, onProgress, jobId, language });
}
```

**3i.** `module.exports`（约第 592 行）追加 `normalizeQwen3Language`。

**3j.** `main.js` 的 `transcribe-audio-file` handler（约第 644-648 行）中，`transcribeAudioFile(...)` 调用加语言透传：

```js
    const transcription = await transcribeAudioFile(normalized.outputPath, model, {
      speakerDiarization: settings.asr?.speakerDiarization !== false,
      language: settings.asr?.qwen3Language || 'auto',
      jobId: `${sessionId}:${jobId}`,
      onProgress: progress => event.sender.send('audio-analysis-progress', { ...progress, sessionId, jobId })
    });
```

- [ ] **Step 4: 跑测试确认通过**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/asr-config.test.js test/asr-language.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/asr.js main.js test/asr-config.test.js test/asr-language.test.js
git commit -m "feat: default Qwen3-ASR to auto language detection and thread the setting through"
```

---

### Task 3: 设置页增加「Qwen3 转写语言」并持久化

**Files:**
- Modify: `src/settings.html`
- Modify: `src/settings.js`
- Modify: `settings.example.json`
- Test: `test/asr-settings.test.js`（新建，内容断言）

- [ ] **Step 1: 写失败测试**

创建 `test/asr-settings.test.js`：

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.html'), 'utf8');
const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.js'), 'utf8');
const example = fs.readFileSync(path.join(__dirname, '..', 'settings.example.json'), 'utf8');

test('settings page exposes a Qwen3 transcription language selector', () => {
  assert.match(html, /id="qwen3-language"/);
  assert.match(html, /value="auto"/);
  assert.match(html, /自动识别/);
});

test('settings page loads and saves the Qwen3 language field', () => {
  assert.match(settings, /qwen3LanguageSelect = document\.getElementById\('qwen3-language'\)/);
  assert.match(settings, /qwen3Language: this\.qwen3LanguageSelect\.value/);
  assert.match(settings, /asr\.qwen3Language \|\| 'auto'/);
});

test('settings example includes qwen3Language', () => {
  assert.match(example, /qwen3Language/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/asr-settings.test.js
```

Expected: FAIL（id/字段不存在）。

- [ ] **Step 3: 实现**

**3a.** `src/settings.html` 在 `#group-qwen3-path` 内、Qwen3 模型路径输入的 hint（第 307 行）之后新增：

```html
      <div class="form-group" style="margin-top:10px;">
        <label>Qwen3 转写语言</label>
        <select id="qwen3-language">
          <option value="auto">自动识别（推荐，适合中英混说）</option>
          <option value="Chinese">中文为主</option>
          <option value="English">English 为主</option>
        </select>
        <div class="hint">“自动识别”按语音片段判断语种；中英文夹杂的会议建议保持自动。个别偏科会议可在设置里固定中文或英文。</div>
      </div>
```

**3b.** `src/settings.js`：

- 构造函数（第 65 行 `qwen3ModelPathInput` 之后）加：

```js
    this.qwen3LanguageSelect = document.getElementById('qwen3-language');
```

- `loadMeetingFields()`（第 133 行 `qwen3ModelPathInput.value = ...` 之后）加：

```js
    this.qwen3LanguageSelect.value = asr.qwen3Language || 'auto';
```

- `save()` 里 `settings.asr = { ... }`（约第 291-297 行）在 `speakerDiarization: this.speakerDiarizationInput.checked,` 之后加：

```js
      qwen3Language: this.qwen3LanguageSelect.value,
```

**3c.** `settings.example.json` 的 `asr` 对象里加：

```json
    "qwen3Language": "auto"
```

- [ ] **Step 4: 跑测试确认通过**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/asr-settings.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/settings.html src/settings.js settings.example.json test/asr-settings.test.js
git commit -m "feat: add Qwen3-ASR language selector to settings"
```

---

### Task 4: 升级 qwen-asr Python 包并验证

**Files:** 无仓库内改动（依赖在 venv）

- [ ] **Step 1: 升级包**

```bash
.venv-qwen3-asr/bin/python -m pip install --upgrade qwen-asr
```

Expected: `Successfully installed qwen-asr-<新版本>`。若提示网络/沙箱受限失败，记录到 Task 8 的交付说明中（命令原样留给用户本机执行），本任务视为“待用户在本地执行”，继续后续任务——worker 的 TypeError 降级分支已保证列表参数在旧包下不会崩。

- [ ] **Step 2: 验证依赖可用**

```bash
export PATH="/opt/homebrew/bin:$PATH"
.venv-qwen3-asr/bin/python scripts/qwen3_asr_worker.py --model Qwen/Qwen3-ASR-1.7B --check
```

Expected: 输出含 `"ok": true`（加载模型约需数分钟，属正常）。

（无提交；若 Step 1 失败，把版本号记进最终交付说明。）

---

### Task 5: 新增润稿提示词

**Files:**
- Modify: `lib/prompts.js`
- Test: `test/transcript-polish-prompt.test.js`（新建）

- [ ] **Step 1: 写失败测试**

创建 `test/transcript-polish-prompt.test.js`：

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const { getTranscriptPolishPrompt } = require('../lib/prompts');

test('transcript polish prompt only fixes ASR errors and preserves spoken content', () => {
  const source = '说话人 1：那个我们嗯下周上线吧。';
  const prompt = getTranscriptPolishPrompt(source);

  assert.match(prompt.system, /只修正语音识别造成的错误/);
  assert.match(prompt.system, /填充词/);
  assert.match(prompt.system, /说话人标签/);
  assert.match(prompt.system, /【？】/);
  assert.match(prompt.system, /只输出修正后的全文/);
  assert.equal(prompt.user.includes(source), true);
});

test('transcript polish prompt carries an optional glossary hint', () => {
  const prompt = getTranscriptPolishPrompt('hello', { glossary: 'A/B test' });
  assert.match(prompt.system, /A\/B test/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/transcript-polish-prompt.test.js
```

Expected: FAIL（`getTranscriptPolishPrompt is not a function`）。

- [ ] **Step 3: 实现**

在 `lib/prompts.js` 的 `getMeetingMinutesPrompt` 函数之后（约第 290 行前）新增：

```js
/**
 * 逐字稿错字修正提示词。
 * 只修正语音识别错误，不改变表达内容与结构。
 */
function getTranscriptPolishPrompt(fullText = '', customPrompt) {
  const glossaryBlock = customPrompt?.glossary
    ? `\n用户术语/人名表（优先按此拼写保留，不要改动）：${customPrompt.glossary}`
    : '';
  return {
    system: `你是逐字稿校对助手。你收到的是一段语音识别（ASR）生成的会议逐字稿。
只修正语音识别造成的错误，逐字保留其余内容：
- 修正同音/近音错字、明显的断句错误。
- 中文夹杂的英文术语/人名/专有名词保持英文原文拼写，不要音译成中文；英文单词拼写错误时改正。
- 修正明显错误的数字、标点和中英文字边界。
严格禁止：
- 不得增删内容、不得总结、不得改写表达风格、不得润色措辞。
- 必须保留：填充词（如“嗯、那个、就是”）、犹豫词、重复、口语、说话人标签（如“说话人 1：”）、换行。
不确定的地方保留最可能的写法并在该词后加“【？】”。
只输出修正后的全文，不要任何解释、前言或 Markdown 格式。${glossaryBlock}`,
    user: `会议逐字稿：\n\n${fullText}`
  };
}
```

把文件末尾的导出（第 292 行）：

```js
module.exports = { getRealtimePrompt, getReportPrompt, getMeetingMinutesPrompt };
```

改为：

```js
module.exports = { getRealtimePrompt, getReportPrompt, getMeetingMinutesPrompt, getTranscriptPolishPrompt };
```

- [ ] **Step 4: 跑测试确认通过**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/transcript-polish-prompt.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/prompts.js test/transcript-polish-prompt.test.js
git commit -m "feat: add transcript polish prompt that preserves spoken content"
```

---

### Task 6: ai-feedback 执行润稿 + main IPC + preload 通道

**Files:**
- Modify: `lib/ai-feedback.js`
- Modify: `main.js`
- Modify: `preload.js`
- Test: `test/transcript-polish-ipc.test.js`（新建，内容断言）

- [ ] **Step 1: 写失败测试**

创建 `test/transcript-polish-ipc.test.js`：

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const feedback = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ai-feedback.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

test('ai-feedback exposes a transcript polish executor that reuses chunking', () => {
  assert.match(feedback, /sendTranscriptPolish/);
  assert.match(feedback, /splitMeetingText\(/);
  assert.match(feedback, /getTranscriptPolishPrompt\(/);
});

test('main exposes a polish-transcript IPC channel', () => {
  assert.match(main, /sendTranscriptPolish/);
  assert.match(main, /ipcMain\.handle\('polish-transcript'/);
});

test('preload exposes polishTranscript', () => {
  assert.match(preload, /polishTranscript: \(payload\) => ipcRenderer\.invoke\('polish-transcript', payload\)/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/transcript-polish-ipc.test.js
```

Expected: FAIL（各处缺失）。

- [ ] **Step 3: 实现**

**3a.** `lib/ai-feedback.js` 第 6 行的 require：

```js
const { getRealtimePrompt, getReportPrompt, getMeetingMinutesPrompt } = require('./prompts');
```

改为：

```js
const { getRealtimePrompt, getReportPrompt, getMeetingMinutesPrompt, getTranscriptPolishPrompt } = require('./prompts');
```

在 `sendMeetingMinutes` 函数之后（约第 173 行后）新增：

```js
async function sendTranscriptPolish(fullText, settings, customPrompt) {
  const source = String(fullText || '').trim();
  if (!source) return '';
  const config = getProviderConfig(settings);
  const chunks = splitMeetingText(source);
  const parts = [];
  for (const chunk of chunks) {
    const prompt = getTranscriptPolishPrompt(chunk, customPrompt);
    const result = await callAPI(config.endpoint, config.apiKey, config.model, [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ], 8192);
    parts.push((result || '').trim());
  }
  return parts.join('\n\n');
}
```

导出列表（约第 229-235 行）加 `sendTranscriptPolish,`。

**3b.** `main.js` 第 7 行的 require：

```js
const { sendFeedback, sendReport, sendMeetingMinutes, testConnection } = require('./lib/ai-feedback');
```

改为：

```js
const { sendFeedback, sendReport, sendMeetingMinutes, sendTranscriptPolish, testConnection } = require('./lib/ai-feedback');
```

在 `get-meeting-minutes` handler 之后（约第 780 行后）新增：

```js
ipcMain.handle('polish-transcript', async (event, { fullText }) => {
  const settings = loadSettings();
  const providerConfig = getCurrentProviderSettings(settings);
  const customPrompt = loadCustomPrompt();
  try {
    const text = await sendTranscriptPolish(fullText, { ...settings, ...providerConfig }, customPrompt);
    return { success: true, text };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

**3c.** `preload.js` 在 `getMeetingMinutes` 之后（第 56 行后）加：

```js
  polishTranscript: (payload) => ipcRenderer.invoke('polish-transcript', payload),
```

- [ ] **Step 4: 跑测试确认通过**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/transcript-polish-ipc.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/ai-feedback.js main.js preload.js test/transcript-polish-ipc.test.js
git commit -m "feat: add AI transcript polish executor and IPC channel"
```

---

### Task 7: 「会议原文」面板加入「AI 修正错字」按钮

**Files:**
- Modify: `src/index.html`
- Modify: `src/app.js`
- Test: `test/transcript-polish-ui.test.js`（新建，内容断言）

- [ ] **Step 1: 写失败测试**

创建 `test/transcript-polish-ui.test.js`：

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');

test('transcript stage offers an AI polish button', () => {
  assert.match(html, /id="btn-polish-transcript"/);
  assert.match(html, />AI 修正错字</);
  assert.match(app, /btnPolishTranscript = this\.root\.getElementById\('btn-polish-transcript'\)/);
});

test('polish result is written back into the editor as an edited draft', () => {
  assert.match(app, /polishTranscript\(\)/);
  assert.match(app, /this\.api\.polishTranscript\(\{ fullText: text \}\)/);
  assert.match(app, /this\.handleTranscriptEditorInput\(\)/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/transcript-polish-ui.test.js
```

Expected: FAIL（按钮与方法缺失）。

- [ ] **Step 3: 实现**

**3a.** `src/index.html` 在「会议原文」面板的 `transcript-actions` 里、`btn-analyze-paste`（第 135 行）之后加：

```html
            <button id="btn-polish-transcript" class="btn-secondary">AI 修正错字</button>
```

**3b.** `src/app.js`：

- 元素引用（第 74 行 `this.btnAnalyzePaste = ...` 之后）加：

```js
    this.btnPolishTranscript = this.root.getElementById('btn-polish-transcript');
```

- `bindEvents()` 里（第 178 行 `btnAnalyzePaste` 监听之后）加：

```js
    this.btnPolishTranscript.addEventListener('click', () => this.polishTranscript());
```

- 在类末尾（`analyzePastedText` 方法之后、第 1662 行闭合 `}` 之前）新增方法：

```js
  async polishTranscript() {
    const generation = this.activeSessionGeneration;
    const text = (this.transcriptEditor.value || this.fullText || '').trim();
    if (!text) {
      this.workspace.notice('请先录制或粘贴会议原文，再执行错字修正。');
      this.transcriptEditor.focus();
      return;
    }
    this.btnPolishTranscript.disabled = true;
    const label = this.btnPolishTranscript.textContent;
    this.btnPolishTranscript.textContent = '修正中…';
    try {
      const result = await this.api.polishTranscript({ fullText: text });
      if (!result.success || !result.text) throw new Error(result.error || '错字修正失败');
      if (!this.isSessionCurrent(generation)) return;
      this.transcriptEditor.value = result.text;
      this.handleTranscriptEditorInput();
      this.workspace.notice('错字修正完成，请审阅后点“保存”入库。');
      this.setSessionStatus('已修正，待审阅');
    } catch (error) {
      if (this.isSessionCurrent(generation)) {
        this.workspace.notice(`错字修正失败：${error.message}`);
      }
    } finally {
      if (this.isSessionCurrent(generation)) {
        this.btnPolishTranscript.disabled = false;
        this.btnPolishTranscript.textContent = label;
      }
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/transcript-polish-ui.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/index.html src/app.js test/transcript-polish-ui.test.js
git commit -m "feat: add manual AI transcript polish button to the transcript stage"
```

---

### Task 8: 文档更新 + 全量回归 + 交付说明

**Files:**
- Modify: `README.md`
- 无代码改动

- [ ] **Step 1: README 补充说明**

在 README「ASR 模型与转写」一节的预设表之后（唯一锚点行：`| Qwen3-ASR | 无 | Qwen3-ASR 最终稿 | Python qwen-asr、Qwen 模型 | 最终稿准确性优先 |`，紧跟该行的空行之后）插入：

```markdown
**中英混说的语言提示**

- 默认情况下 Qwen3-ASR 最终转写使用**自动语种识别**（worker 的 `--language` 为 `none`），适合中英文夹杂的会议。
- 可在设置页「Qwen3 转写语言」固定为「中文为主」或「English 为主」；也支持环境变量 `QWEN3_ASR_LANGUAGE`（取值 `auto`/`Chinese`/`English`，或逗号分隔如 `Chinese,English`）。
- 说话人分离按片段转写，语言提示对归属无影响。

**错字润稿（AI）**

- 「会议原文」面板的 **AI 修正错字** 按钮会把当前原文交给已配置的 LLM，只修正语音识别错误（同音/近音错字、中英边界、数字标点），保留填充词、口语、重复与说话人标签。
- 结果为“编辑稿”，写回编辑框，审阅后点“保存”才会写入会议产物；不会自动覆盖最终稿。
```

安装 qwen-asr 时使用 `pip install -U qwen-asr` 升级到最新版（README 中「可选：配置 Qwen3-ASR」一节既有命令 `qwen-asr` 依赖即为 `--upgrade`，无需改动，如未升级过则执行一次）。

- [ ] **Step 2: 运行全量测试**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/*.test.js
```

Expected: 全部 PASS。

- [ ] **Step 3: 尝试升级 qwen-asr（若 Task 4 未成功）**

```bash
.venv-qwen3-asr/bin/python -m pip install --upgrade qwen-asr
.venv-qwen3-asr/bin/python scripts/qwen3_asr_worker.py --model Qwen/Qwen3-ASR-1.7B --check
```

若沙箱无网络：把上面两条命令写入最终交付说明，提醒用户在本地执行一次。

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: document auto language detection and AI transcript polish"
```

- [ ] **Step 5: 收尾检查**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --test test/*.test.js
git status --short
```

Expected: 全绿；`git status` 干净（README 已提交）。最终交付说明里列出：三项改动摘要、需用户在本地执行的 `pip install --upgrade qwen-asr`、以及「先录一场中英夹杂会议对比自动 vs 固定中文」的建议验证步骤。
