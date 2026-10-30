# 实时情绪反馈实施计划

**Goal:** 会议进行中显示本地语音情绪类别，移除会后个人情绪分析。

**Architecture:** PCM 从现有 feed-audio 旁路进入有界分窗控制器，再由常驻 Python worker 推理；按 sessionId 回传状态与标签。独立项目环境和本地模型，不改变现有字幕引擎。

**Tech Stack:** Electron IPC、Node.js、Python、FunASR、emotion2vec+ base。

按 executing-plans 在当前会话逐项执行，保留工作区已有声音来源改动，不提交其他任务的文件。

1. [x] 新建 `test/live-emotion.test.js`：6 秒窗口、3 秒步进、推理只留最新、暂停和重录隔离、静音与异常状态；先运行确认失败。
2. [x] 新建 `lib/live-emotion.js` 实现上述控制器和 worker 协议；`scripts/emotion_worker.py` 仅加载本地模型并输出 labels/scores；`scripts/setup_emotion.py` 在独立环境安装并下载模型。
3. [x] 修改 `main.js`、`preload.js`、`src/meeting-sessions.js`：从现有 PCM 旁路分析，订阅按会议过滤的事件，显式暂停/恢复并清空窗口；停止和启动失败均清理。
4. [x] 修改 `src/app.js`、`src/index.html`、`src/styles.css`，增加实时语气卡片、模型分数及状态；移除个人声学表列与会后误导文案。
5. [x] 修改 `lib/audio-analysis.js` 和 `main.js` 会后路径，停止计算个人情绪和个人声学，保留互动和清晰度；调整对应行为测试。
6. [x] `node --test test/*.test.js`、JS/Python 语法检查、真实 worker 与本地音频推理；记录实测推理耗时，更新 README 安装/使用/边界说明。

验证记录（2026-10-30）：

- 实际 `.venv-emotion` 依赖安装和模型下载完成；ASR 环境未修改。
- `npm run check:emotion` 使用官方示例 WAV，按 2048 个采样分块进入真实 LiveEmotion → EmotionWorker；加载 17854 ms，首次推理 326 ms，后续 183/178 ms，完整收到 loading/analyzing/result/paused/stopped。
- 当前 Chrome 验证实际前端布局和示例结果；未采集麦克风或系统声音。
- 运行中的桌面应用未重启，新主进程 IPC 需用户保存会议后重启载入；真实会议准确率尚未评估。

- 最终合并工作区回归：123 项测试全部通过；JS/Python 语法检查与 git diff --check 通过。旧静态测试已兼容会议代次检查返回结构化失败对象。
