# 会议逐字稿中英混说准确率提升（本地快速优化 v1）— 设计

日期：2026-09-09
状态：已确认

## 背景

日常会议大量中英文夹杂，当前识别准确率不足。链路现状（均在本仓库）：

- 实时字幕：Paraformer 中英双语流式（sherpa-onnx int8），仅作低延迟草稿。
- 最终逐字稿：停止录制 / 导入音频后，由 Python worker 调用本机 Qwen3-ASR-1.7B 生成；
  调用点 `lib/asr.js:314` 硬编码 `--language Chinese`。
- 说话人分离：worker 内能量分段 + 本地音色聚类（增强项，不阻塞转写）。

## 目标（本次范围）

不改架构、不加云端 ASR、不动实时 Paraformer 的前提下，做三件本地快速优化：

1. Qwen3-ASR 转写语言提示**默认自动识别**，并可在设置页固定中文/英文。
2. 升级 `qwen-asr` Python 包（当前 0.0.6 偏旧）。
3. 「会议原文」面板提供**手动触发的 AI 错字润稿**（LLM 只修识别错误，不改变内容）。

成功标准：中英混说的最终逐字稿错误明显减少；纯中文场景不劣化；润稿结果可审阅后再保存。

## 设计

### 工作项 1：Qwen3-ASR 语言提示

现状：`transcribeWithQwen3Python()` 固定传 `--language Chinese`。

改动：

1. `lib/asr.js`：
   - `transcribeWithQwen3Python(samples, model, opts)` 增加 `opts.language`；
   - 默认值优先级：显式 option > 环境变量 `QWEN3_ASR_LANGUAGE` > `'auto'`；
   - `stopRecognition` 与 `transcribeAudioFile` 透传该语言；
   - 在 `initASR` 时把配置里的语言存为模块状态（与现有 `qwen3FinalModel` 同模式），供 `stopRecognition` 使用。
2. `scripts/qwen3_asr_worker.py`：
   - `--language` 语义：`auto / none / 空 → None`（自动语种识别，Qwen3-ASR 官方对混说的推荐用法）；
   - 支持逗号分隔列表（如 `Chinese,English`）→ 转成 list 传入 `model.transcribe(language=...)`；
   - 仅在确认当前安装的 `qwen-asr` 包支持列表参数时启用列表；不支持时对该值降级为 None（自动）。
3. 设置（仅 Qwen3 相关，不触碰 SenseVoice 既有 `language:'zh'` 语义）：
   - `settings.asr.qwen3Language`，取值 `'auto' | 'Chinese' | 'English'`，缺省 `'auto'`；
   - `src/settings.html`：在 Qwen3 模型路径输入旁增加「转写语言」下拉；
   - `src/settings.js`：读写该字段（load/save）；
   - 从设置到识别引擎的传递链路（settings.asr → recordingController.start → initASR options → asr.js 模块状态）打通。
4. 生效路径：录音停止后的最终稿、音频分析「转写并分析」共用同一逻辑。

测试：`test/asr-config.test.js` 增加语言映射断言（auto→None、Chinese、English、列表等）。

### 工作项 2：升级 qwen-asr Python 包

- 在 `.venv-qwen3-asr` 执行 `pip install -U qwen-asr`；
- 用 `npm run check:qwen3-asr` 与 worker `--check` 验证导入与依赖；
- README「可选：配置 Qwen3-ASR」一节同步安装说明；
- 若环境无法联网升级，则在 README 记录升级命令与验证步骤，代码保持对新旧版本兼容（自动语言识别与单语言参数在新旧包均可工作；列表参数仅在确认支持后使用）。

### 工作项 3：AI 错字润稿（手动触发）

语义：

- 输入为「会议原文」编辑框全文；
- LLM 仅修正语音识别错误：同音/近音错字、中英文字边界、数字与标点；
- 保留：填充词、犹豫词、口语、重复、说话人标签、换行；
- 禁止：总结、改写风格、增删内容；
- 不确定处保留最可能写法并标注 `【？】`；
- 输出仅修正后的全文（无解释、无 Markdown 结构）。

落点（沿用现有 LLM 链路模式）：

1. `lib/prompts.js`：新增 `getTranscriptPolishPrompt(text, customPrompt)`，返回 `{ system, user }`；
2. `lib/ai-feedback.js`：新增 `sendTranscriptPolish(fullText, settings, customPrompt)`，复用 `splitMeetingText` 分块 + `callAPI`，各块结果按原文顺序用 `\n\n` 合并后返回；
3. `main.js`：新增 `ipcMain.handle('polish-transcript')`，与 `get-meeting-minutes` 同套路（读 settings、provider 配置、customPrompt），返回 `{ success, text }` 或 `{ success:false, error }`；
4. `preload.js`：暴露 `polishTranscript(payload)`；
5. `src/index.html`：「会议原文」面板 `transcript-actions` 行新增按钮「AI 修正错字」；
6. `src/app.js`：点击后取 `transcript-editor` 当前全文调用 IPC；成功后写回编辑框并置 `transcriptSource='edited'`（沿用现有编辑稿语义，不自动保存）；文本为空或未配置 LLM provider 时禁用并提示；
7. 保存仍然走用户既有「保存原文」动作，润稿结果不自动覆盖 artifact。

测试：`test/` 下新增润稿相关测试，沿用 `meeting-minutes.test.js` 的 mock 模式：
- prompt 结构（system/user 均存在，包含保真约束关键词）；
- 分块 + mock `callAPI` 时各块结果顺序合并；
- 空文本短路。

## 明确不做（YAGNI / 边界）

- 不换实时 Paraformer 引擎；实时字幕定位仍为「草稿」。
- 不加云端 ASR provider（用户后续可单独评估火山/飞书妙记路径）。
- 不做热词/术语表 UI。
- 音频分析工作台的转写不加润稿入口（同一机制后续可复用）。
- 润稿不静默覆盖最终稿 artifact；只写回编辑框。

## 风险与说明

- 默认自动识别对纯中文会议通常不劣于固定 `Chinese`；若个别会议回退，可用设置固定中文/英文。
- 润稿为 LLM 生成，可能漏改/误改 → 手动触发 + 编辑稿语义可还原；提示词做强保真约束。
- 升级 qwen-asr 包可能引入新依赖；失败不影响既有转写（保留旧版本可用）。
