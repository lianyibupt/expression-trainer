# 智能会议和表达训练：macOS 试用版

## 安装和首次使用

1. 使用 Apple Silicon（M 系列）Mac，系统版本 macOS 14 或更高。当前 PyTorch arm64 wheel 的平台要求为 macOS 14，应用据此设置最低系统版本；目前实机验证环境为 macOS 26.2，其他版本仍需实机验证。
2. 打开 `MeetingExpressionTrainer-1.0.0-arm64.dmg`，把“智能会议和表达训练”拖到“应用程序”，然后从应用程序启动。不要长期直接在挂载的 DMG 中运行。
3. 本包采用 ad-hoc 本地签名，没有 Developer ID 签名和 Apple 公证。首次启动可能被系统拦截。确认收到的是可信试用包后，按 Apple 官方流程在“系统设置 → 隐私与安全性”对该应用选择“仍要打开”：https://support.apple.com/zh-cn/102445 。无需关闭系统的整体安全保护。
4. 首次启动会打开资源准备页面。选择“一键准备全部资源”，或者先下载“实时字幕”，在设置中选择“Paraformer 中英双语”。全部能力对应七项资源，准备完成后都应显示“已就绪”。
5. 打开设置，填写自己的 AI 服务、模型和 API Key，并使用连接测试。安装包没有预填 API Key，也不会携带开发者的会议数据。Ollama 选项连接用户已有的本地服务，本包不安装 Ollama 或其大语言模型。
6. 首次使用麦克风或系统声音时，按系统提示授予相应权限。系统声音权限修改后可能需要完全退出并重新启动应用。

## 资源和空间

- 实时字幕 Paraformer：约 237 MB。
- Qwen3-ASR-1.7B：约 4.70 GB。
- 实时语气 emotion2vec_plus_base：约 1.12 GB。
- SenseVoice int8：约 240 MB，可作为替代识别预设。
- 独立 Python：压缩下载约 25 MB；音频转换依赖约数十 MB；ASR 和语气的独立 Python 依赖另外占用数 GB。
- 建议至少保留 15 GB 可用空间。实际使用空间和下载量由所选资源及依赖决定。

资源分别从 GitHub、Hugging Face、PyPI 下载，需要能够访问这些服务。下载模型固定版本并检查完整性；中断的大文件支持断点续传，校验失败不会显示已就绪。Python 环境由应用创建，用户不需要自己运行命令安装依赖。依赖安装失败后可重试，会复用已安装的有效依赖。

菜单“智能会议和表达训练 → 资源下载与检查”和设置页都能重新打开资源页面。下载不会上传录音。首次资源准备需要联网；本地识别的 worker 默认禁止自行联网下载模型。

## 数据与升级

为保留旧版配置，安装版继续使用 macOS Application Support 下的 `智能表达训练` 用户数据目录。资源位于其中的 `resources/v1/`，与 `.app` 分开，替换应用不会删除模型。录音、逐字稿、报告仍保存在设置指定的会议目录。

用户自行填写的 API Key 存储于现有的用户设置文件，当前未新增 Keychain 加密。不要分享自己的用户数据目录。远程 AI 服务按用户配置接收原文等请求内容。

第三方资源遵循各自许可，特别是 openSMILE 和 emotion2vec 模型不能因本项目为 MIT 而推定获得商业使用权。详见根目录 `THIRD_PARTY_NOTICES.md`。

## 从源码构建和验证

```sh
npm ci
npm run dist:mac
npm run verify:package
npm test
# 启动安装版，使用全新临时配置检查界面和原生模块。
node test/integration.resources.electron.js
# 另行执行真实下载及实时识别启动/结束检查。
VERIFY_RESOURCE_DOWNLOADS=1 node test/integration.resources.electron.js
```

构建需要 macOS、Node/npm 和 Swift Command Line Tools；这些是构建者的要求。Electron 及 Sherpa 原生库随包提供。包内容采用明确白名单，排除 `settings.json`、自定义提示词、会议文件、模型、虚拟环境、开发缓存和测试。

## 验证边界

自动化覆盖实际安装版的首次窗口、资源页面、空密钥默认值、设置入口、原生库加载、真实资源下载和合成音频识别流程。另在干净的临时 Python 环境中检查最终转写、说话人分离、openSMILE 和语气模型推理。模型完整性检查可复用本机已有模型文件，不代表每个大模型都重新从网络下载。

真实麦克风和系统声音的首次授权、睡眠唤醒、不同耳机/会议软件路由，以及另一台没有开发环境的 Mac，仍需手工验收。说话人分离只验证流程可执行，其准确度仍需结合原音检查。
