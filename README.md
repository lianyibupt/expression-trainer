# 🚀 智能表达训练系统 - 本地桌面版

> 👉 **在线版已上线：[exprtrain.online](https://exprtrain.online)**，无需安装，打开浏览器即用。支持中英双语。

一个帮你训练口语表达精准度的本地桌面应用。实时语音识别 → 词库匹配 → AI反馈，全程离线+本地处理。

## 功能

- 🎤 **实时语音识别**：基于 Sherpa-ONNX，完全离线，中文优化
- 🎙️ **会议自动转写**：支持本机麦克风录音，可配置 SenseVoice/Paraformer 离线转文字
- 🔊 **系统输出录制**：macOS 优先使用 Native ScreenCaptureKit helper 直接捕获系统声音，无需 BlackHole；不可用时再回退到虚拟声卡/Electron loopback
- 👂 **自动发现会议**：后台监听麦克风活跃度，连续活跃后自动开始录音，长时间无输入后进入确认
- 🗂️ **会议产物归档**：录音结束后先确认，再保存原始对话、分析报告和元数据
- 📝 **全屏字幕显示**：黑底大字，实时显示你说的每一句话
- 🔍 **词库分析**：自动检测填充词、犹豫词、笼统词，给出精准替代
- 🤖 **AI反馈**：支持 Groq/OpenAI/DeepSeek/Ollama 多后端
- 📊 **分析报告**：6维度深度分析（逻辑/直接性/填充词/密度/词汇/亮点）

## 安装

### 1. 克隆项目 & 安装依赖

```bash
cd expression-trainer
npm install
```

### 2. 配置语音识别模型

默认推荐使用 sherpa-onnx 兼容导出的 SenseVoice Small int8：

```text
models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17-int8/
```

目录内应包含：

```text
sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17-int8/
├── model.int8.onnx
└── tokens.txt
```

推荐顺序：

| 模型预设 | 场景 | 特点 |
|------|------|------|
| Paraformer 实时 + Qwen3-ASR 最终稿 | 会议场景推荐 | 录制中低延迟字幕，结束后用 Qwen3-ASR 重新生成更准确的最终稿 |
| SenseVoice Small int8 | 中文会议、结束后生成逐字稿 | 小模型、本地离线、非实时最终转写 |
| Paraformer 中英双语 | 需要边说边看实时字幕 | 流式识别、延迟低 |
| Qwen3-ASR | 更重视最终稿准确率、不需要实时字幕 | Python qwen-asr worker，离线最终转写 |
| 自定义 SenseVoice 兼容导出 | 你自己转换/下载了 sherpa-onnx 兼容 SenseVoice | 需要目录内有 `model.onnx` 和 `tokens.json` |

注意：当前项目通过 `sherpa-onnx-node` 加载 SenseVoice。你之前提供的 Shandianshuo 模型实测缺少 sherpa-onnx 所需的 `vocab_size` 元数据，不能直接作为默认模型；因此新版默认改为官方 sherpa-onnx 兼容的 SenseVoice int8 目录。

使用 Paraformer 预设时需要下载 streaming paraformer 中英双语模型：

需要下载 Sherpa-ONNX 的 streaming paraformer 中英双语模型：

```bash
cd models

# 方法一：使用 wget
wget https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2
tar xvf sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2

# 方法二：使用 huggingface
# https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en
```

使用 Qwen3-ASR 最终稿时，需要 Python `qwen-asr` 环境。当前项目推荐使用仓库内隔离环境 `.venv-qwen3-asr`：

```bash
python3 -m venv .venv-qwen3-asr
PIP_CACHE_DIR=$(pwd)/.pip-cache .venv-qwen3-asr/bin/python -m pip install -U pip qwen-asr
npm run check:qwen3-asr
```

应用会优先使用 `.venv-qwen3-asr/bin/python`。如果你想使用其它 Python 环境，可以在启动前指定：

```bash
export QWEN3_ASR_PYTHON=/path/to/qwen3-asr/bin/python
npm start
```

设置页的“Qwen3-ASR 模型路径或模型 ID”可以填写本地模型目录，也可以留空使用默认 `Qwen/Qwen3-ASR-1.7B`。首次使用模型 ID 时，`qwen-asr` 会按它自己的缓存规则下载模型；如果你希望完全本地离线，先把模型下载到本机目录，再把该目录填进设置页。

下载后 `models/` 目录应包含：
```
models/
└── sherpa-onnx-streaming-paraformer-bilingual-zh-en/
    ├── encoder.int8.onnx
    ├── decoder.int8.onnx
    └── tokens.txt
```
### 3. 启动应用

如需录制系统输出声音，先构建 macOS Native helper：

```bash
npm run build:system-audio-helper
```

第一次使用系统输出录制时，macOS 可能会要求授予屏幕录制/系统音频录制权限。开发模式下通常需要授权给启动应用的 Terminal、iTerm、Codex，或者你打包后的应用本身；授权后请完全退出并重新打开应用。

```bash
npm start
```

### 4. 配置 AI 后端和会议录音

启动后点击右上角 ⚙️ 进入设置页面。

会议录音设置：

| 选项 | 说明 |
|------|------|
| 本地识别模型 | 默认 Paraformer 实时 + Qwen3-ASR 最终稿；也可切换纯 Paraformer、SenseVoice 或纯 Qwen3-ASR |
| Qwen3-ASR 模型路径或模型 ID | 选择“Paraformer 实时 + Qwen3-ASR 最终稿”或“Qwen3-ASR”时显示；留空使用 `Qwen/Qwen3-ASR-1.7B` |
| 自定义 SenseVoice 模型目录 | 仅在选择自定义预设时填写，必须是 sherpa-onnx 兼容导出 |
| 会议文件保存目录 | 留空时保存到 `Documents/Expression Trainer Meetings` |
| 打开应用后自动开始录音 | 开启后进入主界面会自动请求麦克风并开始录音 |
| 登录后自动启动应用 | 尽量避免忘记打开应用；应用启动后才能监听麦克风 |
| 自动监听麦克风并发现会议 | 开启后后台监听音量，连续活跃达到阈值后开始录音 |
| 录制系统输出声音 | 开启后会按 Native helper → 系统音频输入设备 → Electron loopback 的顺序捕获系统输出，并与麦克风混合转写 |
| 麦克风输入设备 | 默认使用系统麦克风，也可指定某个输入设备 |
| 系统音频输入设备 | Native helper 不可用时的兜底方案，可选择 BlackHole 2ch / Loopback 等虚拟声卡输入 |
| 自动开始阈值 | 默认 60 秒，表示连续检测到麦克风输入 1 分钟后开始录音 |
| 待确认阈值 | 默认 180 秒，表示连续无麦克风输入 3 分钟后停止录音并弹出确认 |
| 最短录音确认时长 | 默认 120 秒，短于该时长的自动录音会当作误触忽略 |
| 麦克风活跃阈值 | 默认 0.02，环境噪音大调高，检测不到说话调低 |
| 确认后保存原始对话和报告 | 开启后，你在确认框选择保存时才会创建会议目录 |
| 确认时允许生成对话报告 | 开启后，确认框会允许保存并生成报告 |

自动发现会议说明：应用必须处于运行状态才能监听。建议同时开启“登录后自动启动应用”“自动监听麦克风并发现会议”和“录制系统输出声音”。在 macOS 上构建 Native helper 后，应用会同时观察麦克风输入和系统输出；会议结束时不会自动保存和生成报告，而是停止录音并弹出确认框，避免短时误触或误判直接写入文件。

系统输出录制说明：当前首选方案是仓库内的 macOS Native helper，它基于 ScreenCaptureKit 直接捕获系统输出声音，并通过 JSON PCM 流送回 Electron 与麦克风混合后进入 ASR。开启“录制系统输出声音”后，如果看到“已接入 Native 系统音频”或“Native 系统音频已启动”，说明已走原生通道。若 helper 未构建、未授权或启动失败，应用会继续尝试设置页选择的 BlackHole / Loopback 等虚拟输入设备；再失败才会尝试 Electron display media handler 的 `audio: 'loopback'` 方案。

可单独验证 Native helper：

```bash
npm run probe:system-audio
```

播放一段系统声音后，确认 `/tmp/system-audio-probe.wav` 能听到系统输出即可。即使终端里某些 RMS 行显示为 0，只要最终 wav 文件有系统声音，就说明捕获链路可用。

推荐配置：

| 后端 | 费用 | 速度 | 获取方式 |
|------|------|------|----------|
| DeepSeek | 极低 | 快 | [platform.deepseek.com](https://platform.deepseek.com) |
| OpenAI | 中等 | 快 | [platform.openai.com](https://platform.openai.com) |
| Ollama | 免费 | 取决于硬件 | [ollama.com](https://ollama.com) 本地运行 |

**推荐 deepseek**：生成报告质量高，且成本极低。

## 使用说明

1. **点击「开始录制」** → 对着麦克风说话
2. 使用 SenseVoice 时，结束录音后会生成最终逐字稿；使用 Paraformer 时会实时显示字幕
3. **左侧面板**实时统计填充词/犹豫词/笼统词
4. **右侧面板**每50字会给出AI实时反馈
5. **说完后点击「结束」** → 先确认是否保存原始对话，或保存并生成报告

自动模式下可以不用点击「开始录制」：开启“自动监听麦克风并发现会议”后，应用会在后台检测麦克风活跃度；连续活跃达到 60 秒后自动开始录音，连续无输入达到 180 秒后停止录音并弹出确认。短于 120 秒的自动录音会被当作误触忽略，不会保存也不会生成报告。

自动归档目录结构示例：

```text
Documents/Expression Trainer Meetings/
└── 2026-08-03-091011/
    ├── transcript.md   # 原始对话
    ├── report.md       # 对话分析报告
    └── metadata.json   # 时长、字数、文件索引等元数据
```

## 字幕颜色含义

| 颜色 | 含义 |
|------|------|
| 🔴 红色波浪下划线 | 填充词（嗯、啊、那个、然后…） |
| 🟠 橙色 | 犹豫词（可能、也许、我觉得…） |
| 🟡 黄色虚线 | 笼统词（有精准替代建议） |
| 🟢 绿色 | 有力表达（好句子！） |

## 技术架构

```
┌─────────────────────────────────────────┐
│ Electron 主进程                          │
│  ├── SenseVoice / Sherpa-ONNX (离线语音识别) │
│  ├── macOS Native helper (系统输出音频)       │
│  ├── 词库匹配 (emotion-lexicon.json)     │
│  ├── 会议产物归档 (transcript/report)     │
│  └── AI反馈 (多后端 HTTP API)            │
├─────────────────────────────────────────┤
│ 渲染进程 (Chromium)                      │
│  ├── 全屏字幕显示                        │
│  ├── 实时统计面板                        │
│  └── 分析报告弹窗                        │
└─────────────────────────────────────────┘
```

## 词库说明

`data/emotion-lexicon.json` 基于大连理工情感词库7大类结构，包含：

- **130+ 情绪词**：分类（喜怒哀惧恶惊）+ 强度（1-9）
- **笼统词→精准词映射**：25组高频替代建议
- **填充词表**：24个常见口头禅
- **犹豫词表**：19个弱化表达
- **程度词梯度**：弱→中→强→极 四级
- **画面化描述**：10组「抽象→具象」转换
- **犹豫→直接转换**：8组对照示例

## 开发

```bash
# 开发模式（带DevTools）
npm run dev

# 构建 macOS 系统音频 Native helper
npm run build:system-audio-helper

# 录制 10 秒系统输出到 /tmp/system-audio-probe.wav，用于验证权限和捕获链路
npm run probe:system-audio

# 目录结构
├── main.js              # Electron主进程
├── preload.js           # preload脚本
├── src/
│   ├── index.html       # 主界面
│   ├── settings.html    # 设置页
│   ├── styles.css       # 样式
│   ├── app.js           # 前端逻辑
│   └── settings.js      # 设置逻辑
├── lib/
│   ├── asr.js           # 语音识别
│   ├── lexicon.js       # 词库匹配
│   ├── ai-feedback.js   # AI反馈
│   ├── meeting-session.js # 会议原文/报告归档
│   └── prompts.js       # Prompt模板
├── native/
│   └── system-audio-helper/ # macOS ScreenCaptureKit 系统音频 helper
├── data/
│   └── emotion-lexicon.json
└── models/              # Sherpa-ONNX模型（需下载）
```

## 系统要求

- macOS 12+ / Windows 10+ / Linux
- Node.js 18+
- 麦克风权限
- （可选）网络连接（用于AI反馈，词库分析可离线）

## License

MIT
