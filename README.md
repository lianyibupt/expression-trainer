# 智能表达训练（Expression Trainer）-Elon 升级版

> 面向中文表达训练与会议复盘的本地 Electron 桌面应用。它把离线语音识别、词库分析、可选 LLM 教练反馈、会议纪要和本地音频分析组合为一条可审阅的工作流。

## 目录

- [功能概览](#功能概览)
- [隐私与能力边界](#隐私与能力边界)
- [运行环境](#运行环境)
- [快速开始](#快速开始)
- [ASR 模型与转写](#asr-模型与转写)
- [设置说明](#设置说明)
- [使用指南](#使用指南)
- [音频分析工作台](#音频分析工作台)
- [会议产物](#会议产物)
- [开发与测试](#开发与测试)
- [常见问题](#常见问题)

## 功能概览

### 工作流

~~~text
麦克风 / 系统输出 / 导入音频
              |
              v
      16 kHz 单声道 PCM
              |
    +---------+-----------+
    |                     |
    v                     v
实时 Paraformer      最终 Qwen3-ASR / SenseVoice
    |                     |
    +----------+----------+
               v
原文编辑 -> 词库分析 -> 会议纪要 / 表达报告
               |
               v
本地声学基线 + 可选说话人分离 + 可选 openSMILE
~~~

### 六个工作台

| 阶段 | 能力 | 本地 / 网络 |
| --- | --- | --- |
| 实时字幕 | 采集麦克风，可选混入系统输出；显示实时或最终转写 | 采集、Paraformer、SenseVoice 在本机；Qwen3-ASR 可本机运行 |
| 会议原文 | 编辑、粘贴、复制、保存逐字稿并触发文本分析 | 本机 |
| 会议纪要 | 从原文生成主题、结论、决策、待办、风险和下一步 | 需要 LLM；使用本地 Ollama 或内网兼容服务可不出网 |
| 表达优化 | 填充词、犹豫词、笼统词、表达密度和实时教练反馈 | 词库在本机；AI 反馈取决于后端 |
| 音频分析 | 导入音频、波形、静音/能量/音高代理、转写和互动分析 | 本机；导入需要 ffmpeg，转写需要 Qwen3-ASR |
| 表达报告 | 对结构、用词、直接性、行为模式和练习重点给建议 | 需要 LLM；可使用本地 Ollama |

### 当前能力

**录制与本地识别**

- 默认预设“Paraformer 实时 + Qwen3-ASR 最终稿”在录制中给出低延迟字幕，停止后用本机 Qwen3-ASR 生成最终逐字稿。
- “Paraformer 中英双语”仅提供流式识别；“SenseVoice Small int8”和自定义 SenseVoice 在停止录制后做离线最终转写；纯 Qwen3-ASR 也只在停止后生成最终稿。
- 支持开始、暂停、继续、结束。录音为 16 kHz、16-bit、单声道 PCM WAV，便于后续归档和分析。
- macOS 采集系统输出的优先级为 Native ScreenCaptureKit helper、已配置的虚拟输入设备、Electron loopback。
- 自动会议发现根据音量阈值工作：持续麦克风活跃后开始，录制中输入和输出均安静后进入人工确认；不会未经确认就保存或调用 LLM。

**表达训练与生成**

- 本地词库识别 25 个填充词、19 个犹豫词和 25 组笼统词替代建议，计算表达密度。
- 情感词库含 146 个情绪词及极性、类别、强度信息；分层词库实验页提供更多口语替换候选。
- 可设定个人训练目标、自定义触发规则、目标表达风格和个人口癖；它们会追加到实时反馈、报告或纪要提示词。
- 支持 OpenAI、DeepSeek、Ollama 和任意 OpenAI Chat Completions 兼容服务。
- 长会议原文按约 12,000 字符切分，先生成事实型中间摘要，再生成正式纪要。

**导入音频与分析**

- 支持 m4a、mp3、wav、aac、flac、ogg、webm；由 ffmpeg 规范化为临时 16 kHz 单声道 WAV。
- 无需转写即可做基础本地分析：时长、有效发言占比、静音时长、平均能量、峰值、能量变化、音高代理和时间线。
- “转写并分析”会运行 Qwen3-ASR，可选本地说话人分离，并统计说话人轮次、参与占比、语速代理、填充词/犹豫词、重叠和回应延迟。
- 可选 openSMILE eGeMAPS 为逐说话人补充韵律、响度、jitter、shimmer 等特征。其不可用不会阻塞基础分析或转写。
- 长任务显示加载模型、切片、转写、说话人分离和 openSMILE 进度，并可取消当前 Qwen3-ASR worker。

## 隐私与能力边界

### 数据去向

| 功能 | 是否默认上传 | 说明 |
| --- | --- | --- |
| 麦克风、系统输出、录音保存 | 否 | 音频仅在本机 renderer、Electron 主进程和本地文件之间流转 |
| Paraformer / SenseVoice | 否 | 使用本地 sherpa-onnx-node 模型 |
| Qwen3-ASR | 否；模型 ID 首次使用可能联网 | Python worker 在本机执行，模型 ID 的下载和缓存由 qwen-asr 处理 |
| 词库、基础声学、说话人聚类、openSMILE | 否 | 全部在本机执行 |
| 实时反馈、报告、会议纪要 | 取决于后端 | OpenAI、DeepSeek、远程兼容 API 会收到原文及统计；本地 Ollama 可避免外发请求 |

### 使用限制

- 词库命中、语速、音高、停顿、能量和“氛围”是训练提示，不是医学、心理、绩效或人事结论。
- 说话人分离只做本地匿名聚类，不识别真实身份。重叠说话、相近声线、噪声和远距离拾音会降低归属、互动指标和个人声学指标的可信度，必须结合原音复核。
- “担忧、挫败、积极投入”等来自词语和声学信号，不能推断真实内心状态；“讽刺”只能标记风险，不能凭音频确认。
- LLM 报告和纪要可能遗漏、误解或产生幻觉。决策、负责人、截止时间、风险和对外信息必须人工审核。
- 录制会议、系统声音或他人语音前，请取得参与者同意，并遵守适用的隐私、劳动、数据保护与公司政策。
- API Key 和自定义提示词保存在 Electron userData 目录。不要提交含真实密钥的设置文件或公开截图。

## 运行环境

### 当前支持范围

当前依赖包含 sherpa-onnx-darwin-arm64，系统音频 helper 使用 ScreenCaptureKit。因此，**完整、已配置的开发运行路径定位为 macOS 13+ 的 Apple Silicon（arm64）设备**。

| 组件 | 要求 | 何时需要 |
| --- | --- | --- |
| macOS | macOS 13+，Apple Silicon | 当前完整桌面能力；Swift Package 明确要求 macOS 13 |
| Node.js | 18+ | 安装依赖、运行 Electron 和测试 |
| npm | 随 Node.js 提供 | 运行脚本 |
| Xcode Command Line Tools / Swift 5.9+ | 推荐 | 构建系统音频 helper |
| 麦克风权限 | 必需 | 录制、自动发现、设备枚举 |
| 屏幕与系统音频录制权限 | 可选 | Native 系统输出采集 |
| Python 3 | 可选 | Qwen3-ASR、说话人分离、openSMILE |
| ffmpeg | 可选但强烈建议 | 导入外部音频；内置录音不依赖它 |
| 网络 | 可选 | 下载模型、远程 LLM 或模型 ID 首次拉取 |

Windows/Linux 的 Electron 代码路径和 loopback feature flag 不表示当前有可直接安装的完整支持。移植需要替换平台 ASR 二进制依赖，并自行验证音频采集、权限和打包。

~~~bash
# 可选：系统工具
xcode-select --install
brew install ffmpeg

# 确认环境
node --version
npm --version
python3 --version
ffmpeg -version
swift --version
~~~

## 快速开始

### 1. 安装 Node 依赖

~~~bash
git clone https://github.com/lianyibupt/expression-trainer.git
cd expression-trainer
npm ci
~~~

仓库提供 package-lock.json；首次安装和 CI 推荐 npm ci。开发时也可以使用 npm install。

### 2. 下载默认 Paraformer 模型

默认混合预设需要流式 Paraformer 模型：

~~~bash
mkdir -p models
cd models
curl -L -O https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2
tar -xjf sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2
cd ..
~~~

目录必须为：

~~~text
models/
└── sherpa-onnx-streaming-paraformer-bilingual-zh-en/
    ├── encoder.int8.onnx
    ├── decoder.int8.onnx
    └── tokens.txt
~~~

models/ 已被 .gitignore 忽略，不会随代码分发或提交。

### 3. 可选：配置 Qwen3-ASR 和说话人分离

默认混合预设、纯 Qwen3-ASR 预设和“转写并分析”都需要该环境：

~~~bash
python3 -m venv .venv-qwen3-asr
.venv-qwen3-asr/bin/python -m pip install --upgrade pip
.venv-qwen3-asr/bin/python -m pip install --upgrade qwen-asr scikit-learn
npm run check:qwen3-asr
~~~

scikit-learn 用于可选的本地说话人聚类。关闭“启用说话人分离”后，普通 Qwen3-ASR 转写不依赖它。Python 的查找顺序为：

1. QWEN3_ASR_PYTHON。
2. 项目根目录 .venv-qwen3-asr/bin/python。
3. PYTHON。
4. 系统 python3。

~~~bash
# 使用其他虚拟环境时显式指定
export QWEN3_ASR_PYTHON=/absolute/path/to/venv/bin/python
npm start
~~~

设置页的“Qwen3-ASR 模型路径或模型 ID”留空时使用 Qwen/Qwen3-ASR-1.7B。模型 ID 首次运行可能下载模型；严格离线时，请预先下载完整模型并在设置中填入本地绝对路径。

### 4. 可选：启用 openSMILE

~~~bash
.venv-qwen3-asr/bin/python -m pip install --upgrade opensmile
export OPENSMILE_PYTHON="$(pwd)/.venv-qwen3-asr/bin/python"
npm run check:opensmile
~~~

未设置 OPENSMILE_PYTHON 时，应用依次尝试 QWEN3_ASR_PYTHON、PYTHON、python3。openSMILE 失败会显示原因，但不会阻塞转写、基础声学分析或保存。

### 5. 可选：构建系统音频 helper

~~~bash
npm run build:system-audio-helper
~~~

产物为 native/system-audio-helper/.build/debug/system-audio-probe。首次使用系统输出采集时，授权真正启动 npm start 的宿主应用，例如 Terminal、iTerm、Codex 或打包应用，而不是只授权 helper 二进制；权限变化后需**完全退出并重启**宿主应用。

验证采集链路：

~~~bash
# 先播放系统声音
npm run probe:system-audio
~~~

/tmp/system-audio-probe.wav 应能听到播放内容。个别 RMS 输出为 0 不必然表示失败，应以最终 WAV 为准。

### 6. 启动

~~~bash
npm start
~~~

首次使用时：

1. 授予麦克风权限。
2. 打开右上角设置，选择 AI 后端、ASR 预设和录制策略。
3. 若需系统音频，启用“录制系统输出声音”，并确保 helper 已构建或选择了虚拟音频输入。
4. 点击“开始录制”，或进入“会议原文”直接粘贴已有文本。

## ASR 模型与转写

| 设置页预设 | 录制中字幕 | 停止后最终稿 | 所需资源 | 推荐场景 |
| --- | --- | --- | --- | --- |
| Paraformer 实时 + Qwen3-ASR 最终稿 | Paraformer 实时 | Qwen3-ASR 异步生成并替换原文 | Paraformer、Python qwen-asr、Qwen 模型 | 默认会议录制，兼顾字幕和最终稿 |
| Paraformer 中英双语 | Paraformer 实时 | 收尾当前流式结果 | Paraformer | 低延迟字幕优先 |
| SenseVoice Small int8 | 无 | SenseVoice 离线最终稿 | SenseVoice int8 | 简单离线最终转写 |
| Qwen3-ASR | 无 | Qwen3-ASR 最终稿 | Python qwen-asr、Qwen 模型 | 最终稿准确性优先 |
| 自定义 SenseVoice 兼容导出 | 无 | SenseVoice 离线最终稿 | 兼容导出目录 | 已有已验证模型 |

**中英混说的语言提示**

- 默认情况下 Qwen3-ASR 最终转写使用**自动语种识别**（worker 的 `--language` 为 `none`），适合中英文夹杂的会议。
- 可在设置页「Qwen3 转写语言」固定为「中文为主」或「English 为主」；也支持环境变量 `QWEN3_ASR_LANGUAGE`（取值 `auto`/`Chinese`/`English`，或逗号分隔如 `Chinese,English`）。设置页选项优先于环境变量；环境变量只在直接调用本模块且未指定语言时生效（如脚本/API 调用方）。
- 说话人分离按片段转写，语言提示对归属无影响。
- 使用 `pip install -U qwen-asr` 保持 qwen-asr 依赖为最新（当前 PyPI 最新 0.0.6，支持按语言列表转写）。

**错字润稿（AI）**

- 「会议原文」面板的 **AI 修正错字** 按钮会把当前原文交给已配置的 LLM，只修正语音识别错误（同音/近音错字、中英文字边界、数字标点），保留填充词、口语、重复与说话人标签；不会改写表达。
- 结果为“编辑稿”，写回编辑框（按钮上悬停可见说明）；审阅后点“保存”才会写入会议产物，不会自动覆盖最终稿。

### SenseVoice 目录

预设 SenseVoice 的目录：

~~~text
models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17-int8/
├── model.int8.onnx
└── tokens.txt
~~~

自定义 SenseVoice 目录至少包含：

~~~text
/absolute/path/to/sensevoice-export/
├── model.onnx
└── tokens.json
~~~

模型必须是 sherpa-onnx 兼容导出，并带有所需 vocab_size 元数据。普通 FunASR、Shandianshuo 或不兼容 ONNX 导出可能无法加载；遇到 vocab_size 报错时，请换兼容模型或切换 Paraformer，不要强行修改加载逻辑。

### Qwen3-ASR 高级参数

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| QWEN3_ASR_PYTHON | 自动发现 | 指定 Python worker |
| QWEN3_ASR_CHUNK_SECONDS | 45 | 单次推理批次的最长音频秒数 |
| QWEN3_ASR_TIMEOUT_MS | 至少 10 分钟，随音频长度增加 | 最终转写超时 |
| QWEN3_ASR_DEVICE_MAP | auto | 传给 Qwen3-ASR 的设备映射 |
| QWEN3_ASR_MAX_NEW_TOKENS | 4096 | 单次生成最大 token 数 |
| QWEN3_ASR_BATCH_SIZE | 1 | 推理批量参数 |
| QWEN3_ASR_LANGUAGE | auto | `auto`（默认，自动语种识别）/ `Chinese` / `English`，或逗号分隔如 `Chinese,English`；设置页「Qwen3 转写语言」优先于该环境变量 |
| OPENSMILE_PYTHON | 自动发现 | 指定 openSMILE Python worker |

先用短音频验证设备映射、批次和切片，再用于正式会议；这些参数可能影响内存、显存和延迟。

## 设置说明

设置在当前用户范围内保存；返回或取消不会保存未提交内容。

### AI 后端

| 后端 | 配置 | 请求端点 |
| --- | --- | --- |
| OpenAI | API Key、模型 | https://api.openai.com/v1/chat/completions |
| DeepSeek | API Key、模型 | https://api.deepseek.com/v1/chat/completions |
| Ollama | 服务地址、模型 | {ollamaUrl}/v1/chat/completions |
| 自定义 | API Key、Base URL、模型 | {baseUrl}/chat/completions |

自定义 Base URL 应填写 API 版本根路径，例如 https://api.example.com/v1，应用会自动追加 /chat/completions。先使用设置页的连通性测试验证端点、鉴权和模型 ID。内置下拉模型只是便捷默认值，不保证某服务持续提供。

### 识别、录制和归档

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| 本地识别模型 | Paraformer 实时 + Qwen3-ASR 最终稿 | 选择 ASR 预设 |
| Qwen3-ASR 模型路径或模型 ID | Qwen/Qwen3-ASR-1.7B | 需要 Qwen 的预设使用；可填本地目录 |
| 自定义 SenseVoice 模型目录 | 空 | 只在自定义 SenseVoice 使用 |
| 启用说话人分离 | 开启 | 只影响 Qwen 最终稿和“转写并分析”，不影响实时字幕 |
| 会议文件保存目录 | Documents/Expression Trainer Meetings | 留空使用系统 Documents 下默认路径 |
| 打开应用后自动开始录音 | 关闭 | 进入主界面后立即开始；不同于自动发现 |
| 登录后自动启动应用 | 关闭 | 启动后才能监听会议 |
| 自动监听麦克风并发现会议 | 关闭 | 连续麦克风活跃达到阈值后录制 |
| 录制系统输出声音 | 开启 | Native helper、虚拟输入或 Electron loopback |
| 麦克风输入设备 | 系统默认 | 可指定 audioinput |
| 系统音频输入设备 | 不使用虚拟输入 | Native helper 失败时的 BlackHole / Loopback 兜底 |
| 自动开始阈值 | 60 秒 | 可配 5 至 600 秒 |
| 待确认阈值 | 180 秒 | 输入、输出均安静后确认；可配 30 至 1800 秒 |
| 最短录音确认时长 | 120 秒 | 更短的自动录音将丢弃；可配 30 至 3600 秒 |
| 麦克风活跃阈值 | 0.02 | 噪声大调高，漏检调低；可配 0.001 至 0.2 |
| 确认后保存原始对话和报告 | 开启 | 允许确认流程持久化 |
| 确认时允许生成对话报告 | 开启 | 允许确认流程调用 LLM |

自动开始只检查**麦克风**持续活跃，避免纯播放音频触发；开始后麦克风或系统输出任一活跃都保持录制。二者都静音达到阈值时，短录音丢弃，其他录音请求用户确认。它是音量检测，不理解日历、会议应用或内容；应按实际设备校准。

系统音频捕获顺序为：1) 已构建且已授权的 Native helper；2) 设置的虚拟输入；3) Electron getDisplayMedia 的 audio: loopback 回退。Native helper 将系统输出重采样为 16 kHz 单声道 PCM 后与麦克风混合，因此不能替代独立声道录制。

## 使用指南

### 录制表达训练

1. 确认 ASR 预设、麦克风和 AI 后端；只做本地词库训练时无需配置 AI。
2. 在“实时字幕”点击“开始录制”，接受麦克风及可选系统音频权限。
3. 查看字幕和“表达优化”统计。Paraformer 实时显示；SenseVoice 或纯 Qwen3-ASR 在结束后给出最终稿。
4. 暂停会停止处理和计时，继续后恢复；暂停时间不计入训练时长。
5. 结束后，混合预设或 Qwen3-ASR 可能继续生成最终稿；最终稿填入“会议原文”，说话人标签保持匿名。
6. 在确认面板选择丢弃、保存原文，或保存并生成报告。所有生成结果应人工审阅。

### 连续会议与标签管理

顶部“＋ 新会议”创建独立会议，名称可直接编辑。左侧六个功能阶段保持不变，
切换会议时原文、说话人、纪要、报告和音频预览一起切换。上一场停止后可以立即
开始下一场录音，不必等待上一场最终转写；全局录音提示始终标明正在录制哪一场。

标签上的“×”只关闭显示，不删除内容或取消后台任务。“最近关闭”可在本次应用
运行期间重新打开会议；正在启动、录制或结束录音的标签需先结束录音才能关闭。
**未保存内容（包括关闭的标签）仅保留到本次应用退出，请及时保存。**

保存按钮、默认文件名和文件头标明会议名称、开始时间及会议 ID，原文版本也会
保留在文件中。点击保存后切换或关闭标签，不会改变保存目标。人工编辑的原文
不会被后台最终稿静默替换；可使用“采用最终稿”按钮明确替换编辑稿。

### 使用已有原文

1. 在“实时字幕”点击“粘贴原文”，或直接打开“会议原文”。
2. 粘贴或编辑后点击“分析当前原文”。
3. 在“表达优化”查看本地统计；在“会议纪要”生成纪要；在“报告”生成表达报告。

粘贴原文没有录音和声学指标，但仍可生成文本分析、纪要和报告。

### 会议纪要与训练规则

会议纪要固定包含会议主题、核心结论、讨论要点、决策事项、待办事项、风险与未决问题和下一步行动。决策和待办以表格输出；提示词要求无明确证据的负责人、截止时间、状态、依据、影响和决策写“未明确”，但这不是事实保证。

顶部训练规则按钮可设置训练目标、自定义触发规则、目标风格和个人口癖。它们是追加提示，不是可编程规则引擎；私密内容会随远程 LLM 请求发送给对应后端。

## 音频分析工作台

### 输入和操作

在“音频分析”拖入文件或点击“选择音频”。应用用 ffmpeg 转成临时 16 kHz、单声道、16-bit PCM WAV。

| 操作 | 前提 | 结果 |
| --- | --- | --- |
| 开始分析 | 已选择文件、ffmpeg 可用 | 本地波形和基础声学分析，不需 Qwen 或网络 |
| 转写并分析 | 已选择文件、ffmpeg、Qwen3-ASR 可用 | 先基础分析，再本地转写、可选说话人分离、互动和清晰度分析 |
| 取消分析 | Qwen3-ASR 正在运行 | 终止当前 Python worker；不写入不完整转写 |

### 指标解释

| 指标 | 用途 | 不能代表 |
| --- | --- | --- |
| 有效发言占比 | 能量超过动态阈值的时间占比 | 某个人真实说话占比、会议效率 |
| 静音时长 / 停顿负荷 | 低于阈值的帧时长 | 固定的沉默质量；噪声与降噪会影响它 |
| 能量、峰值、能量变化 | RMS、峰值、帧间变化，帮助定位回听片段 | 情绪强烈程度或音量好坏 |
| 音高代理、音高变化 | 零交叉的轻量估计 | 临床或音乐学基频测量 |
| 时间线 | 分窗口汇总能量、停顿和稳定性 | 情绪标注 |
| 参与均衡度、轮次、回应延迟 | 依赖说话人分离片段 | 分离失败后仍然可靠的互动事实 |
| 填充词、犹豫词、长句、信息密度 | 对最终转写的规则计数 | 不受 ASR 错字、标点影响的绝对指标 |
| 氛围信号和 openSMILE | 训练与回听辅助 | 对真实心理状态的判断 |

推荐先“开始分析”定位长静音和能量突变，确认音质后再“转写并分析”。多人会议请先核对匿名说话人标签与原音，再使用互动或个人声学结论。

## 会议产物

会议根目录为空时，保存到：

~~~text
<系统 Documents>/Expression Trainer Meetings/
~~~

每场会议按录音开始时间和固定会议 ID 建立独立目录，再次保存同一场会议会更新该目录：

~~~text
Expression Trainer Meetings/
└── 2026-09-02-143015-<session-id>/
    ├── transcript.md            # 原始对话、时间、时长、字数
    ├── report.md                # 可选：LLM 表达报告
    ├── minutes.md               # 可选：LLM 会议纪要
    ├── meeting.wav              # 可选：16 kHz 单声道 PCM 录音副本
    ├── audio-analysis.json      # 可选：机器可读分析
    ├── audio-analysis.md        # 可选：可读分析摘要
    └── metadata.json            # 会话元信息和已写入文件索引
~~~

同一秒的会议也有不同 ID，不会共享目录；旧版无会议 ID 的产物仍保留时间戳和 -2、-3 等后缀规则。report.md、minutes.md 和音频文件仅在实际生成或存在输入时出现；metadata.json 会随保存操作更新。

audio-analysis.json 顶层结构是版本化对象：

~~~json
{
  "version": 2,
  "audio": {
    "version": 1,
    "durationSeconds": 0,
    "speechRatio": 0,
    "timeline": [],
    "interpretation": {},
    "speakerAcoustics": {},
    "openSmile": {}
  },
  "atmosphere": {},
  "interaction": {},
  "clarity": {},
  "limitations": []
}
~~~

字段可缺失或为空：没有说话人片段时无个人声学数据；openSMILE 未安装时 openSmile.enabled 为 false 并携带错误原因；仅基础分析时没有转写驱动的互动和清晰度信息。下游程序应检查字段存在性。

## 开发与测试

### 脚本

~~~bash
npm start                         # Electron 启动
npm run dev                       # Electron 启动并传入 --dev
npm test                          # Node 内置测试
npm run build:system-audio-helper # 构建 Native helper
npm run probe:system-audio        # 录制 10 秒系统输出到 /tmp/system-audio-probe.wav
npm run check:qwen3-asr           # 验证 qwen-asr Python 环境
npm run check:opensmile           # 验证 opensmile Python 环境
~~~

当前仓库没有终端用户安装包构建或发布脚本。若要分发，需要额外设计签名、公证、模型随包策略、权限说明和平台二进制依赖。

### 目录

~~~text
.
├── main.js                         # Electron 主进程、IPC、设置、保存、系统音频 helper
├── preload.js                      # renderer <-> main IPC bridge
├── src/
│   ├── index.html / app.js         # 六阶段工作台和交互逻辑
│   ├── settings.html / settings.js # AI、ASR、录音和设备设置
│   ├── prompt-editor.html          # 个人训练规则
│   ├── lexicon-playground.html     # 分层词库实验页
│   └── styles.css
├── lib/
│   ├── asr.js                      # Sherpa-ONNX / Qwen3-ASR
│   ├── audio-analysis.js           # 声学、互动、清晰度分析
│   ├── audio-mix.js                # PCM 混音
│   ├── ai-feedback.js / prompts.js # LLM 调用和提示词
│   ├── lexicon.js                  # 词库匹配
│   ├── meeting-activity-detector.js
│   ├── meeting-session.js
│   └── opensmile.js
├── scripts/                        # Qwen3-ASR 与 openSMILE Python worker
├── native/system-audio-helper/     # ScreenCaptureKit Swift helper
├── data/                           # emotion-lexicon.json、tiered-lexicon.json
├── test/                           # Node 测试
├── settings.example.json           # 示例结构，不能放真实密钥
└── models/                         # 用户下载的模型，已忽略
~~~

测试覆盖 ASR 预设、音频混音、基础声学统计、说话人声学指标、自动会议检测、纪要 UI/提示词和会议归档。它不覆盖真实权限、真实 ScreenCaptureKit、真实 Qwen 推理、远程 LLM 与所有硬件路由，目标机器仍需手工验收。

## 常见问题

### Paraformer 模型文件未找到

确认目录名和文件名完全匹配：

~~~text
models/sherpa-onnx-streaming-paraformer-bilingual-zh-en/
├── encoder.int8.onnx
├── decoder.int8.onnx
└── tokens.txt
~~~

不要只放压缩包、额外嵌套一层目录或其他架构模型。

### SenseVoice 报 vocab_size 缺失

该 ONNX 不是 sherpa-onnx-node 可直接加载的兼容导出。换用兼容的 SenseVoice int8，或切换 Paraformer；不要强行绕过该检查。

### Qwen3-ASR 无法启动、超时或没有最终稿

1. 运行 npm run check:qwen3-asr，确认当前 Python 能导入 torch 和 qwen_asr。
2. 检查 echo "$QWEN3_ASR_PYTHON"，必要时显式指定正确虚拟环境。
3. 确认模型 ID 已完成首次下载，或本地模型路径有效。
4. 长录音可提高 QWEN3_ASR_TIMEOUT_MS，或降低 QWEN3_ASR_CHUNK_SECONDS 后重试。
5. 只有分离失败时，关闭“启用说话人分离”或安装 scikit-learn；worker 会尽力保留普通转写。

### 导入音频时 ffmpeg 转码失败

~~~bash
brew install ffmpeg
which ffmpeg
ffmpeg -version
~~~

重启从该终端启动的 Electron。DRM 保护、损坏、无音频流或不支持的文件仍会失败。

### macOS 录不到系统声音

1. 运行 npm run build:system-audio-helper。
2. 播放系统声音后运行 npm run probe:system-audio，检查 /tmp/system-audio-probe.wav。
3. 向真正启动应用的 Terminal、iTerm、Codex 或打包应用授予“屏幕与系统音频录制”权限。
4. 完全退出并重启宿主应用。
5. Native helper 失败时，选择 BlackHole / Loopback 等虚拟输入。不要把它和麦克风选择成同一设备。

### 自动发现误触发、没有个人指标或 LLM 失败

- 环境噪音误触发时提高“麦克风活跃阈值”或增加“自动开始阈值”；正常讲话漏检时降低阈值。持续系统音频可能延迟结束确认。
- 个人声学指标需要“转写并分析”产生可靠说话人片段；openSMILE 还需要安装并配置。无论结果如何，都应回听验证。
- LLM 失败时检查 API Key、模型 ID、网络、额度和区域限制。自定义 Base URL 应是 /v1 等根路径，应用会追加 /chat/completions；Ollama 必须运行并已拉取目标模型。

### 完全离线使用

1. 预先下载 Paraformer、SenseVoice 或 Qwen3-ASR 本地模型。
2. 使用本地 Python 环境和可选 openSMILE。
3. 不配置远程 OpenAI、DeepSeek 或远程兼容 API；如需生成式能力，使用本地 Ollama 或内网服务。
4. 关闭不需要的系统音频采集，并把会话目录保存到受控本地磁盘。

完全离线不会改变模型许可证、设备权限、生成内容风险或会议录音合规义务。

## License

[MIT](LICENSE)
