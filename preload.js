const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 设置
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  openSettings: () => ipcRenderer.invoke('open-settings'),

  // Prompt编辑器
  openPromptEditor: () => ipcRenderer.invoke('open-prompt-editor'),
  getCustomPrompt: () => ipcRenderer.invoke('get-custom-prompt'),
  saveCustomPrompt: (data) => ipcRenderer.invoke('save-custom-prompt', data),
  closeWindow: () => ipcRenderer.invoke('close-current-window'),

  // 语音识别 - 使用 Web Audio 方案
  initASR: () => ipcRenderer.invoke('init-asr'),
  feedAudio: (samples) => {
    const copy = new Float32Array(samples.length);
    copy.set(samples);
    return ipcRenderer.invoke('feed-audio', copy.buffer);
  },
  stopASR: () => ipcRenderer.invoke('stop-asr'),
  updateMeetingActivity: (payload) => ipcRenderer.invoke('update-meeting-activity', payload),
  markMeetingRecordingStarted: () => ipcRenderer.invoke('mark-meeting-recording-started'),
  markMeetingRecordingStopped: () => ipcRenderer.invoke('mark-meeting-recording-stopped'),
  getSystemAudioStatus: () => ipcRenderer.invoke('get-system-audio-status'),
  startNativeSystemAudio: () => ipcRenderer.invoke('start-native-system-audio'),
  stopNativeSystemAudio: () => ipcRenderer.invoke('stop-native-system-audio'),
  onNativeSystemAudioSamples: (callback) => {
    ipcRenderer.on('native-system-audio-samples', (event, data) => callback(data));
  },
  onNativeSystemAudioEvent: (callback) => {
    ipcRenderer.on('native-system-audio-event', (event, data) => callback(data));
  },
  removeNativeSystemAudioListeners: () => {
    ipcRenderer.removeAllListeners('native-system-audio-samples');
    ipcRenderer.removeAllListeners('native-system-audio-event');
  },
  onASRResult: (callback) => {
    ipcRenderer.on('asr-result', (event, data) => callback(data));
  },
  onASRFinalResult: (callback) => {
    ipcRenderer.on('asr-final-result', (event, data) => callback(data));
  },
  removeASRListener: () => {
    ipcRenderer.removeAllListeners('asr-result');
    ipcRenderer.removeAllListeners('asr-final-result');
  },

  // 词库分析
  analyzeText: (text) => ipcRenderer.invoke('analyze-text', text),

  // AI反馈
  getRealtimeFeedback: (text) => ipcRenderer.invoke('get-realtime-feedback', text),
  getFinalReport: (data) => ipcRenderer.invoke('get-final-report', data),
  getMeetingMinutes: (data) => ipcRenderer.invoke('get-meeting-minutes', data),
  testLLMConnection: (settings) => ipcRenderer.invoke('test-llm-connection', settings),

  // 文件保存
  saveFile: (content, filename) => ipcRenderer.invoke('save-file', content, filename),
  saveMeetingTranscript: (payload) => ipcRenderer.invoke('save-meeting-transcript', payload),
  saveMeetingReport: (payload) => ipcRenderer.invoke('save-meeting-report', payload),
  saveMeetingMinutes: (payload) => ipcRenderer.invoke('save-meeting-minutes', payload),
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  analyzeAudioFile: (payload) => ipcRenderer.invoke('analyze-audio-file', payload),
  transcribeAudioFile: (payload) => ipcRenderer.invoke('transcribe-audio-file', payload),
  cancelAudioAnalysis: () => ipcRenderer.invoke('cancel-audio-analysis'),
  onAudioAnalysisProgress: (callback) => {
    ipcRenderer.on('audio-analysis-progress', (event, data) => callback(data));
  },
  removeAudioAnalysisProgressListener: () => ipcRenderer.removeAllListeners('audio-analysis-progress'),
});
