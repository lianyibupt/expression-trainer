// 宇宙无敌表达训练系统 V2

class ExpressionTrainer {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.startTime = null;
    this.pausedTime = 0;
    this.pauseStart = null;
    this.timerInterval = null;
    this.fullText = '';
    this.sentences = [];
    this.stats = { fillers: 0, hedges: 0, vagueWords: 0, totalWords: 0, duration: 0 };
    this.lastFeedbackText = '';
    this.lastReport = '';
    this.settings = null;
    this.meetingSession = null;
    this.isStoppingRecording = false;
    this.activityMonitor = null;
    this.lastActivityUpdateAt = 0;
    this.micActivityThreshold = 0.02;
    this.systemAudioStream = null;
    this.systemAudioAnalyser = null;
    this.nativeSystemAudioQueue = [];
    this.nativeSystemAudioQueuedSamples = 0;
    this.lastNativeSystemAudioAt = 0;
    this.nativeSystemAudioRunning = false;

    this.initElements();
    this.bindEvents();
    this.bindNativeSystemAudioEvents();
    this.loadSettingsAndMaybeAutoStart();
  }

  initElements() {
    this.btnStart = document.getElementById('btn-start');
    this.btnPaste = document.getElementById('btn-paste');
    this.btnPause = document.getElementById('btn-pause');
    this.btnResume = document.getElementById('btn-resume');
    this.btnStop = document.getElementById('btn-stop');
    this.btnReport = document.getElementById('btn-report');
    this.btnSettings = document.getElementById('btn-settings');
    this.btnCloseReport = document.getElementById('btn-close-report');
    this.reviewModal = document.getElementById('review-modal');
    this.reviewSummary = document.getElementById('review-summary');
    this.btnReviewClose = document.getElementById('btn-review-close');
    this.btnReviewDiscard = document.getElementById('btn-review-discard');
    this.btnReviewSave = document.getElementById('btn-review-save');
    this.btnReviewReport = document.getElementById('btn-review-report');
    this.btnClosePaste = document.getElementById('btn-close-paste');
    this.btnAnalyzePaste = document.getElementById('btn-analyze-paste');
    this.btnCopyText = document.getElementById('btn-copy-text');
    this.btnSaveText = document.getElementById('btn-save-text');
    this.btnClear = document.getElementById('btn-clear');
    this.btnCopyReport = document.getElementById('btn-copy-report');
    this.pasteModal = document.getElementById('paste-modal');
    this.pasteTextarea = document.getElementById('paste-textarea');
    this.timer = document.getElementById('timer');
    this.subtitleScroll = document.getElementById('subtitle-scroll');
    this.subtitleContainer = document.getElementById('subtitle-container');
    this.feedbackContent = document.getElementById('feedback-content');
    this.reportModal = document.getElementById('report-modal');
    this.reportBody = document.getElementById('report-body');
    this.statFillers = document.getElementById('stat-fillers');
    this.statHedges = document.getElementById('stat-hedges');
    this.statVague = document.getElementById('stat-vague');
    this.statDensity = document.getElementById('stat-density');
  }

  bindEvents() {
    this.btnStart.addEventListener('click', () => this.startRecording());
    this.btnPaste.addEventListener('click', () => this.openPasteModal());
    this.btnPause.addEventListener('click', () => this.pauseRecording());
    this.btnResume.addEventListener('click', () => this.resumeRecording());
    this.btnStop.addEventListener('click', () => this.stopRecording());
    this.btnReport.addEventListener('click', () => this.generateReport());
    this.btnSettings.addEventListener('click', () => window.api.openSettings());
    document.getElementById('btn-prompt-editor').addEventListener('click', () => window.api.openPromptEditor());
    this.btnCloseReport.addEventListener('click', () => this.reportModal.classList.add('hidden'));
    this.btnReviewClose.addEventListener('click', () => this.reviewModal.classList.add('hidden'));
    this.btnReviewDiscard.addEventListener('click', () => this.discardCurrentRecording());
    this.btnReviewSave.addEventListener('click', () => this.confirmSaveTranscript());
    this.btnReviewReport.addEventListener('click', () => this.confirmSaveAndReport());
    this.btnCopyReport.addEventListener('click', () => {
      const reportText = this.reportBody.innerText;
      navigator.clipboard.writeText(reportText).then(() => {
        this.btnCopyReport.textContent = '✅ 已复制';
        setTimeout(() => { this.btnCopyReport.textContent = '📋 复制全文'; }, 2000);
      });
    });
    this.btnClosePaste.addEventListener('click', () => this.pasteModal.classList.add('hidden'));
    this.btnAnalyzePaste.addEventListener('click', () => this.analyzePastedText());
    this.btnCopyText.addEventListener('click', () => this.copyOriginalText());
    this.btnSaveText.addEventListener('click', () => this.saveOriginalText());
    this.btnClear.addEventListener('click', () => this.clearAll());
  }

  bindNativeSystemAudioEvents() {
    window.api.onNativeSystemAudioSamples((data) => {
      const samples = new Float32Array(data.samples || []);
      if (!samples.length) return;

      this.enqueueNativeSystemAudio(samples);
      if (this.calculateRMS(samples) >= this.micActivityThreshold) {
        this.lastNativeSystemAudioAt = Date.now();
        this.updateMeetingActivityState({ hasInput: true, hasOutput: true });
      }
    });

    window.api.onNativeSystemAudioEvent((event) => {
      if (!event?.event) return;

      if (event.event === 'started') {
        this.nativeSystemAudioRunning = true;
        this.addFeedbackItem('Native 系统音频已启动', 'good');
      } else if (event.event === 'permission_required') {
        this.nativeSystemAudioRunning = false;
        this.addFeedbackItem('Native 系统音频需要屏幕与系统音频录制权限', 'filler');
      } else if (event.event === 'exit') {
        this.nativeSystemAudioRunning = false;
      }
    });
  }

  async loadSettingsAndMaybeAutoStart() {
    this.settings = await window.api.getSettings();
    this.micActivityThreshold = Number(this.settings?.meeting?.micActivityThreshold || 0.02);
    if (this.settings?.meeting?.autoStartRecording) {
      setTimeout(() => {
        if (!this.isRecording && !this.fullText.trim()) this.startRecording();
      }, 600);
    } else if (this.settings?.meeting?.autoDetectMeeting) {
      setTimeout(() => this.startActivityMonitor(), 600);
    }
  }

  async getSettings() {
    this.settings = await window.api.getSettings();
    return this.settings;
  }

  // ===== 录制控制 =====

  calculateRMS(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  analyserIsActive(analyser) {
    if (!analyser) return false;

    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    return this.calculateRMS(samples) >= this.micActivityThreshold;
  }

  async updateMeetingActivityState({ hasInput, hasOutput }) {
    const now = Date.now();
    if (now - this.lastActivityUpdateAt < 1000) return;
    this.lastActivityUpdateAt = now;

    const result = await window.api.updateMeetingActivity({
      hasInput,
      hasOutput,
      nowMs: now
    });

    if (result?.action === 'start' && !this.isRecording) {
      this.isAutoRecording = true;
      this.addFeedbackItem('检测到会议，自动开始录音', 'good');
      await this.stopActivityMonitor();
      await this.startRecording({ autoStarted: true });
    }

    if (result?.action === 'review' && this.isRecording && !this.isStoppingRecording) {
      this.addFeedbackItem('检测到长时间无输入，请确认是否保存', 'ai');
      await this.stopRecording({ autoStopped: true, needsReview: true });
    }

    if (result?.action === 'discard' && this.isRecording && !this.isStoppingRecording) {
      this.addFeedbackItem('短时声音已忽略', 'filler');
      await this.stopRecording({ autoStopped: true, discard: true });
    }
  }

  async updateMeetingActivityFromSamples(samples, { hasOutput = false } = {}) {
    const rms = this.calculateRMS(samples);
    const nativeOutputActive = Date.now() - this.lastNativeSystemAudioAt < 1500;
    await this.updateMeetingActivityState({
      hasInput: rms >= this.micActivityThreshold || hasOutput || nativeOutputActive,
      hasOutput: hasOutput || nativeOutputActive
    });
  }

  enqueueNativeSystemAudio(samples) {
    this.nativeSystemAudioQueue.push(samples);
    this.nativeSystemAudioQueuedSamples += samples.length;

    const maxQueuedSamples = 16000 * 30;
    while (this.nativeSystemAudioQueuedSamples > maxQueuedSamples && this.nativeSystemAudioQueue.length > 0) {
      const dropped = this.nativeSystemAudioQueue.shift();
      this.nativeSystemAudioQueuedSamples -= dropped.length;
    }
  }

  consumeNativeSystemAudioSamples(length) {
    const output = new Float32Array(length);
    let offset = 0;

    while (offset < length && this.nativeSystemAudioQueue.length > 0) {
      const chunk = this.nativeSystemAudioQueue[0];
      const take = Math.min(length - offset, chunk.length);
      output.set(chunk.subarray(0, take), offset);
      offset += take;

      if (take === chunk.length) {
        this.nativeSystemAudioQueue.shift();
      } else {
        this.nativeSystemAudioQueue[0] = chunk.subarray(take);
      }
      this.nativeSystemAudioQueuedSamples -= take;
    }

    return output;
  }

  mixNativeSystemAudio(samples) {
    if (!this.nativeSystemAudioQueuedSamples) return samples;

    const systemSamples = this.consumeNativeSystemAudioSamples(samples.length);
    const mixed = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const value = (samples[i] * 0.75) + (systemSamples[i] * 0.75);
      mixed[i] = Math.max(-1, Math.min(1, value));
    }
    return mixed;
  }

  buildAudioConstraints(deviceId) {
    const audio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    };

    if (deviceId) {
      audio.deviceId = { exact: deviceId };
    }

    return { audio };
  }

  async requestMicStream() {
    const settings = await this.getSettings();
    return navigator.mediaDevices.getUserMedia(this.buildAudioConstraints(settings?.meeting?.micDeviceId));
  }

  async requestVirtualSystemAudioInput(contextLabel, settings) {
    const deviceId = settings?.meeting?.systemAudioDeviceId;
    if (!deviceId) return null;

    if (deviceId === settings?.meeting?.micDeviceId) {
      this.addFeedbackItem(`${contextLabel}系统音频设备与麦克风相同，已跳过重复采集`, 'filler');
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(this.buildAudioConstraints(deviceId));
      this.addFeedbackItem(`${contextLabel}已接入系统音频输入设备`, 'good');
      return stream;
    } catch (error) {
      this.addFeedbackItem(`${contextLabel}系统音频输入设备不可用：${error.message}`, 'filler');
      return null;
    }
  }

  async requestSystemAudioStream(contextLabel) {
    const settings = await this.getSettings();
    if (!settings?.meeting?.captureSystemAudio) return null;

    const nativeResult = await window.api.startNativeSystemAudio();
    if (nativeResult?.success) {
      this.nativeSystemAudioRunning = true;
      this.addFeedbackItem(`${contextLabel}已接入 Native 系统音频`, 'good');
      return null;
    }

    if (nativeResult?.error) {
      this.addFeedbackItem(`${contextLabel}Native 系统音频不可用：${nativeResult.error}`, 'filler');
    }

    const virtualInputStream = await this.requestVirtualSystemAudioInput(contextLabel, settings);
    if (virtualInputStream) return virtualInputStream;

    if (!navigator.mediaDevices.getDisplayMedia) {
      this.addFeedbackItem('当前环境不支持系统音频捕获', 'filler');
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 1,
          width: { max: 16 },
          height: { max: 16 }
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach(track => track.stop());
        const status = await window.api.getSystemAudioStatus();
        const authHint = status?.platform === 'darwin'
          ? '请到系统设置 > 隐私与安全性 > 屏幕录制，允许本应用后重启应用'
          : '请确认系统允许本应用捕获屏幕/系统音频';
        this.addFeedbackItem(`${contextLabel}未获得系统音频轨道：${authHint}`, 'filler');
        return null;
      }

      stream.getVideoTracks().forEach(track => track.stop());

      this.addFeedbackItem(`${contextLabel}已接入系统输出声音`, 'good');
      return stream;
    } catch (err) {
      const status = await window.api.getSystemAudioStatus();
      const authHint = status?.platform === 'darwin'
        ? '请检查屏幕录制权限并重启应用'
        : '请检查系统音频捕获权限';
      this.addFeedbackItem(`${contextLabel}系统音频捕获失败：${err.message}。${authHint}`, 'filler');
      return null;
    }
  }

  async startActivityMonitor() {
    if (this.activityMonitor || this.isRecording) return;

    try {
      const settings = await this.getSettings();
      const stream = await this.requestMicStream();
      const systemStream = settings?.meeting?.captureSystemAudio ? await this.requestSystemAudioStream('监听') : null;
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      let systemAnalyser = null;
      if (systemStream) {
        const systemAudioOnlyStream = new MediaStream(systemStream.getAudioTracks());
        const systemSource = audioContext.createMediaStreamSource(systemAudioOnlyStream);
        systemAnalyser = audioContext.createAnalyser();
        systemAnalyser.fftSize = 2048;
        systemSource.connect(systemAnalyser);
      }

      const samples = new Float32Array(analyser.fftSize);
      const interval = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const micActive = this.calculateRMS(samples) >= this.micActivityThreshold;
        const systemActive = this.analyserIsActive(systemAnalyser);
        this.updateMeetingActivityState({ hasInput: micActive || systemActive, hasOutput: systemActive });
      }, 1000);

      this.activityMonitor = { stream, systemStream, audioContext, source, analyser, systemAnalyser, interval };
      this.addFeedbackItem('正在后台监听会议开始', 'ai');
    } catch (err) {
      this.showError(`自动会议监听启动失败: ${err.message}`);
    }
  }

  async stopActivityMonitor() {
    if (!this.activityMonitor) return;

    clearInterval(this.activityMonitor.interval);
    this.activityMonitor.stream.getTracks().forEach(track => track.stop());
    if (this.activityMonitor.systemStream) {
      this.activityMonitor.systemStream.getTracks().forEach(track => track.stop());
    }
    await this.activityMonitor.audioContext.close();
    this.activityMonitor = null;
    await window.api.stopNativeSystemAudio();
    this.nativeSystemAudioRunning = false;
  }

  async startRecording(options = {}) {
    await this.stopActivityMonitor();

    const initResult = await window.api.initASR();
    if (!initResult.success) {
      this.showError(`语音识别启动失败: ${initResult.error}`);
      const settings = await this.getSettings();
      if (settings?.meeting?.autoDetectMeeting) await this.startActivityMonitor();
      return;
    }

    try {
      const settings = await this.getSettings();
      const stream = await this.requestMicStream();
      this.systemAudioStream = settings?.meeting?.captureSystemAudio ? await this.requestSystemAudioStream('录音') : null;
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(stream);
      const micGain = this.audioContext.createGain();
      micGain.gain.value = this.systemAudioStream ? 0.75 : 1;
      this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.audioProcessor.onaudioprocess = async (e) => {
        if (!this.isRecording || this.isPaused) return;
        const samples = this.mixNativeSystemAudio(e.inputBuffer.getChannelData(0));
        const systemActive = this.analyserIsActive(this.systemAudioAnalyser);
        await this.updateMeetingActivityFromSamples(samples, { hasOutput: systemActive });
        const result = await window.api.feedAudio(samples);
        if (result) this.handleASRResult(result);
      };

      source.connect(micGain);
      micGain.connect(this.audioProcessor);

      if (this.systemAudioStream) {
        const systemAudioOnlyStream = new MediaStream(this.systemAudioStream.getAudioTracks());
        const systemSource = this.audioContext.createMediaStreamSource(systemAudioOnlyStream);
        const systemGain = this.audioContext.createGain();
        systemGain.gain.value = 0.75;
        this.systemAudioAnalyser = this.audioContext.createAnalyser();
        this.systemAudioAnalyser.fftSize = 2048;
        systemSource.connect(systemGain);
        systemSource.connect(this.systemAudioAnalyser);
        systemGain.connect(this.audioProcessor);
      }

      this.audioProcessor.connect(this.audioContext.destination);
      this.mediaStream = stream;
    } catch (err) {
      this.showError(`麦克风访问失败: ${err.message}`);
      const settings = await this.getSettings();
      if (settings?.meeting?.autoDetectMeeting) await this.startActivityMonitor();
      return;
    }

    this.isRecording = true;
    this.isAutoRecording = Boolean(options.autoStarted);
    this.isStoppingRecording = false;
    this.isPaused = false;
    this.startTime = Date.now();
    this.pausedTime = 0;
    this.fullText = '';
    this.sentences = [];
    this.meetingSession = null;
    this.resetStats();
    this.subtitleContainer.innerHTML = '';

    // UI
    this.btnStart.classList.add('hidden');
    this.btnPause.classList.remove('hidden');
    this.btnStop.classList.remove('hidden');
    this.btnReport.classList.add('hidden');
    this.btnResume.classList.add('hidden');
    this.timer.classList.add('active');

    this.timerInterval = setInterval(() => this.updateTimer(), 1000);
    await window.api.markMeetingRecordingStarted();
  }

  pauseRecording() {
    this.isPaused = true;
    this.pauseStart = Date.now();
    this.btnPause.classList.add('hidden');
    this.btnResume.classList.remove('hidden');
    this.timer.classList.remove('active');
  }

  resumeRecording() {
    this.isPaused = false;
    this.pausedTime += Date.now() - this.pauseStart;
    this.pauseStart = null;
    this.btnResume.classList.add('hidden');
    this.btnPause.classList.remove('hidden');
    this.timer.classList.add('active');
  }

  async stopRecording(options = {}) {
    if (this.isStoppingRecording) return;
    this.isStoppingRecording = true;

    if (this.audioProcessor) { this.audioProcessor.disconnect(); this.audioProcessor = null; }
    if (this.audioContext) { this.audioContext.close(); this.audioContext = null; }
    if (this.mediaStream) { this.mediaStream.getTracks().forEach(t => t.stop()); this.mediaStream = null; }
    if (this.systemAudioStream) { this.systemAudioStream.getTracks().forEach(t => t.stop()); this.systemAudioStream = null; }
    this.systemAudioAnalyser = null;
    await window.api.stopNativeSystemAudio();
    this.nativeSystemAudioRunning = false;
    this.nativeSystemAudioQueue = [];
    this.nativeSystemAudioQueuedSamples = 0;
    const stopResult = await window.api.stopASR();
    this.isRecording = false;
    this.isPaused = false;
    await window.api.markMeetingRecordingStopped();

    clearInterval(this.timerInterval);
    let totalPaused = this.pausedTime;
    if (this.pauseStart) totalPaused += Date.now() - this.pauseStart;
    const duration = Math.floor((Date.now() - this.startTime - totalPaused) / 1000);
    this.stats.duration = duration;

    if (stopResult?.finalText) {
      await this.loadTranscriptText(stopResult.finalText, { duration, requestFeedback: false });
    }

    // UI：显示生成报告按钮，可翻阅字幕
    this.btnStop.classList.add('hidden');
    this.btnPause.classList.add('hidden');
    this.btnResume.classList.add('hidden');
    this.btnStart.classList.remove('hidden');
    this.timer.classList.remove('active');

    if (options.discard) {
      this.clearAll();
    } else if (this.fullText.trim()) {
      this.btnReport.classList.remove('hidden');
      this.btnCopyText.classList.remove('hidden');
      this.btnSaveText.classList.remove('hidden');
      this.btnClear.classList.remove('hidden');
      this.showReviewModal();
    }

    this.isStoppingRecording = false;

    const settings = await this.getSettings();
    if (settings?.meeting?.autoDetectMeeting) {
      await this.startActivityMonitor();
    }
  }

  showReviewModal() {
    const durationText = `${this.stats.duration || 0}秒`;
    const wordText = `${this.stats.totalWords || this.fullText.length}字`;
    this.reviewSummary.textContent = `检测到一段录音：时长 ${durationText}，约 ${wordText}。请确认是否保存原始对话，或继续生成表达分析报告。`;
    this.reviewModal.classList.remove('hidden');
  }

  async confirmSaveTranscript() {
    const settings = await this.getSettings();
    if (!settings?.meeting?.autoSaveArtifacts) {
      this.addFeedbackItem('设置未开启保存原文', 'filler');
      return;
    }
    await this.saveMeetingTranscriptArtifact();
    this.reviewModal.classList.add('hidden');
  }

  async confirmSaveAndReport() {
    const settings = await this.getSettings();
    if (!settings?.meeting?.autoSaveArtifacts) {
      this.addFeedbackItem('设置未开启保存原文', 'filler');
      return;
    }
    if (!settings?.meeting?.autoGenerateReport) {
      this.addFeedbackItem('设置未开启报告生成', 'filler');
      return;
    }
    await this.saveMeetingTranscriptArtifact();
    this.reviewModal.classList.add('hidden');
    await this.generateReport({ autoSave: true });
  }

  discardCurrentRecording() {
    this.reviewModal.classList.add('hidden');
    this.clearAll();
    this.addFeedbackItem('录音已丢弃', 'filler');
  }

  // ===== ASR结果处理 =====

  handleASRResult({ text, isFinal }) {
    if (isFinal) {
      this.sentences.push(text);
      this.fullText += text;
      this.analyzeCurrentSentence(text);

      // 每30字触发一次AI反馈（语境化精准词建议）
      if (this.fullText.length - this.lastFeedbackText.length >= 30) {
        this.requestRealtimeFeedback();
      }
    }
    this.renderSubtitle(text, isFinal);
  }

  renderSubtitle(currentText, isFinal) {
    if (isFinal) {
      // 移除interim
      const interim = this.subtitleContainer.querySelector('.interim-line');
      if (interim) interim.remove();

      // 旧行变灰
      this.subtitleContainer.querySelectorAll('.subtitle-line:not(.old)').forEach(el => {
        el.classList.add('old');
      });

      // 新行
      const line = document.createElement('div');
      line.className = 'subtitle-line';
      line.innerHTML = this.highlightText(currentText);
      this.subtitleContainer.appendChild(line);
    } else {
      let interim = this.subtitleContainer.querySelector('.interim-line');
      if (!interim) {
        interim = document.createElement('div');
        interim.className = 'subtitle-line interim-line';
        this.subtitleContainer.appendChild(interim);
      }
      interim.textContent = currentText;
    }

    // 自动滚到底
    this.subtitleScroll.scrollTop = this.subtitleScroll.scrollHeight;
  }

  highlightText(text) {
    let result = text;
    const vagueWords = ['开心','难过','害怕','生气','不舒服','很好','很多','很快','很大','很小','好看','不好','喜欢','讨厌','觉得','想想'];
    vagueWords.forEach(w => {
      result = result.replace(new RegExp(w, 'g'), `<span class="vague">${w}</span>`);
    });
    const fillerPatterns = /(嗯|啊|呃|额|那个|就是|然后|这个|对吧|是吧|反正|基本上)/g;
    result = result.replace(fillerPatterns, '<span class="filler">$1</span>');
    const hedgePatterns = /(可能|也许|大概|应该|我觉得|好像|似乎|或许|不一定|差不多|感觉)/g;
    result = result.replace(hedgePatterns, '<span class="hedge">$1</span>');
    return result;
  }

  // ===== 分析 =====

  async analyzeCurrentSentence(text) {
    const analysis = await window.api.analyzeText(text);
    if (analysis) {
      this.stats.fillers += analysis.fillers.length;
      this.stats.hedges += analysis.hedges.length;
      this.stats.vagueWords += analysis.vagueWords.length;
      this.stats.totalWords += analysis.totalWords;
      this.updateStatsDisplay();
      // 碰到笼统词 → 立刻在反馈栏弹出替换建议
      if (analysis.vagueWords && analysis.vagueWords.length > 0) {
        analysis.vagueWords.forEach(item => {
          const alts = item.alternatives.slice(0, 3).join(' / ');
          this.addFeedbackItem(`「${item.word}」→ ${alts}`, 'vague');
        });
      }
      // 碰到填充词 → 弹提醒
      if (analysis.fillers && analysis.fillers.length >= 2) {
        const uniqueFillers = [...new Set(analysis.fillers.map(f => f.word))].slice(0, 3);
        this.addFeedbackItem(`填充词：${uniqueFillers.join('、')}——试试停顿`, 'filler');
      }
      // 碰到犹豫词 → 弹提醒
      if (analysis.hedges && analysis.hedges.length >= 1) {
        const uniqueHedges = [...new Set(analysis.hedges.map(h => h.word))].slice(0, 2);
        this.addFeedbackItem(`「${uniqueHedges.join('」「')}」→ 直接说`, 'hedge');
      }
    }
  }

  splitTranscript(text) {
    return text.split(/(?<=[。！？!?\n])/g).map(s => s.trim()).filter(Boolean);
  }

  async loadTranscriptText(text, { duration = 0, requestFeedback = true } = {}) {
    this.subtitleContainer.innerHTML = '';
    this.fullText = text.trim();
    this.sentences = this.splitTranscript(this.fullText);
    this.resetStats();

    for (const sentence of this.sentences) {
      const line = document.createElement('div');
      line.className = 'subtitle-line';
      line.innerHTML = this.highlightText(sentence);
      this.subtitleContainer.appendChild(line);

      const analysis = await window.api.analyzeText(sentence);
      if (analysis) {
        this.stats.fillers += analysis.fillers.length;
        this.stats.hedges += analysis.hedges.length;
        this.stats.vagueWords += analysis.vagueWords.length;
        this.stats.totalWords += analysis.totalWords;
      }
    }

    this.stats.duration = duration;
    this.updateStatsDisplay();

    if (requestFeedback) {
      this.requestRealtimeFeedback();
    }
  }

  updateStatsDisplay() {
    this.statFillers.textContent = this.stats.fillers;
    this.statHedges.textContent = this.stats.hedges;
    this.statVague.textContent = this.stats.vagueWords;
    if (this.stats.totalWords > 0) {
      const density = ((this.stats.totalWords - this.stats.fillers - this.stats.hedges) / this.stats.totalWords * 100).toFixed(0);
      this.statDensity.textContent = density + '%';
    }
  }

  // ===== 实时反馈 =====

  async requestRealtimeFeedback() {
    this.lastFeedbackText = this.fullText;
    const result = await window.api.getRealtimeFeedback(this.fullText);
    if (result.success && result.feedback) {
      const lines = result.feedback.split('\n').filter(l => l.trim());
      lines.forEach(line => {
        const type = this.classifyFeedback(line.trim());
        this.addFeedbackItem(line.trim(), type);
      });
    }
  }

  classifyFeedback(text) {
    if (text === '✓' || text.includes('✓')) return 'good';
    // 填充词相关
    const fillerKeywords = ['嗯','啊','呃','那个','就是','然后','这个','对吧','是吧','反正','基本上','所以说'];
    if (fillerKeywords.some(w => text.includes(`「${w}」`))) return 'filler';
    // 犹豫词相关
    const hedgeKeywords = ['可能','也许','大概','应该','我觉得','好像','似乎','感觉','或许'];
    if (hedgeKeywords.some(w => text.includes(`「${w}」`))) return 'hedge';
    // 其他精准词替换
    if (text.includes('→')) return 'vague';
    return 'ai';
  }

  addFeedbackItem(text, type = 'ai') {
    // 去重：如果前3条已经有相同内容，跳过
    const existing = Array.from(this.feedbackContent.children).slice(0, 3);
    if (existing.some(el => el.textContent === text)) return;

    const item = document.createElement('div');
    item.className = `feedback-item type-${type}`;
    item.textContent = text;
    this.feedbackContent.insertBefore(item, this.feedbackContent.firstChild);
    while (this.feedbackContent.children.length > 12) {
      this.feedbackContent.removeChild(this.feedbackContent.lastChild);
    }
  }

  // ===== 报告 =====

  async generateReport(options = {}) {
    this.reportBody.innerHTML = '<p style="text-align:center;color:#666;padding:40px;">正在生成报告...</p>';
    this.reportModal.classList.remove('hidden');

    const result = await window.api.getFinalReport({
      fullText: this.fullText,
      stats: this.stats
    });

    if (result.success) {
      this.lastReport = result.report;
      this.renderReport(result.report);
      if (options.autoSave) {
        await this.saveMeetingReportArtifact(result.report);
      }
    } else {
      this.reportBody.innerHTML = `<p style="color:#ff6b6b;">生成失败: ${result.error}</p>`;
    }
  }

  renderReport(report) {
    let html = report
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/\|(.+)\|/g, (match) => {
        // 简单表格支持
        return match;
      })
      .replace(/\n/g, '<br>');

    this.reportBody.innerHTML = `
      <div style="text-align:right;margin-bottom:12px;">
        <button id="btn-save-report" style="background:#E5007E;color:#fff;border:none;border-radius:6px;padding:8px 14px;font-size:12px;cursor:pointer;">💾 保存为 Markdown</button>
      </div>
      ${html}
    `;

    document.getElementById('btn-save-report').addEventListener('click', () => this.saveReport());
  }

  async saveReport() {
    if (!this.lastReport) return;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    const markdown = `# 表达训练报告\n\n**日期**: ${dateStr}  \n**时长**: ${this.stats.duration}秒  \n**总字数**: ${this.stats.totalWords}  \n\n---\n\n## 完整原文\n\n${this.fullText}\n\n---\n\n${this.lastReport}`;
    const filename = `表达训练-${dateStr}-${timeStr}.md`;

    try {
      const result = await window.api.saveFile(markdown, filename);
      if (result.success) {
        const btn = document.getElementById('btn-save-report');
        btn.textContent = '✓ 已保存';
        btn.style.background = '#333';
        setTimeout(() => { btn.textContent = '💾 保存为 Markdown'; btn.style.background = '#E5007E'; }, 2000);
      }
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  }

  async saveMeetingTranscriptArtifact() {
    const settings = await this.getSettings();
    if (!settings?.meeting?.autoSaveArtifacts || !this.fullText.trim()) return;
    if (this.meetingSession?.sessionDir) return;

    const result = await window.api.saveMeetingTranscript({
      transcript: this.fullText,
      stats: this.stats
    });

    if (result.success) {
      this.meetingSession = result;
      this.addFeedbackItem(`原始对话已保存：${result.sessionDir}`, 'good');
    } else {
      this.addFeedbackItem(`保存原文失败：${result.error}`, 'filler');
    }
  }

  async saveMeetingReportArtifact(report) {
    const settings = await this.getSettings();
    if (!settings?.meeting?.autoSaveArtifacts || !this.meetingSession?.sessionDir) return;

    const result = await window.api.saveMeetingReport({
      sessionDir: this.meetingSession.sessionDir,
      transcript: this.fullText,
      report,
      stats: this.stats
    });

    if (result.success) {
      this.meetingSession = { ...this.meetingSession, ...result };
      this.addFeedbackItem(`分析报告已保存：${result.reportPath}`, 'good');
    } else {
      this.addFeedbackItem(`保存报告失败：${result.error}`, 'filler');
    }
  }

  // ===== 工具 =====

  updateTimer() {
    let totalPaused = this.pausedTime;
    if (this.pauseStart) totalPaused += Date.now() - this.pauseStart;
    const elapsed = Math.floor((Date.now() - this.startTime - totalPaused) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    this.timer.textContent = `${minutes}:${seconds}`;
  }

  resetStats() {
    this.stats = { fillers: 0, hedges: 0, vagueWords: 0, totalWords: 0, duration: 0 };
    this.updateStatsDisplay();
    this.feedbackContent.innerHTML = '';
  }

  showError(msg) {
    const line = document.createElement('div');
    line.className = 'subtitle-line';
    line.style.color = '#ff6b6b';
    line.textContent = msg;
    this.subtitleContainer.appendChild(line);
  }

  // ===== 复制 & 保存原文 & 清空 =====

  copyOriginalText() {
    if (!this.fullText.trim()) return;
    navigator.clipboard.writeText(this.fullText).then(() => {
      this.btnCopyText.textContent = '✓ 已复制';
      setTimeout(() => { this.btnCopyText.textContent = '📋 复制'; }, 1500);
    });
  }

  async saveOriginalText() {
    if (!this.fullText.trim()) return;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    const markdown = `# 表达训练原文\n\n**日期**: ${dateStr}\n\n---\n\n${this.fullText}`;
    const filename = `原文-${dateStr}-${timeStr}.md`;

    try {
      const result = await window.api.saveFile(markdown, filename);
      if (result.success) {
        this.btnSaveText.textContent = '✓ 已保存';
        setTimeout(() => { this.btnSaveText.textContent = '💾 保存'; }, 2000);
      }
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  }

  clearAll() {
    this.fullText = '';
    this.sentences = [];
    this.lastReport = '';
    this.meetingSession = null;
    this.subtitleContainer.innerHTML = '<div class="subtitle-line hint">点击下方按钮开始说话</div>';
    this.feedbackContent.innerHTML = '';
    this.resetStats();
    this.timer.textContent = '00:00';
    this.timer.classList.remove('active');
    this.btnReport.classList.add('hidden');
    this.btnCopyText.classList.add('hidden');
    this.btnSaveText.classList.add('hidden');
    this.btnClear.classList.add('hidden');
  }

  // ===== 粘贴逐字稿分析 =====

  openPasteModal() {
    this.pasteTextarea.value = '';
    this.pasteModal.classList.remove('hidden');
    this.pasteTextarea.focus();
  }

  async analyzePastedText() {
    const text = this.pasteTextarea.value.trim();
    if (!text) return;

    // 关闭粘贴弹窗
    this.pasteModal.classList.add('hidden');

    await this.loadTranscriptText(text, { duration: 0, requestFeedback: false });

    // 显示操作按钮
    this.btnReport.classList.remove('hidden');
    this.btnCopyText.classList.remove('hidden');
    this.btnSaveText.classList.remove('hidden');
    this.btnClear.classList.remove('hidden');

    // 请求AI语境化反馈
    this.requestRealtimeFeedback();
  }
}

document.addEventListener('DOMContentLoaded', () => { new ExpressionTrainer(); });
