// 设置页逻辑

const PROVIDER_CONFIG = {
  openai: {
    needsKey: true,
    keyHint: '在 platform.openai.com 获取',
    models: [
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini（推荐）' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }
    ]
  },
  deepseek: {
    needsKey: true,
    keyHint: '在 platform.deepseek.com 获取',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat（推荐）' },
      { value: 'deepseek-coder', label: 'DeepSeek Coder' }
    ]
  },
  ollama: {
    needsKey: false,
    models: [
      { value: 'qwen2.5:7b', label: 'Qwen 2.5 7B（推荐）' },
      { value: 'llama3.1:8b', label: 'Llama 3.1 8B' },
      { value: 'mistral:7b', label: 'Mistral 7B' }
    ]
  },
  custom: {
    needsKey: true,
    keyHint: '自定义 API Key',
    models: []
  }
};

const ASR_MODEL_HINTS = {
  'paraformer-qwen3-final': '录制中使用 Paraformer 保持低延迟字幕；结束录音后用 Python qwen-asr 调用 Qwen3-ASR 重新生成更准确的最终逐字稿。',
  'sensevoice-int8': '下载 sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17-int8 到项目 models/ 目录。结束录音后生成最终逐字稿。',
  'paraformer-streaming': '使用项目 models/sherpa-onnx-streaming-paraformer-bilingual-zh-en，录音时实时出字幕。',
  'qwen3-asr-python': '使用 Python qwen-asr 包调用 Qwen3-ASR，结束录音后生成高质量最终逐字稿。留空模型路径时使用 Qwen/Qwen3-ASR-1.7B。',
  'sensevoice-custom': '只支持 sherpa-onnx 兼容导出的 SenseVoice 目录；普通 FunASR/Shandianshuo 导出可能无法直接加载。'
};

const ASR_ENGINE_BY_PRESET = {
  'paraformer-qwen3-final': 'hybrid',
  'paraformer-streaming': 'paraformer',
  'qwen3-asr-python': 'qwen3-asr-python',
  'sensevoice-int8': 'sensevoice',
  'sensevoice-custom': 'sensevoice'
};

class SettingsPage {
  constructor() {
    this.providerSelect = document.getElementById('provider');
    this.apikeyInput = document.getElementById('apikey');
    this.apikeyHint = document.getElementById('apikey-hint');
    this.modelSelect = document.getElementById('model');
    this.modelHint = document.getElementById('model-hint');
    this.ollamaUrlInput = document.getElementById('ollama-url');
    this.customBaseUrlInput = document.getElementById('custom-base-url');
    this.customModelInput = document.getElementById('custom-model');
    this.asrModelPresetSelect = document.getElementById('asr-model-preset');
    this.asrModelHint = document.getElementById('asr-model-hint');
    this.sensevoiceModelPathInput = document.getElementById('sensevoice-model-path');
    this.qwen3ModelPathInput = document.getElementById('qwen3-model-path');
    this.meetingOutputDirInput = document.getElementById('meeting-output-dir');
    this.autoStartRecordingInput = document.getElementById('auto-start-recording');
    this.launchAtLoginInput = document.getElementById('launch-at-login');
    this.autoDetectMeetingInput = document.getElementById('auto-detect-meeting');
    this.captureSystemAudioInput = document.getElementById('capture-system-audio');
    this.micDeviceSelect = document.getElementById('mic-device');
    this.systemAudioDeviceSelect = document.getElementById('system-audio-device');
    this.btnRefreshAudioDevices = document.getElementById('btn-refresh-audio-devices');
    this.autoStartAfterSecInput = document.getElementById('auto-start-after-sec');
    this.autoStopAfterSecInput = document.getElementById('auto-stop-after-sec');
    this.minReviewRecordingSecInput = document.getElementById('min-review-recording-sec');
    this.micActivityThresholdInput = document.getElementById('mic-activity-threshold');
    this.autoSaveArtifactsInput = document.getElementById('auto-save-artifacts');
    this.autoGenerateReportInput = document.getElementById('auto-generate-report');
    this.btnSave = document.getElementById('btn-save');
    this.saveSuccess = document.getElementById('save-success');

    this.groupApikey = document.getElementById('group-apikey');
    this.groupOllama = document.getElementById('group-ollama');
    this.groupCustom = document.getElementById('group-custom');
    this.groupCustomModel = document.getElementById('group-custom-model');
    this.groupSensevoicePath = document.getElementById('group-sensevoice-path');
    this.groupQwen3Path = document.getElementById('group-qwen3-path');

    this.bindEvents();
    this.loadSettings();
  }

