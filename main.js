const { app, BrowserWindow, ipcMain, session, Menu, desktopCapturer, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { initASR, feedAudio, stopRecognition, transcribeAudioFile, cancelQwen3Transcription } = require('./lib/asr');
const { loadLexicon, analyzeText } = require('./lib/lexicon');
const { sendFeedback, sendReport, sendMeetingMinutes, sendMeetingTitle, sendTranscriptPolish, sendTranscriptPunctuate, testConnection } = require('./lib/ai-feedback');
const { createTranscriptArtifact, saveMinutesArtifact, saveReportArtifact, saveAudioArtifact } = require('./lib/meeting-session');
const { analyzeAudioFile, buildConversationAnalysis } = require('./lib/audio-analysis');
const { runOpenSmile } = require('./lib/opensmile');
const { MeetingActivityDetector } = require('./lib/meeting-activity-detector');
const { pathToFileURL } = require('url');
const { RecordingController } = require('./lib/recording-controller');
const { segmentTranscript } = require('./lib/sentence-segment');
const { log, startTask } = require('./lib/runtime-log');
const { LiveEmotion, EmotionWorker } = require('./lib/live-emotion');
const { AppExitGate } = require('./lib/app-exit-gate');
const { resolveArchive, listMeetingHistory, readMeetingHistory } = require('./lib/meeting-history');
const { DEFAULT_DEEPSEEK_MODEL, normalizeDeepSeekSettings } = require('./lib/deepseek-config');

app.commandLine.appendSwitch('enable-features', [
  'MacLoopbackAudioForScreenShare',
  'MacSckSystemAudioLoopbackOverride',
  'MacCatapSystemAudioLoopbackCapture',
  'PulseaudioLoopbackForScreenShare'
].join(','));

// 覆盖应用显示名称（菜单栏、Dock、任务栏、窗口标题）
app.setName('智能表达训练');

let mainWindow;
let settingsWindow;
let promptEditorWindow;
let exitGate;
let rendererUnavailable = false;
const recordingController = new RecordingController({ initASR, feedAudio, stopRecognition });
const emotionWorker = new EmotionWorker();
const liveEmotion = new LiveEmotion({
  infer: samples => emotionWorker.infer(samples),
  warmup: () => emotionWorker.start(),
  close: () => emotionWorker.close()
});
let displayMediaHandlerReady = false;
let nativeSystemAudioProcess = null;
const meetingActivityDetector = new MeetingActivityDetector();
let lastActivityLogAt = null;

async function attachOpenSmileFeatures(wavPath, segments, report) {
  try {
    report.openSmile = { enabled: true, ...(await runOpenSmile(wavPath, segments)) };
  } catch (error) {
    log('openSMILE', '声学特征提取不可用，继续使用基础音频分析', {}, 'WARN');
    report.openSmile = { enabled: false, error: error.message, speakers: [], segmentDetails: [] };
  }
  return report;
}

function normalizeAudioFile(inputPath) {
  return new Promise((resolve, reject) => {
    const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'expression-trainer-upload-'));
    const outputPath = path.join(tempDir, 'audio.wav');
    const child = spawn('ffmpeg', ['-y', '-i', inputPath, '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', outputPath], {
      stdio: ['ignore', 'ignore', 'pipe']
    });
    const task = startTask('音频', '转码为 16 kHz 单声道 WAV', { pid: child.pid });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { task.fail(error); reject(error); });
    child.on('exit', code => {
      if (code === 0 && fs.existsSync(outputPath)) {
        task.done();
        resolve({ outputPath, tempDir });
      } else {
        const error = new Error(stderr.trim() || `ffmpeg 转码失败，退出码 ${code}`);
        task.fail(error, { exitCode: code });
        reject(error);
      }
    });
  });
}

// Custom prompt 文件路径
function getCustomPromptPath() {
  return path.join(app.getPath('userData'), 'custom-prompt.json');
}

function loadCustomPrompt() {
  const p = getCustomPromptPath();
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch(e) { return null; }
  }
  return null;
}

function saveCustomPrompt(data) {
  fs.writeFileSync(getCustomPromptPath(), JSON.stringify(data, null, 2));
}

