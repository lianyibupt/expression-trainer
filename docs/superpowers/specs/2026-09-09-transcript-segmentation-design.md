# 识别结果断句补标点（v1）— 设计

日期：2026-09-09
状态：已确认（方案 A，本地规则 + 最终稿可选 LLM 精修；句末补标点风格；默认开启）

## 背景

会议录制链路中，实时字幕与部分最终稿缺少断句：

- 实时 Paraformer 流式识别基本不输出标点，字幕目前按"28 字 / 2.2s 停顿 / 已有句末标点"硬切（`src/app.js` `shouldFlushRealtimePhrase`），行内没有句界，句意靠猜。
- 无标点引擎（Paraformer 纯流式稿等）的最终原文没有句号、没有分行，`splitTranscript` 只按"已有标点/换行"切分（`src/app.js:1237-1239`），退化成整段。
- 下游逐句词库统计、字幕阅读、纪要分块全部随之退化。

目标：对**引擎生成**的文本自动做"句末补标点 + 一句一行"，并提供可选的 LLM 精修按钮；用户粘贴与手动编辑内容一律不自动改写。

## 目标（v1 范围）

1. 纯本地确定性规则模块，为无标点/少标点文本断句并补**句末标点**（中文段 `。`，英文段 `.`，明显疑问语气 `？`），尊重引擎已有的句末标点（不重复加）。
2. 自动接入：实时字幕 flush、录音停止后的最终稿、导入音频"转写并分析"结果。粘贴原文与手动编辑路径不处理。
3. 设置页「识别结果自动断句补标点」复选开关，默认开（`settings.asr.autoSegment`）；关闭即回旧行为，不影响已保存内容。
4. 「AI 补标点/断句」手动按钮（与「AI 修正错字」并列），对当前原文做 LLM 精修断句与标点，写回编辑稿、审阅后保存；行为沿用润稿通道的并发/去重/忙碌态防护。

## 设计

### 模块 1：`lib/sentence-segment.js`（纯函数，Node 可单测）

- `segmentTranscript(text)` → `string`
  - 按物理行切分（保留 `\n` 与空行结构、保留 `说话人 N：` 前缀），逐行处理，不跨行合并；
  - 每行：若行内已含句末标点（`。！？!?；` 或 ASCII `.?!` 视语段）则只按它们分行、补足残缺标点，不加重复标点；
  - 否则用 `segmentLine` 断句；结果以"每句一行"重新 join（原有空行保留）。
- `segmentLine(line, opts)` → `string[]`
  - 候选句界：句末语气词（吧/吗/呢/啊/呀/么…）+ 紧随其后的下一句起始话语标记（然后/但是/不过/所以/而且/那/就/其实/反正/就是/还有/再说…）；句界在整句长度达到下限（默认 ~18 字）后才启用；
  - 无候选句界时按长度上限兜底（默认 ~40 字，在最近的弱边界处切，否则硬切）；
  - 句末标点：语段含 CJK → `。`；语段以拉丁字母/数字为主 → `.`；语段含明显疑问结构（吗/呢/怎么/如何/why/what 等，保守）→ `？`；已有残缺标点只补齐不覆盖；
  - 不插入句内逗号/分号；填充词、犹豫词保留在所在句内；不改变词语内容。
- 输出约定：无论引擎是否带标点，最终稿中的句子都以句末标点 + `\n` 结束（除既有空行结构）。

### 模块 2：执行器与通道（LLM 精修，复用润稿同构）

- `lib/prompts.js`：新增 `getTranscriptPunctuatePrompt(fullText, customPrompt)`——只允许增补/修正句末标点与分行；不得增删改写文字、不得吞填充词、不得合并说话人行；沿用「边界约束」「【？】」「只输出修正后的全文」的保真结构。
- `lib/ai-feedback.js`：新增 `sendTranscriptPunctuate`，复用 `splitTranscriptForPolish` 分块与 `callAPI`，按块调用该提示词、`\n` join。
- `main.js`：新增 `ipcMain.handle('punctuate-transcript')`（与 `polish-transcript` 同构）。
- `preload.js`：暴露 `punctuateTranscript`。
- `src/index.html`：「会议原文」`transcript-actions` 增加 `btn-punctuate-transcript`「AI 补标点/断句」。
- `src/app.js`：新增 `punctuateTranscript()`——复制 `polishTranscript()` 的防护语义（generation + revision 双守卫、结果与原文一致时短路提示、无条件 finally 恢复忙碌态），写回编辑框并走 `handleTranscriptEditorInput()`（编辑稿语义，不自动保存）。

### 模块 3：接入点（本地规则自动）

统一封装便于关闭开关：`src/app.js` 或共享 helper `applyAutoSegment(text, settings)`；开关读取 `settings.asr.autoSegment !== false`。

- 实时字幕 flush（`flushRealtimePhraseBuffer`）：缓冲文本先 `segmentTranscript`，得到的每条句子分别进 `sentences`/`fullText`/逐句 `analyzeCurrentSentence`/`renderSubtitle`——字幕变为"一句一行"。preview（非 final）不处理，避免闪烁。
- 停止录音最终稿落地与「采用最终稿」（`btn-adopt-final`、自动采用路径）：仅当文本源为引擎结果时先断句再 `loadTranscriptText`；用户已编辑（`transcriptSource==='edited'`）不处理。
- 音频分析"转写并分析"：转录文本（含说话人行）展示/落库前先 `segmentTranscript`（不改变说话人归属逻辑）。
- 粘贴原文与手动编辑：不自动处理。

### 设置

- `src/settings.html`：会议录音组加「识别结果自动断句补标点」checkbox（`auto-segment`），hint 说明只作用于识别结果、不含粘贴/手改。
- `src/settings.js`：读写 `settings.asr.autoSegment`（默认 true）。
- `settings.example.json`：`asr.autoSegment: true`。
- `main.js`：`DEFAULT_ASR_CONFIG` 补 `autoSegment: true`（schema 自描述）。

## 明确不做（YAGNI / 边界）

- 不插入句内标点（逗号/分号/顿号）。
- 不更换/修改实时 ASR 引擎；不改写用户粘贴与手动编辑内容；不做真实说话人识别。
- 本地规则误断（长句拆碎/该断未断）作为已知取舍：可关闭开关，或对最终稿用「AI 补标点/断句」精修。
- LLM 精修与「AI 修正错字」保持独立按钮、独立通道，互不耦合。

## 风险与说明

- 设置默认开会影响现有用户的最终稿与字幕呈现（多出标点/分行）：这是本需求目标；开关可随时关闭。
- 本地规则只加句末标点，不改文字，断句失败只影响分行位置，不损失内容。
- 断句发生在"落地前"，历史 artifact 不受影响；保存后如需调整，用原文编辑或 LLM 精修。