  bindEvents() {
    this.providerSelect.addEventListener('change', () => this.onProviderChange());
    this.asrModelPresetSelect.addEventListener('change', () => this.onASRModelChange());
    this.btnRefreshAudioDevices.addEventListener('click', () => this.loadAudioDevices({ requestPermission: true }));
    this.btnSave.addEventListener('click', () => this.save());
  }

  async loadSettings() {
    this.settings = await window.api.getSettings();

    this.providerSelect.value = this.settings.provider || 'deepseek';
    this.loadMeetingFields();
    await this.loadAudioDevices({ requestPermission: false });

    // 先填充模型列表再加载字段值
    this.onProviderChange();
  }

  loadMeetingFields() {
    const asr = this.settings.asr || {};
    const meeting = this.settings.meeting || {};

    const modelPreset = asr.modelPreset || (asr.engine === 'hybrid' ? 'paraformer-qwen3-final' : asr.engine === 'qwen3-asr-python' ? 'qwen3-asr-python' : asr.engine === 'paraformer' ? 'paraformer-streaming' : asr.modelPath ? 'sensevoice-custom' : 'sensevoice-int8');

    this.asrModelPresetSelect.value = modelPreset;
    this.sensevoiceModelPathInput.value = asr.modelPath || '';
    this.qwen3ModelPathInput.value = asr.qwen3ModelPath || '';
    this.meetingOutputDirInput.value = meeting.outputDir || '';
    this.autoStartRecordingInput.checked = Boolean(meeting.autoStartRecording);
    this.launchAtLoginInput.checked = Boolean(meeting.launchAtLogin);
    this.autoDetectMeetingInput.checked = Boolean(meeting.autoDetectMeeting);
    this.captureSystemAudioInput.checked = meeting.captureSystemAudio !== false;
    this.savedMicDeviceId = meeting.micDeviceId || '';
    this.savedSystemAudioDeviceId = meeting.systemAudioDeviceId || '';
    this.autoStartAfterSecInput.value = meeting.autoStartAfterSec || 60;
    this.autoStopAfterSecInput.value = meeting.autoStopAfterSec || 180;
    this.minReviewRecordingSecInput.value = meeting.minReviewRecordingSec || 120;
    this.micActivityThresholdInput.value = meeting.micActivityThreshold || 0.02;
    this.autoSaveArtifactsInput.checked = meeting.autoSaveArtifacts !== false;
    this.autoGenerateReportInput.checked = meeting.autoGenerateReport !== false;
    this.onASRModelChange();
  }

  async loadAudioDevices({ requestPermission = false } = {}) {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    let permissionStream = null;
    if (requestPermission) {
      try {
        permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        // Keep going; enumerateDevices may still return device ids without labels.
      }
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === 'audioinput');
    this.populateAudioDeviceSelect(this.micDeviceSelect, audioInputs, this.savedMicDeviceId, '系统默认麦克风');
    this.populateAudioDeviceSelect(this.systemAudioDeviceSelect, audioInputs, this.savedSystemAudioDeviceId, '不使用虚拟输入');

    if (permissionStream) {
      permissionStream.getTracks().forEach(track => track.stop());
    }
  }