// 各 Provider 的默认配置
const DEFAULT_PROVIDER_CONFIGS = {
  openai: { apiKey: '', model: 'gpt-4o-mini' },
  deepseek: { apiKey: '', model: DEFAULT_DEEPSEEK_MODEL },
  ollama: { ollamaUrl: 'http://localhost:11434', model: 'qwen2.5:7b' },
  custom: { apiKey: '', baseUrl: '', model: '' }
};

const DEFAULT_ASR_CONFIG = {
  modelPreset: 'paraformer-qwen3-final',
  engine: 'hybrid',
  modelPath: '',
  qwen3ModelPath: '',
  speakerDiarization: true,
  language: 'zh',
  qwen3Language: 'auto',
  autoSegment: true
};

const DEFAULT_MEETING_CONFIG = {
  autoStartRecording: false,
  autoDetectMeeting: false,
  autoStartAfterSec: 60,
  autoStopAfterSec: 180,
  minReviewRecordingSec: 120,
  micActivityThreshold: 0.02,
  captureSystemAudio: true,
  micDeviceId: '',
  systemAudioDeviceId: '',
  launchAtLogin: false,
  autoGenerateReport: true,
  autoSaveArtifacts: true,
  outputDir: ''
};

// 设置文件路径
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  const settingsPath = getSettingsPath();
  if (fs.existsSync(settingsPath)) {
    const raw = normalizeDeepSeekSettings(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')));
    // 兼容旧版扁平结构 → 迁移到 per-provider 结构
    if (!raw.providers) {
      const migrated = {
        provider: raw.provider || 'deepseek',
        providers: {
          openai: { ...DEFAULT_PROVIDER_CONFIGS.openai },
          deepseek: { ...DEFAULT_PROVIDER_CONFIGS.deepseek },
          ollama: { ...DEFAULT_PROVIDER_CONFIGS.ollama },
          custom: { ...DEFAULT_PROVIDER_CONFIGS.custom }
        },
        asr: { ...DEFAULT_ASR_CONFIG, ...(raw.asr || {}) },
        meeting: { ...DEFAULT_MEETING_CONFIG, ...(raw.meeting || {}) }
      };
      // 将旧字段迁移到对应 provider
      const p = migrated.provider;
      if (raw.apiKey) migrated.providers[p].apiKey = raw.apiKey;
      if (raw.model) migrated.providers[p].model = raw.model;
      if (raw.ollamaUrl) migrated.providers.ollama.ollamaUrl = raw.ollamaUrl;
      if (raw.customEndpoint) migrated.providers.custom.baseUrl = raw.customEndpoint;
      if (raw.customModel) migrated.providers.custom.model = raw.customModel;
      saveSettings(migrated);
      return migrated;
    }
    // 确保每个 provider 都有完整的默认字段
    for (const key of Object.keys(DEFAULT_PROVIDER_CONFIGS)) {
      if (!raw.providers[key]) {
        raw.providers[key] = { ...DEFAULT_PROVIDER_CONFIGS[key] };
      } else {
        raw.providers[key] = { ...DEFAULT_PROVIDER_CONFIGS[key], ...raw.providers[key] };
      }
    }
    raw.asr = { ...DEFAULT_ASR_CONFIG, ...(raw.asr || {}) };
    raw.meeting = { ...DEFAULT_MEETING_CONFIG, ...(raw.meeting || {}) };
    return raw;
  }
  return {
    provider: 'deepseek',
    providers: JSON.parse(JSON.stringify(DEFAULT_PROVIDER_CONFIGS)),
    asr: { ...DEFAULT_ASR_CONFIG },
    meeting: { ...DEFAULT_MEETING_CONFIG }
  };
}

function saveSettings(settings) {
  const settingsPath = getSettingsPath();
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  applyLoginItemSettings(settings);
}

function applyLoginItemSettings(settings) {
  if (!app.isReady()) return;

  app.setLoginItemSettings({
    openAtLogin: Boolean(settings.meeting?.launchAtLogin),
    openAsHidden: Boolean(settings.meeting?.launchAtLogin)
  });
}

/** 获取当前选中 provider 的配置 */
function getCurrentProviderSettings(settings) {
  const config = settings.providers[settings.provider];
  return config || DEFAULT_PROVIDER_CONFIGS[settings.provider] || {};
}

function autoSegmentEnabled() {
  return loadSettings()?.asr?.autoSegment !== false;
}