  populateAudioDeviceSelect(select, devices, selectedDeviceId, defaultLabel) {
    select.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = defaultLabel;
    select.appendChild(defaultOption);

    devices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `音频输入 ${index + 1}`;
      select.appendChild(option);
    });

    select.value = selectedDeviceId || '';
    if (selectedDeviceId && select.value !== selectedDeviceId) {
      const missingOption = document.createElement('option');
      missingOption.value = selectedDeviceId;
      missingOption.textContent = '已保存的设备（当前未检测到）';
      select.appendChild(missingOption);
      select.value = selectedDeviceId;
    }
  }

  /** 加载指定 provider 的配置到表单字段 */
  loadProviderFields(provider) {
    const providerConfig = this.settings?.providers?.[provider] || {};

    this.apikeyInput.value = providerConfig.apiKey || '';
    this.ollamaUrlInput.value = providerConfig.ollamaUrl || 'http://localhost:11434';
    this.customBaseUrlInput.value = providerConfig.baseUrl || '';
    this.customModelInput.value = providerConfig.customModel || '';

    // 设置模型下拉框（非 custom 模式）
    if (providerConfig.model && provider !== 'custom') {
      this.modelSelect.value = providerConfig.model;
    }
  }

  onProviderChange() {
    const provider = this.providerSelect.value;
    const config = PROVIDER_CONFIG[provider];

    // 显示/隐藏条件字段
    this.groupApikey.classList.toggle('visible', config.needsKey);
    this.groupOllama.classList.toggle('visible', provider === 'ollama');
    this.groupCustom.classList.toggle('visible', provider === 'custom');
    this.groupCustomModel.classList.toggle('visible', provider === 'custom');

    // 更新key提示
    if (config.keyHint) {
      this.apikeyHint.textContent = config.keyHint;
    }

    // 填充模型列表
    this.modelSelect.innerHTML = '';
    if (config.models.length > 0) {
      config.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.value;
        opt.textContent = m.label;
        this.modelSelect.appendChild(opt);
      });
      this.modelSelect.parentElement.style.display = '';
    } else {
      this.modelSelect.parentElement.style.display = 'none';
    }

    // 切换后加载该 provider 保存的配置到表单字段
    this.loadProviderFields(provider);
  }

  onASRModelChange() {
    const modelPreset = this.asrModelPresetSelect.value;
    this.groupSensevoicePath.style.display = modelPreset === 'sensevoice-custom' ? '' : 'none';
    this.groupQwen3Path.style.display = modelPreset === 'paraformer-qwen3-final' || modelPreset === 'qwen3-asr-python' ? '' : 'none';
    this.asrModelHint.textContent = ASR_MODEL_HINTS[modelPreset] || '';
  }

  async save() {
    const provider = this.providerSelect.value;

    // 隐藏上次的错误提示
    const errorEl = document.getElementById('connection-error');
    errorEl.classList.remove('show');
    errorEl.textContent = '';

    // 先获取完整 settings（包含所有 provider 的独立配置）
    const settings = await window.api.getSettings();

    // 只更新当前 provider 的配置
    settings.provider = provider;
    if (!settings.providers) {
      settings.providers = {};
    }

    if (provider === 'custom') {
      // custom 的模型名来自自定义输入框
      settings.providers[provider] = {
        apiKey: this.apikeyInput.value.trim(),
        model: this.customModelInput.value.trim(),
        ollamaUrl: this.ollamaUrlInput.value.trim(),
        baseUrl: this.customBaseUrlInput.value.trim(),
        customModel: this.customModelInput.value.trim()
      };
    } else {
      settings.providers[provider] = {
        apiKey: this.apikeyInput.value.trim(),
        model: this.modelSelect.value,
        ollamaUrl: this.ollamaUrlInput.value.trim(),
        baseUrl: this.customBaseUrlInput.value.trim(),
        customModel: ''
      };
    }

    settings.asr = {
      ...(settings.asr || {}),
      modelPreset: this.asrModelPresetSelect.value,
      engine: ASR_ENGINE_BY_PRESET[this.asrModelPresetSelect.value] || 'sensevoice',
      modelPath: this.asrModelPresetSelect.value === 'sensevoice-custom' ? this.sensevoiceModelPathInput.value.trim() : '',
      qwen3ModelPath: this.qwen3ModelPathInput.value.trim(),
      language: 'zh'
    };

    settings.meeting = {
      ...(settings.meeting || {}),
      autoStartRecording: this.autoStartRecordingInput.checked,
      launchAtLogin: this.launchAtLoginInput.checked,
      autoDetectMeeting: this.autoDetectMeetingInput.checked,
      captureSystemAudio: this.captureSystemAudioInput.checked,
      micDeviceId: this.micDeviceSelect.value,
      systemAudioDeviceId: this.systemAudioDeviceSelect.value,
      autoStartAfterSec: Number(this.autoStartAfterSecInput.value || 60),
      autoStopAfterSec: Number(this.autoStopAfterSecInput.value || 180),
      minReviewRecordingSec: Number(this.minReviewRecordingSecInput.value || 120),
      micActivityThreshold: Number(this.micActivityThresholdInput.value || 0.02),
      autoSaveArtifacts: this.autoSaveArtifactsInput.checked,
      autoGenerateReport: this.autoGenerateReportInput.checked,
      outputDir: this.meetingOutputDirInput.value.trim()
    };

    await window.api.saveSettings(settings);

    // 更新缓存，让下次切换 provider 时能看到最新值
    this.settings = settings;

    // 测试连通性
    this.btnSave.textContent = '⏳ 测试连接中...';
    this.btnSave.classList.add('loading');
    const result = await window.api.testLLMConnection(settings);

    if (result.success) {
      // 连接成功 → 显示保存成功并关闭
      this.btnSave.textContent = '保存设置';
      this.btnSave.classList.remove('loading');
      this.saveSuccess.classList.add('show');
      setTimeout(() => {
        window.close();
      }, 800);
    } else {
      // 连接失败 → 显示红色错误提示，不关闭
      this.btnSave.textContent = '保存设置';
      this.btnSave.classList.remove('loading');
      errorEl.textContent = `⚠️ 大模型测试连接失败，请核对后重试!`;
      errorEl.classList.add('show');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SettingsPage();
});