function applyAutoSegmentText(text) {
  const value = String(text || '').trim();
  if (!value) return value;
  return autoSegmentEnabled() ? segmentTranscript(value) : value;
}

function getMeetingOutputDir(settings) {
  return settings.meeting?.outputDir || path.join(app.getPath('documents'), 'Expression Trainer Meetings');
}

function getNativeSystemAudioHelperPath() {
  return path.join(__dirname, 'native', 'system-audio-helper', '.build', 'debug', 'system-audio-probe');
}

function decodeFloat32Base64(base64) {
  const buffer = Buffer.from(base64, 'base64');
  const samples = new Array(Math.floor(buffer.length / 4));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buffer.readFloatLE(i * 4);
  }
  return samples;
}

function stopNativeSystemAudio() {
  if (!nativeSystemAudioProcess) return;
  log('系统音频', '停止采集系统输出');

  nativeSystemAudioProcess.kill('SIGTERM');
  nativeSystemAudioProcess = null;
}

function requestSafeExit(event) {
  if (!exitGate) return true;
  if (rendererUnavailable && exitGate.state !== 'approved') {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning', buttons: ['保留应用', '退出应用'], defaultId: 0, cancelId: 0,
      message: '界面当前无法响应保存请求',
      detail: '已保存的会议仍保留在磁盘中。当前界面中的未保存内容可能无法恢复。选择退出将关闭应用。'
    });
    if (choice === 1) { exitGate.approve(); setImmediate(() => app.quit()); }
    else { event.preventDefault(); return false; }
  }
  if (exitGate.request()) return true;
  event.preventDefault();
  return false;
}

function startNativeSystemAudio() {
  if (nativeSystemAudioProcess) {
    return { success: true, alreadyRunning: true };
  }

  const helperPath = getNativeSystemAudioHelperPath();
  if (!fs.existsSync(helperPath)) {
    log('系统音频', '系统音频 helper 尚未构建，将由界面尝试备用采集方式', {}, 'WARN');
    return {
      success: false,
      error: `系统音频 helper 尚未构建: ${helperPath}。请先运行 npm run build:system-audio-helper`
    };
  }

  let child;
  try {
    child = spawn(helperPath, ['--stream-json'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
  nativeSystemAudioProcess = child;
  log('系统音频', '正在启动系统输出采集', { pid: child.pid });

  let stdoutBuffer = '';

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      resolve(result);
    };

    const startupTimer = setTimeout(() => {
      log('系统音频', '等待 helper 确认启动已超过 3 秒', {}, 'WARN');
      settle({ success: true, helperPath, startupTimedOut: true });
    }, 3000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (nativeSystemAudioProcess !== child) return;
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed);
          if (event.event === 'samples' && event.samples && mainWindow) {
            mainWindow.webContents.send('native-system-audio-samples', {
              sampleRate: event.sampleRate || 16000,
              samples: decodeFloat32Base64(event.samples)
            });
          } else {
            if (event.event === 'started') {
              log('系统音频', '系统输出采集已启动');
              settle({ success: true, helperPath });
            } else if (event.event === 'permission_required') {
              log('系统音频', '需要屏幕与系统音频录制权限', {}, 'WARN');
              settle({
                success: false,
                error: event.message || 'Native 系统音频需要屏幕与系统音频录制权限'
              });
            }
            if (mainWindow) {
              mainWindow.webContents.send('native-system-audio-event', event);
            }
          }
        } catch (error) {
          log('系统音频', '无法解析 helper 输出', {}, 'ERROR');
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      log('系统音频', 'helper 输出诊断信息；若采集异常请检查系统权限', {}, 'WARN');
    });

    child.on('error', (error) => {
      log('系统音频', '采集进程启动失败', { errorCode: error.code }, 'ERROR');
      if (nativeSystemAudioProcess === child) {
        nativeSystemAudioProcess = null;
      }
      settle({ success: false, error: error.message });
    });

    child.on('exit', (code, signal) => {
      log('系统音频', '采集进程已退出', { exitCode: code, signal });
      const wasCurrent = nativeSystemAudioProcess === child;
      if (nativeSystemAudioProcess === child) {
        nativeSystemAudioProcess = null;
      }
      settle({ success: false, error: `Native 系统音频 helper 已退出: code=${code}, signal=${signal}` });
      if (wasCurrent && mainWindow) {
        mainWindow.webContents.send('native-system-audio-event', { event: 'exit', code, signal });
      }
    });
  });
}

function setupDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false
      });

      if (!sources.length) {
        callback({});
        return;
      }

      callback({
        video: sources[0],
        audio: 'loopback'
      });
    } catch (error) {
      console.error('[SystemAudio] 获取桌面音频源失败:', error);
      callback({});
    }
  }, { useSystemPicker: false });
  displayMediaHandlerReady = true;
}

function createMainWindow() {
  rendererUnavailable = false;
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#000000',
    title: '智能表达训练',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.webContents.on('did-finish-load', () => log('应用', '界面加载完成，等待操作'));
  mainWindow.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) rendererUnavailable = true;
    log('应用', '界面加载失败', { errorCode: code }, 'ERROR');
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    rendererUnavailable = true;
    log('应用', '界面进程已退出', { exitCode: details.exitCode }, 'ERROR');
  });
  mainWindow.on('unresponsive', () => { rendererUnavailable = true; });
  mainWindow.on('responsive', () => { rendererUnavailable = false; });
  mainWindow.setFullScreenable(true);
  exitGate = new AppExitGate(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app-exit-requested');
    }
  });
  mainWindow.on('close', requestSafeExit);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createPromptEditorWindow() {
  if (promptEditorWindow) {
    promptEditorWindow.focus();
    return;
  }

  promptEditorWindow = new BrowserWindow({
    width: 720,
    height: 700,
    resizable: true,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hiddenInset',
    parent: mainWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  promptEditorWindow.loadFile(path.join(__dirname, 'src', 'prompt-editor.html'));

  promptEditorWindow.on('closed', () => {
    promptEditorWindow = null;
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 720,
    resizable: false,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hiddenInset',
    parent: mainWindow,
    modal: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'src', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// App lifecycle
app.whenReady().then(() => {
  const settings = loadSettings();
  log('应用', '应用启动', {
    modelPreset: settings.asr?.modelPreset, provider: settings.provider,
    autoDetectMeeting: settings.meeting?.autoDetectMeeting,
    autoStartRecording: settings.meeting?.autoStartRecording,
    captureSystemAudio: settings.meeting?.captureSystemAudio
  });
  setupDisplayMediaHandler();

  // macOS 需要显式创建应用菜单，否则菜单栏显示默认的 "Electron"
  // Windows/Linux 上此菜单同样适用，macOS 专属角色（hide/hideOthers）会自动生效
  const appMenuTemplate = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate));

  // 加载词库
  loadLexicon();

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (liveEmotion.sessionId) liveEmotion.stop(liveEmotion.sessionId);
  stopNativeSystemAudio();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (!requestSafeExit(event)) return;
  emotionWorker.close();
  log('应用', '应用正在退出');
  stopNativeSystemAudio();
});

// IPC Handlers
ipcMain.on('app-exit-ready', event => {
  if (event.sender !== mainWindow?.webContents) return;
  rendererUnavailable = false;
  exitGate?.rendererReady();
});
// Only fixed UI states may enter the terminal; never forward arbitrary renderer text.
const runtimeStates = new Set([
  '麦克风输入已开启', '麦克风输入已关闭', '麦克风输入开启失败',
  '系统输出已开启', '系统输出已关闭', '系统输出开启失败',
  '麦克风输入已选择', '系统输出已选择',
  '待开始', '已有原文', '监听会议', '录制中', '自动录制中', '已暂停', '最终稿生成中', '待确认',
  '最终稿为空，已保留实时稿', '本地音频分析中', '本地转写与说话人分离中', '音频分析完成',
  '音频分析已取消', '音频分析失败', '结束录音失败', '生成报告中', '报告已生成', '报告生成失败',
  '生成纪要中', '纪要已生成', '纪要生成失败', '已修正，待审阅', '错字修正失败', '补标点/断句失败'
]);
ipcMain.on('runtime-state', (_event, { sessionId, state } = {}) => {
  if (!runtimeStates.has(state) || typeof sessionId !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(sessionId)) return;
  log('界面', state, { sessionId });
});

ipcMain.handle('cancel-app-exit', () => {
  exitGate?.cancel();
  return { success: true };
});

ipcMain.handle('approve-app-exit', () => {
  exitGate?.approve();
  app.quit();
  return { success: true };
});

ipcMain.handle('force-app-exit', () => {
  exitGate?.approve();
  app.quit();
  return { success: true };
});

// 设置相关
ipcMain.handle('get-settings', () => {
  return loadSettings();
});

ipcMain.handle('save-settings', (event, settings) => {
  saveSettings(settings);
  log('设置', '设置已保存');
  return { success: true };
});

ipcMain.handle('open-settings', () => {
  createSettingsWindow();
});

// Prompt编辑器相关
ipcMain.handle('open-prompt-editor', () => {
  createPromptEditorWindow();
});

ipcMain.handle('get-custom-prompt', () => {
  return loadCustomPrompt();
});

ipcMain.handle('save-custom-prompt', (event, data) => {
  saveCustomPrompt(data);
  return { success: true };
});

ipcMain.handle('close-current-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

// 语音识别相关 - Web Audio方案
ipcMain.handle('init-asr', async (event, sessionId) => {
  try {
    const settings = loadSettings();
    const runtime = await recordingController.start(sessionId, settings.asr || DEFAULT_ASR_CONFIG);
    liveEmotion.start(sessionId, payload => {
      if (!event.sender.isDestroyed()) event.sender.send('live-emotion', payload);
    });
    return { success: true, ...runtime };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

function normalizeAudioSamples(payload) {
  if (payload instanceof ArrayBuffer) {
    return new Float32Array(payload);
  }
  if (ArrayBuffer.isView(payload)) {
    return new Float32Array(payload.buffer, payload.byteOffset, Math.floor(payload.byteLength / 4));
  }
  return new Float32Array(payload);
}

// 接收渲染进程发来的音频数据
ipcMain.handle('feed-audio', (event, samplesPayload, sessionId) => {
  const samples = normalizeAudioSamples(samplesPayload);
  const result = recordingController.feed(sessionId, samples);
  if (recordingController.activeId === sessionId) liveEmotion.feed(sessionId, samples);
  return result; // { text, isFinal } or null
});

ipcMain.handle('stop-asr', async (event, sessionId) => {
  const sender = event.sender;
  liveEmotion.stop(sessionId);
  const result = await recordingController.stop(sessionId, (payload) => {
    if (payload?.finalText) payload.finalText = applyAutoSegmentText(payload.finalText);
    if (!sender.isDestroyed()) {
      sender.send('asr-final-result', payload);
    }
  });
  if (typeof result === 'string') {
    return { success: true, finalText: applyAutoSegmentText(result) };
  }
  if (result?.finalText) result.finalText = applyAutoSegmentText(result.finalText);
  return { success: true, ...result };
});

ipcMain.handle('pause-live-emotion', (event, sessionId, paused) => {
  if (recordingController.activeId === sessionId) liveEmotion.pause(sessionId, paused);
  return { success: true };
});

ipcMain.handle('update-meeting-activity', (event, { hasInput, hasOutput, nowMs }) => {
  const settings = loadSettings();
  const meeting = settings.meeting || DEFAULT_MEETING_CONFIG;
  meetingActivityDetector.startAfterMs = Number(meeting.autoStartAfterSec || 60) * 1000;
  meetingActivityDetector.reviewAfterMs = Number(meeting.autoStopAfterSec || 180) * 1000;
  meetingActivityDetector.minReviewRecordingMs = Number(meeting.minReviewRecordingSec || 120) * 1000;

  const action = meetingActivityDetector.update({
    nowMs: nowMs || Date.now(),
    hasInput: Boolean(hasInput),
    hasOutput: Boolean(hasOutput)
  });

  if (action || lastActivityLogAt === null || Date.now() - lastActivityLogAt >= 30000) {
    lastActivityLogAt = Date.now();
    const messages = { start: '检测到持续声音，准备自动录音', review: '持续静音，等待用户确认保存', discard: '短时声音已忽略' };
    log('会议监听', messages[action] || (meetingActivityDetector.isRecording ? '录制中，检查声音活动' : '监听中，等待持续声音'), {
      hasInput: Boolean(hasInput), hasOutput: Boolean(hasOutput), isRecording: meetingActivityDetector.isRecording,
      action, startAfterSec: meetingActivityDetector.startAfterMs / 1000, reviewAfterSec: meetingActivityDetector.reviewAfterMs / 1000
    });
  }

  return { action, isRecording: meetingActivityDetector.isRecording };
});

ipcMain.handle('mark-meeting-recording-started', () => {
  meetingActivityDetector.markRecordingStarted();
  return { success: true };
});

ipcMain.handle('mark-meeting-recording-stopped', () => {
  meetingActivityDetector.markRecordingStopped();
  return { success: true };
});

ipcMain.handle('get-system-audio-status', () => {
  return {
    displayMediaHandlerReady,
    nativeHelperBuilt: fs.existsSync(getNativeSystemAudioHelperPath()),
    nativeHelperRunning: Boolean(nativeSystemAudioProcess),
    platform: process.platform
  };
});

ipcMain.handle('start-native-system-audio', () => {
  return startNativeSystemAudio();
});

ipcMain.handle('stop-native-system-audio', () => {
  stopNativeSystemAudio();
  return { success: true };
});

// LLM 连通性测试
ipcMain.handle('test-llm-connection', async (event, settings) => {
  const providerConfig = getCurrentProviderSettings(settings);
  return await testConnection({ ...settings, ...providerConfig });
});

// 词库分析
ipcMain.handle('analyze-text', (event, text) => {
  return analyzeText(text);
});

// 文件保存
ipcMain.handle('save-file', async (event, content, filename, options = {}) => {
  const { dialog } = require('electron');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: options.title || '保存报告',
    defaultPath: path.join(app.getPath('desktop'), filename),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });

  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { success: true, path: result.filePath };
  }
  return { success: false };
});

ipcMain.handle('select-audio-file', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择会议音频',
    properties: ['openFile'],
    filters: [{ name: '音频文件', extensions: ['m4a', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'webm'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };
  const filePath = result.filePaths[0];
  return { success: true, filePath, fileUrl: pathToFileURL(filePath).href, name: path.basename(filePath) };
});

ipcMain.handle('analyze-audio-file', async (event, { filePath }) => {
  let normalized;
  try {
    normalized = await normalizeAudioFile(filePath);
    const baseAnalysis = await attachOpenSmileFeatures(normalized.outputPath, [], analyzeAudioFile(normalized.outputPath));
    const audioAnalysis = buildConversationAnalysis(baseAnalysis, null);
    return {
      success: true,
      audioAnalysis,
      transcription: null
    };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    if (normalized?.tempDir) fs.rmSync(normalized.tempDir, { recursive: true, force: true });
  }
});

ipcMain.handle('transcribe-audio-file', async (event, { filePath, sessionId, jobId }) => {
  let normalized;
  try {
    normalized = await normalizeAudioFile(filePath);
    const settings = loadSettings();
    const model = settings.asr?.qwen3ModelPath || settings.asr?.finalModelPath || undefined;
    const transcription = await transcribeAudioFile(normalized.outputPath, model, {
      speakerDiarization: settings.asr?.speakerDiarization !== false,
      language: settings.asr?.qwen3Language || 'auto',
      jobId: `${sessionId}:${jobId}`,
      onProgress: progress => event.sender.send('audio-analysis-progress', { ...progress, sessionId, jobId })
    });
    event.sender.send('audio-analysis-progress', { sessionId, jobId, stage: 'opensmile', processedSeconds: 0, totalSeconds: 0, detail: 'openSMILE 声学特征提取中' });
    const baseAnalysis = await attachOpenSmileFeatures(normalized.outputPath, [], analyzeAudioFile(normalized.outputPath));
    const audioAnalysis = buildConversationAnalysis(baseAnalysis, transcription);
    return { success: true, audioAnalysis, transcription };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    if (normalized?.tempDir) fs.rmSync(normalized.tempDir, { recursive: true, force: true });
  }
});

ipcMain.handle('cancel-audio-analysis', (event, { sessionId, jobId } = {}) => ({ success: Boolean(sessionId && jobId) && cancelQwen3Transcription(`${sessionId}:${jobId}`) }));

ipcMain.handle('save-meeting-transcript', async (event, payload) => {
  const { transcript, stats, audioPath, speakerSegments, sessionId, title, titleSource, startedAt, endedAt, transcriptRevision, transcriptSource } = payload;
  const settings = loadSettings();
  const rootDir = getMeetingOutputDir(settings);
  const task = startTask('保存', '保存会议原文与录音', { sessionId });

  try {
    const transcriptResult = createTranscriptArtifact({
      sessionId, title, titleSource, startedAt, endedAt, transcriptRevision, transcriptSource,
      speakerSegments: speakerSegments || [],
      sessionDir: payload.archiveId ? resolveArchive(rootDir, payload.archiveId) : undefined,
      rootDir,
      transcript,
      stats,
      now: new Date()
    });
    if (!audioPath) {
      task.done({ path: transcriptResult.sessionDir });
      return { success: true, ...transcriptResult };
    }

    const audioBaseAnalysis = analyzeAudioFile(audioPath);
    const audioAnalysis = buildConversationAnalysis(audioBaseAnalysis, {
      text: transcript,
      speaker_segments: speakerSegments || []
    });
    const audioResult = saveAudioArtifact({
      sessionDir: transcriptResult.sessionDir,
      audioPath,
      audioAnalysis
    });
    task.done({ path: transcriptResult.sessionDir });
    return {
      success: true,
      ...transcriptResult,
      ...audioResult,
      audioUrl: pathToFileURL(audioResult.audioPath).href
    };
  } catch (error) {
    task.fail(error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-meeting-history', (_event, options = {}) => {
  try {
    const rootDir = getMeetingOutputDir(loadSettings());
    return { success: true, meetings: listMeetingHistory(rootDir, options), rootDir };
  } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('read-meeting-history', (_event, archiveId) => {
  try {
    const meeting = readMeetingHistory(getMeetingOutputDir(loadSettings()), archiveId);
    return { success: true, meeting: { ...meeting, audioUrl: meeting.audioPath ? pathToFileURL(meeting.audioPath).href : '' } };
  } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('save-meeting-report', async (event, { sessionDir, transcript, report, stats, createdAt, sessionId, title, startedAt, endedAt, transcriptRevision, transcriptSource }) => {
  const task = startTask('保存', '保存表达报告', { sessionId });
  try {
    const result = saveReportArtifact({
      sessionId, title, startedAt, endedAt, transcriptRevision, transcriptSource,
      sessionDir,
      transcript,
      report,
      stats,
      createdAt,
      now: new Date()
    });
    task.done({ path: result.reportPath });
    return { success: true, ...result };
  } catch (error) {
    task.fail(error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-meeting-minutes', async (event, { sessionDir, transcript, minutes, stats, sessionId, title, startedAt, endedAt, transcriptRevision, transcriptSource }) => {
  const task = startTask('保存', '保存会议纪要', { sessionId });
  try {
    const result = saveMinutesArtifact({
      sessionId, title, startedAt, endedAt, transcriptRevision, transcriptSource,
      sessionDir,
      transcript,
      minutes,
      stats,
      now: new Date()
    });
    task.done({ path: result.minutesPath });
    return { success: true, ...result };
  } catch (error) {
    task.fail(error);
    return { success: false, error: error.message };
  }
});

// AI反馈（传入customPrompt）
ipcMain.handle('get-realtime-feedback', async (event, text) => {
  const settings = loadSettings();
  const providerConfig = getCurrentProviderSettings(settings);
  const customPrompt = loadCustomPrompt();
  try {
    const feedback = await sendFeedback(text, { ...settings, ...providerConfig }, customPrompt);
    return { success: true, feedback };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-final-report', async (event, { fullText, stats }) => {
  const settings = loadSettings();
  const providerConfig = getCurrentProviderSettings(settings);
  const customPrompt = loadCustomPrompt();
  try {
    const report = await sendReport(fullText, stats, { ...settings, ...providerConfig }, customPrompt);
    return { success: true, report };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-meeting-title', async (_event, { fullText }) => {
  try {
    const settings = loadSettings();
    const title = await sendMeetingTitle(fullText, { ...settings, ...getCurrentProviderSettings(settings) });
    return { success: true, title };
  } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('get-meeting-minutes', async (event, { fullText, stats }) => {
  const settings = loadSettings();
  const providerConfig = getCurrentProviderSettings(settings);
  const customPrompt = loadCustomPrompt();
  try {
    const minutes = await sendMeetingMinutes(fullText, stats, { ...settings, ...providerConfig }, customPrompt);
    return { success: true, minutes };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

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

ipcMain.handle('segment-text', (event, { text }) => ({ success: true, text: applyAutoSegmentText(text) }));
