// 智能表达训练系统 V2

class ExpressionTrainer {
  constructor({ root, api, session, workspace }) {
    this.root = root;
    this.api = api;
    this.session = session;
    this.workspace = workspace;
    this.transcriptRevision = 0;
    this.transcriptSource = 'realtime';
    this.editorModified = false;
    this.savePromise = null;
    this.finalArtifactRefreshPromise = null;
    this.finalCandidate = null;
    this.isStartingRecording = false;
    this.pendingAudioFeeds = new Set();
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
    this.lastMinutes = '';
    this.settings = null;
    this.meetingSession = null;
    this.pendingAudioPath = '';
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
    this.lastAsrPerfLogAt = 0;
    this.awaitingFinalTranscript = false;
    this.sessionGeneration = 0;
    this.activeSessionGeneration = 0;
    this.pendingFinalTranscriptGeneration = 0;
    this.realtimePhraseBuffer = '';
    this.realtimePhraseLastAt = 0;
    this.currentStage = 'live';

    this.initElements();
    this.bindEvents();
    this.bindNativeSystemAudioEvents();
    this.bindASRFinalEvents();
    this.loadSettingsAndMaybeAutoStart();
  }

  initElements() {
    this.btnStart = this.root.getElementById('btn-start');
    this.btnPaste = this.root.getElementById('btn-paste');
    this.btnPause = this.root.getElementById('btn-pause');
    this.btnResume = this.root.getElementById('btn-resume');
    this.btnStop = this.root.getElementById('btn-stop');
    this.btnReport = this.root.getElementById('btn-report');
    this.btnSettings = this.root.getElementById('btn-settings');
    this.btnCloseReport = this.root.getElementById('btn-close-report');
    this.reviewModal = this.root.getElementById('review-modal');
    this.reviewSummary = this.root.getElementById('review-summary');
    this.btnReviewClose = this.root.getElementById('btn-review-close');
    this.btnReviewDiscard = this.root.getElementById('btn-review-discard');
    this.btnReviewSave = this.root.getElementById('btn-review-save');
    this.btnReviewReport = this.root.getElementById('btn-review-report');
    this.btnClosePaste = this.root.getElementById('btn-close-paste');
    this.btnAnalyzePaste = this.root.getElementById('btn-analyze-paste');
    this.btnPolishTranscript = this.root.getElementById('btn-polish-transcript');
    this.btnGoMinutes = this.root.getElementById('btn-go-minutes');
    this.btnCopyText = this.root.getElementById('btn-copy-text');
    this.btnSaveText = this.root.getElementById('btn-save-text');
    this.btnClear = this.root.getElementById('btn-clear');
    this.btnCopyReport = this.root.getElementById('btn-copy-report');
    this.btnGenerateMinutes = this.root.getElementById('btn-generate-minutes');
    this.btnCopyMinutes = this.root.getElementById('btn-copy-minutes');
    this.btnSaveMinutes = this.root.getElementById('btn-save-minutes');
    this.btnAudioSelect = this.root.getElementById('btn-audio-select');
    this.btnAudioAnalyze = this.root.getElementById('btn-audio-analyze');
    this.btnAudioTranscribe = this.root.getElementById('btn-audio-transcribe');
    this.btnAudioCancel = this.root.getElementById('btn-audio-cancel');
    this.audioProgress = this.root.getElementById('audio-analysis-progress');
    this.audioProgressStage = this.root.getElementById('audio-progress-stage');
    this.audioProgressDetail = this.root.getElementById('audio-progress-detail');
    this.audioProgressBar = this.root.getElementById('audio-progress-bar');
    this.audioProgressTime = this.root.getElementById('audio-progress-time');
    this.audioDropzone = this.root.getElementById('audio-dropzone');
    this.audioFileName = this.root.getElementById('audio-file-name');
    this.audioPlayer = this.root.getElementById('audio-player');
    this.audioWaveform = this.root.getElementById('audio-waveform');
    this.audioCurrentTime = this.root.getElementById('audio-current-time');
    this.audioDuration = this.root.getElementById('audio-duration');
    this.audioAnalysisResult = this.root.getElementById('audio-analysis-result');
    this.audioFile = null;
    this.speakerSegments = [];
    this.audioAnalysisCancelled = false;
    this.pasteModal = this.root.getElementById('paste-modal');
    this.pasteTextarea = this.root.getElementById('paste-textarea');
    this.transcriptEditor = this.root.getElementById('transcript-editor');
    this.stageTabs = Array.from(this.root.querySelectorAll('.stage-tab'));
    this.stagePanels = Array.from(this.root.querySelectorAll('.stage-panel'));
    this.sessionStatus = this.root.getElementById('session-status');
    this.timer = this.root.getElementById('timer');
    this.subtitleScroll = this.root.getElementById('subtitle-scroll');
    this.subtitleContainer = this.root.getElementById('subtitle-container');
    this.feedbackContent = this.root.getElementById('feedback-content');
    this.reportModal = this.root.getElementById('report-modal');
    this.reportBody = this.root.getElementById('report-body');
    this.minutesBody = this.root.getElementById('minutes-body');
    this.statFillers = this.root.getElementById('stat-fillers');
    this.statHedges = this.root.getElementById('stat-hedges');
    this.statVague = this.root.getElementById('stat-vague');
    this.statDensity = this.root.getElementById('stat-density');
  }

  bindEvents() {
    this.stageTabs.forEach(tab => {
      tab.addEventListener('click', () => this.switchStage(tab.dataset.stage));
    });
    this.btnStart.addEventListener('click', () => this.startRecording());
    this.btnPaste.addEventListener('click', () => this.openPasteModal());
    this.btnPause.addEventListener('click', () => this.pauseRecording());
    this.btnResume.addEventListener('click', () => this.resumeRecording());
    this.btnStop.addEventListener('click', () => this.stopRecording());
    this.btnReport.addEventListener('click', () => this.generateReport());
    this.btnGenerateMinutes.addEventListener('click', () => this.generateMinutes());
    this.btnSettings.addEventListener('click', () => this.api.openSettings());
    this.root.getElementById('btn-prompt-editor').addEventListener('click', () => this.api.openPromptEditor());
    this.btnCloseReport.addEventListener('click', () => this.reportModal.classList.add('hidden'));
    this.btnReviewClose.addEventListener('click', () => this.reviewModal.classList.add('hidden'));
    this.btnReviewDiscard.addEventListener('click', () => this.discardCurrentRecording());
    this.btnReviewSave.addEventListener('click', () => this.confirmSaveTranscript());
    this.btnReviewReport.addEventListener('click', () => this.confirmSaveAndReport());
    this.btnCopyReport.addEventListener('click', () => {
      const reportText = this.reportBody.innerText;
      navigator.clipboard.writeText(reportText).then(() => {
        this.btnCopyReport.textContent = '✅ 已复制';
        setTimeout(() => { this.btnCopyReport.textContent = '复制全文'; }, 2000);
      });
    });
    this.btnCopyMinutes.addEventListener('click', () => {
      if (!this.lastMinutes) return;
      navigator.clipboard.writeText(this.lastMinutes).then(() => {
        this.btnCopyMinutes.textContent = '已复制';
        setTimeout(() => { this.btnCopyMinutes.textContent = '复制全文'; }, 2000);
      });
    });
    this.btnSaveMinutes.addEventListener('click', () => this.saveMinutes());
    this.btnAudioSelect.addEventListener('click', () => this.selectAudioFile());
    this.btnAudioAnalyze.addEventListener('click', () => this.runAudioAnalysis(false));
    this.btnAudioTranscribe.addEventListener('click', () => this.runAudioAnalysis(true));
    this.btnAudioCancel.addEventListener('click', () => this.cancelAudioAnalysis());
    this.api.onAudioAnalysisProgress(progress => this.renderAudioProgress(progress));
    ['dragenter', 'dragover'].forEach(type => this.audioDropzone.addEventListener(type, event => {
      event.preventDefault();
      this.audioDropzone.classList.add('dragging');
    }));
    ['dragleave', 'drop'].forEach(type => this.audioDropzone.addEventListener(type, event => {
      event.preventDefault();
      this.audioDropzone.classList.remove('dragging');
    }));
    this.audioDropzone.addEventListener('drop', event => this.handleAudioDrop(event));
    this.audioPlayer.addEventListener('loadedmetadata', () => {
      this.audioDuration.textContent = this.formatAudioTime(this.audioPlayer.duration);
      this.drawAudioWaveform();
    });
    this.audioPlayer.addEventListener('timeupdate', () => {
      this.audioCurrentTime.textContent = this.formatAudioTime(this.audioPlayer.currentTime);
      this.drawAudioWaveform();
    });
    this.audioWaveform.addEventListener('click', event => this.seekAudio(event));
    this.btnClosePaste.addEventListener('click', () => this.pasteModal.classList.add('hidden'));
    this.btnAnalyzePaste.addEventListener('click', () => this.analyzePastedText());
    this.btnPolishTranscript.addEventListener('click', () => this.polishTranscript());
    this.btnGoMinutes.addEventListener('click', () => this.goToMinutes());
    this.btnCopyText.addEventListener('click', () => this.copyOriginalText());
    this.btnSaveText.addEventListener('click', () => this.saveOriginalText());
    this.btnClear.addEventListener('click', () => this.clearAll());
    this.transcriptEditor.addEventListener('input', () => this.handleTranscriptEditorInput());
    this.root.getElementById('btn-adopt-final').addEventListener('click', async () => {
      if (!this.finalCandidate) return;
      const result = this.finalCandidate;
      this.finalCandidate = null;
      this.editorModified = false;
      this.transcriptSource = 'final';
      await this.loadTranscriptText(result.finalText, { duration: this.stats.duration, requestFeedback: false });
      this.root.getElementById('btn-adopt-final').classList.add('hidden');
      await this.refreshSavedArtifactFromFinal(this.activeSessionGeneration);
    });
  }

  switchStage(stage) {
    if (!stage || this.currentStage === stage) return;

    this.currentStage = stage;
    this.stageTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.stage === stage));
    this.stagePanels.forEach(panel => panel.classList.toggle('active', panel.dataset.panel === stage));
  }

  setSessionStatus(text) {
    if (this.sessionStatus) this.sessionStatus.textContent = text;
    this.session.status = text;
    this.workspace.render();
  }

  isSessionCurrent(sessionGeneration) {
    return sessionGeneration === this.activeSessionGeneration;
  }

  syncTranscriptEditor() {
    if (this.transcriptEditor && this.transcriptEditor.value !== this.fullText) {
      this.transcriptEditor.value = this.fullText;
    }
  }

  updateTextActionVisibility() {
    const hasText = Boolean(this.fullText.trim() || this.transcriptEditor.value.trim());
    this.btnReport.classList.toggle('hidden', !hasText);
    this.btnCopyText.classList.toggle('hidden', !hasText);
    this.btnSaveText.classList.toggle('hidden', !hasText);
    this.btnClear.classList.toggle('hidden', !hasText);
  }

  handleTranscriptEditorInput() {
    this.fullText = this.transcriptEditor.value;
    this.transcriptRevision++;
    this.editorModified = true;
    this.transcriptSource = this.session.startedAt ? 'edited' : 'pasted';
    this.updateTextActionVisibility();
    this.lastMinutes = '';
    this.btnCopyMinutes.classList.add('hidden');
    this.btnSaveMinutes.classList.add('hidden');
    this.minutesBody.innerHTML = '<p class="empty-state">原文已修改，请重新生成会议纪要。</p>';
    this.btnGenerateMinutes.textContent = '生成纪要';
    this.workspace.render();
  }

  goToMinutes() {
    const text = this.transcriptEditor.value.trim() || this.fullText.trim();
    if (!text) {
      this.addFeedbackItem('先录制或粘贴一段会议原文，再进入会议纪要', 'filler');
      this.transcriptEditor.focus();
      return;
    }
    this.switchStage('minutes');
  }

  formatAudioTime(seconds) {
    if (!Number.isFinite(seconds)) return '00:00';
    const total = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  async selectAudioFile() {
    if (this.audioJobId) return;
    const result = await this.api.selectAudioFile();
    if (result?.success) this.setAudioFile(result);
  }

  handleAudioDrop(event) {
    if (this.audioJobId) return;
    const file = event.dataTransfer?.files?.[0];
    if (!file?.path) {
      this.audioAnalysisResult.innerHTML = '<p class="analysis-error">无法读取拖入文件，请使用“选择音频”。</p>';
      return;
    }
    this.setAudioFile({ success: true, filePath: file.path, fileUrl: URL.createObjectURL(file), name: file.name });
  }

  setAudioFile(file) {
    this.audioFile = file;
    this.audioFileName.textContent = file.name || file.filePath;
    this.audioDropzone.classList.add('has-file');
    this.audioPlayer.src = file.fileUrl || `file://${file.filePath}`;
    this.audioPlayer.load();
    this.btnAudioAnalyze.disabled = false;
    this.btnAudioTranscribe.disabled = false;
    this.audioAnalysisResult.innerHTML = '<p class="empty-state">音频已载入。可以先播放预览，再选择分析方式。</p>';
  }

  drawAudioWaveform() {
    const canvas = this.audioWaveform;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width || 640));
    const height = Number(canvas.dataset.logicalHeight || canvas.height);
    canvas.dataset.logicalHeight = String(height);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const progress = this.audioPlayer.duration ? this.audioPlayer.currentTime / this.audioPlayer.duration : 0;
    const bars = Math.max(30, Math.floor(width / 5));
    for (let i = 0; i < bars; i++) {
      const wave = 0.22 + Math.abs(Math.sin(i * 0.71) * 0.45) + Math.abs(Math.sin(i * 0.17) * 0.22);
      const barHeight = Math.min(height * 0.82, Math.max(4, wave * height * 0.58));
      const x = i * width / bars;
      context.fillStyle = i / bars <= progress ? '#e5007e' : '#394149';
      context.fillRect(x, (height - barHeight) / 2, Math.max(2, width / bars - 2), barHeight);
    }
  }

  seekAudio(event) {
    if (!this.audioPlayer.duration) return;
    const rect = this.audioWaveform.getBoundingClientRect();
    this.audioPlayer.currentTime = ((event.clientX - rect.left) / rect.width) * this.audioPlayer.duration;
  }

  async runAudioAnalysis(transcribe) {
    if (!this.audioFile?.filePath || this.audioJobId) return;
    const filePath = this.audioFile.filePath;
    const jobId = crypto.randomUUID();
    this.audioJobId = jobId;
    this.btnAudioSelect.disabled = true;
    this.btnAudioAnalyze.disabled = true;
    this.btnAudioTranscribe.disabled = true;
    this.audioAnalysisCancelled = false;
    this.btnAudioCancel.classList.remove('hidden');
    this.btnAudioCancel.disabled = false;
    this.audioProgress.classList.remove('hidden');
    this.audioProgressStage.textContent = transcribe ? '准备转写' : '分析音频';
    this.audioAnalysisResult.innerHTML = `<p class="empty-state">正在${transcribe ? '转写并分析' : '分析音频'}，全程在本机执行...</p>`;
    this.setSessionStatus('本地音频分析中');
    try {
      const result = await this.api.analyzeAudioFile({ filePath, jobId });
      if (this.audioAnalysisCancelled) throw new Error('分析已取消');
      if (!result.success) throw new Error(result.error || '音频分析失败');
      this.renderAudioAnalysis(result.audioAnalysis, null);
      if (transcribe) {
        this.audioAnalysisResult.insertAdjacentHTML('afterbegin', '<p class="analysis-progress">声学分析已完成，正在进行本地转写和说话人分离...</p>');
        this.setSessionStatus('本地转写与说话人分离中');
        const transcriptionResult = await this.api.transcribeAudioFile({ filePath, jobId });
        if (this.audioAnalysisCancelled) throw new Error('分析已取消');
        if (!transcriptionResult.success) throw new Error(transcriptionResult.error || '本地转写失败');
        this.renderAudioAnalysis(transcriptionResult.audioAnalysis, transcriptionResult.transcription);
      }
      this.setSessionStatus('音频分析完成');
    } catch (error) {
      if (this.audioAnalysisCancelled) {
        this.audioAnalysisResult.innerHTML = '<p class="empty-state">分析已取消，未保存不完整的转写结果。</p>';
        this.setSessionStatus('音频分析已取消');
      } else {
        this.audioAnalysisResult.innerHTML = `<p class="analysis-error">分析失败：${error.message}</p>`;
        this.setSessionStatus('音频分析失败');
      }
    } finally {
      this.audioJobId = null;
      this.btnAudioSelect.disabled = false;
      this.btnAudioAnalyze.disabled = false;
      this.btnAudioTranscribe.disabled = false;
      this.btnAudioCancel.disabled = true;
      this.btnAudioCancel.classList.add('hidden');
      this.audioProgress.classList.add('hidden');
    }
  }

  renderAudioProgress(progress = {}) {
    if (progress.jobId !== this.audioJobId || this.audioAnalysisCancelled) return;
    const labels = { 'loading-model': '加载模型', chunking: '音频切片', transcribing: '转写', diarization: '说话人分离', opensmile: 'openSMILE' };
    const total = Number(progress.totalSeconds || this.audioPlayer.duration || 0);
    const processed = Math.min(total || 0, Number(progress.processedSeconds || 0));
    this.audioProgress.classList.remove('hidden');
    this.audioProgressStage.textContent = labels[progress.stage] || '分析中';
    this.audioProgressDetail.textContent = progress.detail || '';
    this.audioProgressBar.value = total ? processed / total : 0;
    this.audioProgressTime.textContent = `${this.formatAudioTime(processed)} / ${this.formatAudioTime(total)}`;
  }

  async cancelAudioAnalysis() {
    if (this.btnAudioCancel.disabled) return;
    this.btnAudioCancel.disabled = true;
    this.audioAnalysisCancelled = true;
    this.audioProgressDetail.textContent = '正在停止当前任务...';
    await this.api.cancelAudioAnalysis(this.audioJobId);
  }

  renderAudioAnalysis(analysis, transcription) {
    if (!analysis) return;
    const audio = analysis.audio || analysis;
    const interaction = analysis.interaction || {};
    const clarity = analysis.clarity || {};
    const atmosphere = analysis.atmosphere || {};
    const speechPercent = Math.round((analysis.speechRatio || 0) * 100);
    const interpretation = audio.interpretation || {};
    this.root.getElementById('audio-metric-duration').textContent = this.formatAudioTime(audio.durationSeconds);
    this.root.getElementById('audio-metric-speech').textContent = `${Math.round((audio.speechRatio || 0) * 100)}%`;
    this.root.getElementById('audio-metric-silence').textContent = this.formatAudioTime(audio.silenceSeconds);
    this.root.getElementById('audio-metric-energy').textContent = interpretation.energy || '--';
    const transcriptText = transcription?.text || '';
    this.audioAnalysisResult.innerHTML = `
      <div class="analysis-summary-grid">
        <div><span>整体氛围</span><strong>${atmosphere.label || '相对平稳'}</strong></div>
        <div><span>表达语气</span><strong>${atmosphere.tone || interpretation.stability || '未知'}</strong></div>
        <div><span>互动轮次</span><strong>${interaction.turnCount ?? '--'}</strong></div>
        <div><span>参与均衡度</span><strong>${interaction.participationBalance == null ? '--' : `${Math.round(interaction.participationBalance * 100)}%`}</strong></div>
      </div>
      <h3>氛围与语气信号</h3>
      <p>音频能量${interpretation.energy || '未知'}，停顿负荷${interpretation.pauseLoad || '未知'}，能量变化${audio.energyChangeCount || 0} 次，音高变化代理 ${audio.pitchVariationHz || 0} Hz。</p>
      <p>正向/担忧/挫败/兴奋信号：${atmosphere.sentiment?.agreement || 0} / ${atmosphere.sentiment?.concern || 0} / ${atmosphere.sentiment?.frustration || 0} / ${atmosphere.sentiment?.excitement || 0}。这些是提示信号，不是情绪定论。</p>
      <p>非语言线索：笑声 ${atmosphere.nonVerbal?.laughterCount || 0} 次，叹气/叹词 ${atmosphere.nonVerbal?.sighCount || 0} 次，犹豫音 ${atmosphere.nonVerbal?.hesitationCount || 0} 次。</p>
      ${this.renderAudioTimeline(audio.timeline || [])}
      ${this.renderInteractionSummary(interaction, clarity)}
      ${transcriptText ? `<h3>本地转写</h3><p>${this.escapeHtml(transcriptText)}</p>` : ''}
      <p class="analysis-note">${audio.openSmile?.enabled ? '已启用 openSMILE eGeMAPS 个人声学特征。' : `openSMILE 未启用：${audio.openSmile?.error || '未配置'}。`} ${interaction.speakerCount > 1 && interaction.speakers?.some(item => item.acoustics) ? '个人声学指标已按说话人时间片段计算，但重叠语音和错误分离仍需回听复核。' : '当前还没有可用的说话人时间片段；独立声学分析不需要配置说话人分离，多人个人语气请点击“转写并分析”。'}</p>
    `;
  }

  renderInteractionSummary(interaction, clarity) {
    const speakerRows = (interaction.speakers || []).map(item => {
      const acoustics = item.acoustics;
      const smile = item.openSmile;
      const acousticText = acoustics
        ? `${acoustics.toneSignal}<br>${acoustics.averagePitchHz || '--'} Hz / ${acoustics.averageRms || '--'}${smile ? `<br><small>eGeMAPS: ${smile.pitchMeanSemitone == null ? '--' : smile.pitchMeanSemitone} st</small>` : ''}`
        : '无分离数据';
      return `<tr><td>${this.escapeHtml(item.speaker)}</td><td>${item.turnCount}</td><td>${Math.round(item.participation * 100)}%</td><td>${item.wordsPerMinute} 字/分</td><td>${item.fillers}/${item.hedges}</td><td>${acousticText}</td></tr>`;
    }).join('');
    return `<h3>互动关系与表达清晰度</h3><p>说话人 ${interaction.speakerCount || 0} 位，打断/重叠 ${interaction.interruptions || 0} 次，重叠约 ${Number(interaction.overlapSeconds || 0).toFixed(1)} 秒，平均回应延迟 ${interaction.averageResponseDelaySeconds == null ? '未检测' : `${interaction.averageResponseDelaySeconds} 秒`}。</p><p>长句 ${clarity.longSentenceCount || 0} 个，填充词 ${clarity.fillerCount || 0} 个，犹豫词 ${clarity.hedgeCount || 0} 个，信息密度 ${Math.round((clarity.informationDensity || 0) * 100)}%。</p>${speakerRows ? `<table class="audio-speaker-table"><thead><tr><th>说话人</th><th>轮次</th><th>发言占比</th><th>语速代理</th><th>口癖/犹豫</th><th>个人声学</th></tr></thead><tbody>${speakerRows}</tbody></table>` : ''}`;
  }

  renderAudioTimeline(timeline) {
    if (!timeline.length) return '';
    const items = timeline.map(item => {
      const width = Math.max(3, ((item.endSeconds - item.startSeconds) / Math.max(1, this.audioPlayer.duration || item.endSeconds)) * 100);
      return `<button class="audio-timeline-item" style="width:${width}%" data-audio-seek="${item.startSeconds}" title="${this.formatAudioTime(item.startSeconds)} ${item.label}"><span></span></button>`;
    }).join('');
    setTimeout(() => {
      this.audioAnalysisResult.querySelectorAll('[data-audio-seek]').forEach(item => {
        item.addEventListener('click', () => {
          this.audioPlayer.currentTime = Number(item.dataset.audioSeek);
          this.audioPlayer.play();
        });
      });
    }, 0);
    return `<h3>氛围变化时间线</h3><div class="audio-timeline">${items}</div><div class="audio-timeline-caption">每格约 30 秒，点击任意区间回听</div>`;
  }

  escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  bindNativeSystemAudioEvents() {
    this.api.onNativeSystemAudioSamples((data) => {
      if (!this.workspace.ownsAudio(this)) return;
      const samples = new Float32Array(data.samples || []);
      if (!samples.length) return;

      this.enqueueNativeSystemAudio(samples);
      if (this.calculateRMS(samples) >= this.micActivityThreshold) {
        this.lastNativeSystemAudioAt = Date.now();
        this.updateMeetingActivityState({ hasInput: true, hasOutput: true });
      }
    });

    this.api.onNativeSystemAudioEvent((event) => {
      if (!this.workspace.ownsAudio(this)) return;
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

  bindASRFinalEvents() {
    this.api.onASRFinalResult(async (result) => {
      if (result?.sessionId !== this.session.id || !this.awaitingFinalTranscript || this.pendingFinalTranscriptGeneration !== this.activeSessionGeneration) return;
      const sessionGeneration = this.pendingFinalTranscriptGeneration;

      if (result?.finalTextError) {
        this.awaitingFinalTranscript = false;
        this.setSessionStatus(this.fullText.trim() ? '待确认' : '待开始');
        this.addFeedbackItem(result.finalTextError, 'filler');
        if (this.fullText.trim()) this.showReviewModal();
        return;
      }

      if (result?.finalText) {
        if (result.recordingPath) this.pendingAudioPath = result.recordingPath;
        this.speakerSegments = result.speakerSegments || [];
        const duration = this.stats.duration || 0;
        if (this.editorModified) {
          this.finalCandidate = result;
          this.root.getElementById('btn-adopt-final').classList.remove('hidden');
          this.addFeedbackItem('最终稿已就绪，已保留你的编辑；可点击“采用最终稿”进行替换。', 'ai');
        } else {
          this.transcriptSource = 'final';
          try {
            await this.loadTranscriptText(result.finalText, { duration, requestFeedback: false, sessionGeneration });
          } catch (error) {
            this.addFeedbackItem(`最终稿已接收，但词库分析失败：${error.message}`, 'filler');
          }
        }
        if (!this.isSessionCurrent(sessionGeneration)) return;
        this.awaitingFinalTranscript = false;
        this.setSessionStatus('待确认');
        this.addFeedbackItem('Qwen3-ASR 最终稿已生成', 'good');
        if (result.speakerCount > 1) {
          this.addFeedbackItem(`已按音色区分 ${result.speakerCount} 位说话人`, 'good');
        } else if (result.speakerError) {
          this.addFeedbackItem('说话人区分失败，已保留普通最终稿', 'filler');
        }
        this.showReviewModal();
        this.btnReport.classList.remove('hidden');
        this.btnCopyText.classList.remove('hidden');
        this.btnSaveText.classList.remove('hidden');
        this.btnClear.classList.remove('hidden');
        await this.refreshSavedArtifactFromFinal(sessionGeneration);
      } else {
        this.awaitingFinalTranscript = false;
        this.setSessionStatus('最终稿为空，已保留实时稿');
      }
    });
  }

  async loadSettingsAndMaybeAutoStart() {
    this.settings = await this.api.getSettings();
    this.micActivityThreshold = Number(this.settings?.meeting?.micActivityThreshold || 0.02);
    if ([...this.workspace.sessions.items.keys()][0] !== this.session.id) return;
    if (this.settings?.meeting?.autoStartRecording) {
      setTimeout(() => {
        if (!this.isRecording && !this.fullText.trim()) this.startRecording();
      }, 600);
    } else if (this.settings?.meeting?.autoDetectMeeting) {
      setTimeout(() => this.startActivityMonitor(), 600);
    }
  }

  async getSettings() {
    this.settings = await this.api.getSettings();
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

    const result = await this.api.updateMeetingActivity({
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

    const nativeResult = await this.api.startNativeSystemAudio();
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
        const status = await this.api.getSystemAudioStatus();
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
      const status = await this.api.getSystemAudioStatus();
      const authHint = status?.platform === 'darwin'
        ? '请检查屏幕录制权限并重启应用'
        : '请检查系统音频捕获权限';
      this.addFeedbackItem(`${contextLabel}系统音频捕获失败：${err.message}。${authHint}`, 'filler');
      return null;
    }
  }

  async startActivityMonitor({ claimed = false } = {}) {
    if (!claimed) return this.workspace.startMonitor(this);
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
      this.setSessionStatus('监听会议');
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
    await this.api.stopNativeSystemAudio();
    this.nativeSystemAudioRunning = false;
    if (!this.isRecording) this.setSessionStatus(this.fullText.trim() ? '已有原文' : '待开始');
  }

  async startRecording(options = {}) {
    if (this.isRecording || this.isStartingRecording) return;
    if (this.session.startedAt || this.fullText.trim() || this.audioFile) {
      if (this.workspace.sessions.recordingId) return this.workspace.notice('请先结束当前录音，再开始下一场会议。');
      return this.workspace.create().startRecording(options);
    }
    this.isStartingRecording = true;
    try {
      if (!await this.workspace.beginCapture(this)) return;
      const sessionGeneration = ++this.sessionGeneration;
      this.activeSessionGeneration = sessionGeneration;
      this.awaitingFinalTranscript = false;
      this.pendingFinalTranscriptGeneration = 0;
      await this.stopActivityMonitor();
      this.switchStage('live');

      const initResult = await this.api.initASR();
      if (!initResult.success) {
        this.showError(`语音识别启动失败: ${initResult.error}`);
        const settings = await this.getSettings();
        if (settings?.meeting?.autoDetectMeeting) await this.startActivityMonitor();
        this.isStartingRecording = false;
        return;
      }
      if (initResult.mode === 'offline') {
        this.addFeedbackItem('当前识别模型为离线最终转写，录制中不会实时出字幕', 'filler');
      } else if (initResult.mode === 'streaming-final') {
        this.addFeedbackItem('当前识别模型为实时字幕 + 高质量最终转写', 'good');
      } else if (initResult.mode === 'streaming') {
        this.addFeedbackItem('当前识别模型为低延迟流式字幕', 'good');
      }

      try {
        const settings = await this.getSettings();
        const stream = await this.requestMicStream();
        this.mediaStream = stream;
        this.systemAudioStream = settings?.meeting?.captureSystemAudio ? await this.requestSystemAudioStream('录音') : null;
        this.audioContext = new AudioContext({ sampleRate: 16000 });
        const source = this.audioContext.createMediaStreamSource(stream);
        const micGain = this.audioContext.createGain();
        micGain.gain.value = this.systemAudioStream ? 0.75 : 1;
        this.audioProcessor = this.audioContext.createScriptProcessor(2048, 1, 1);
        this.audioProcessor.onaudioprocess = async (e) => {
          if (!this.isRecording || this.isPaused || this.isStoppingRecording) return;
          const samples = this.mixNativeSystemAudio(e.inputBuffer.getChannelData(0));
          const resultPromise = this.api.feedAudio(samples).then(result => {
            if (result && this.isSessionCurrent(sessionGeneration)) this.handleASRResult(result);
          }).catch(error => this.addFeedbackItem(`实时识别失败：${error.message}`, 'filler'));
          this.pendingAudioFeeds.add(resultPromise);
          const systemActive = this.analyserIsActive(this.systemAudioAnalyser);
          this.updateMeetingActivityFromSamples(samples, { hasOutput: systemActive }).catch(error => {
            console.error('[MeetingActivity] 更新失败', error);
          });
          try { await resultPromise; }
          finally { this.pendingAudioFeeds.delete(resultPromise); }
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
        if (this.audioProcessor) this.audioProcessor.disconnect();
        if (this.audioContext) await this.audioContext.close();
        this.mediaStream?.getTracks().forEach(track => track.stop());
        this.systemAudioStream?.getTracks().forEach(track => track.stop());
        await this.api.stopNativeSystemAudio();
        await this.api.stopASR();
        this.showError(`麦克风访问失败: ${err.message}`);
        const settings = await this.getSettings();
        if (settings?.meeting?.autoDetectMeeting) await this.startActivityMonitor();
        this.isStartingRecording = false;
        return;
      }

      this.isRecording = true;
      this.isAutoRecording = Boolean(options.autoStarted);
      this.isStoppingRecording = false;
      this.isPaused = false;
      this.startTime = Date.now();
      this.session.startedAt = new Date(this.startTime).toISOString();
      this.session.endedAt = null;
      this.pendingAudioPath = '';
      this.speakerSegments = [];
      this.nativeSystemAudioQueue = [];
      this.nativeSystemAudioQueuedSamples = 0;
      this.lastNativeSystemAudioAt = 0;
      this.pauseStart = null;
      this.lastFeedbackText = '';
      this.transcriptEditor.readOnly = true;
      this.btnClear.disabled = true;
      this.pausedTime = 0;
      this.fullText = '';
      this.sentences = [];
      this.meetingSession = null;
      this.lastReport = '';
      this.lastMinutes = '';
      this.realtimePhraseBuffer = '';
      this.realtimePhraseLastAt = 0;
      this.resetStats();
      this.subtitleContainer.innerHTML = '';
      this.syncTranscriptEditor();
      this.reportBody.innerHTML = '<p class="empty-state">完成录制或粘贴原文后，可以在这里生成表达分析报告。</p>';
      this.minutesBody.innerHTML = '<p class="empty-state">完成录音或粘贴原文后，可以在这里生成正式会议纪要。</p>';
      this.btnCopyMinutes.classList.add('hidden');
      this.btnSaveMinutes.classList.add('hidden');
      this.btnGenerateMinutes.textContent = '生成纪要';

      // UI
      this.btnStart.classList.add('hidden');
      this.btnPause.classList.remove('hidden');
      this.btnStop.classList.remove('hidden');
      this.btnReport.classList.add('hidden');
      this.btnResume.classList.add('hidden');
      this.timer.classList.add('active');
      this.setSessionStatus(options.autoStarted ? '自动录制中' : '录制中');
      this.updateTextActionVisibility();

      this.timerInterval = setInterval(() => this.updateTimer(), 1000);
      await this.api.markMeetingRecordingStarted();
    } catch (error) {
      this.showError(`录音启动失败：${error.message}`);
    } finally {
      this.isStartingRecording = false;
      if (!this.isRecording) this.workspace.endCapture(this);
      this.workspace.render();
    }
  }

  pauseRecording() {
    this.isPaused = true;
    this.pauseStart = Date.now();
    this.btnPause.classList.add('hidden');
    this.btnResume.classList.remove('hidden');
    this.timer.classList.remove('active');
    this.setSessionStatus('已暂停');
  }

  resumeRecording() {
    this.isPaused = false;
    this.pausedTime += Date.now() - this.pauseStart;
    this.pauseStart = null;
    this.btnResume.classList.add('hidden');
    this.btnPause.classList.remove('hidden');
    this.timer.classList.add('active');
    this.setSessionStatus('录制中');
  }

  async stopRecording(options = {}) {
    if (!this.isRecording || this.isStoppingRecording) return;
    this.isStoppingRecording = true;
    this.workspace.render();
    try {
      const sessionGeneration = this.activeSessionGeneration;

      if (this.audioProcessor) { this.audioProcessor.disconnect(); this.audioProcessor = null; }
      if (this.audioContext) { this.audioContext.close(); this.audioContext = null; }
      if (this.mediaStream) { this.mediaStream.getTracks().forEach(t => t.stop()); this.mediaStream = null; }
      if (this.systemAudioStream) { this.systemAudioStream.getTracks().forEach(t => t.stop()); this.systemAudioStream = null; }
      this.systemAudioAnalyser = null;
      await this.api.stopNativeSystemAudio();
      this.nativeSystemAudioRunning = false;
      this.nativeSystemAudioQueue = [];
      this.nativeSystemAudioQueuedSamples = 0;
      await Promise.allSettled([...this.pendingAudioFeeds]);
      await this.flushRealtimePhraseBuffer();
      const stopResult = await this.api.stopASR();
      if (stopResult?.recordingPath) this.pendingAudioPath = stopResult.recordingPath;
      if (stopResult?.speakerSegments) this.speakerSegments = stopResult.speakerSegments;
      this.isRecording = false;
      this.session.endedAt = new Date().toISOString();
      this.transcriptEditor.readOnly = false;
      this.btnClear.disabled = false;
      this.isPaused = false;
      await this.api.markMeetingRecordingStopped();

      clearInterval(this.timerInterval);
      let totalPaused = this.pausedTime;
      if (this.pauseStart) totalPaused += Date.now() - this.pauseStart;
      const duration = Math.floor((Date.now() - this.startTime - totalPaused) / 1000);
      this.stats.duration = duration;

      if (stopResult?.finalTextError) {
        this.addFeedbackItem(stopResult.finalTextError, 'filler');
      }

      if (stopResult?.finalTextPending) {
        this.awaitingFinalTranscript = true;
        this.pendingFinalTranscriptGeneration = sessionGeneration;
        this.setSessionStatus('最终稿生成中');
        this.addFeedbackItem('Qwen3-ASR 正在后台生成最终稿', 'ai');
      }

      if (stopResult?.finalText && stopResult.finalTextSource === 'paraformer') {
        this.handleASRResult({ text: stopResult.finalText, isFinal: true });
        await this.flushRealtimePhraseBuffer();
      } else if (stopResult?.finalText) {
        this.transcriptSource = 'final';
        await this.loadTranscriptText(stopResult.finalText, { duration, requestFeedback: false, sessionGeneration });
        if (stopResult.finalTextSource === 'qwen3-asr') {
          this.addFeedbackItem('Qwen3-ASR 最终稿已生成', 'good');
          if (stopResult.speakerCount > 1) {
            this.addFeedbackItem(`已按音色区分 ${stopResult.speakerCount} 位说话人`, 'good');
          }
        }
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
        this.syncTranscriptEditor();
        if (!stopResult?.finalTextPending) {
          this.setSessionStatus('待确认');
          this.showReviewModal();
        }
      } else if (!this.awaitingFinalTranscript) {
        this.setSessionStatus('待开始');
      }

      this.workspace.endCapture(this);

      const settings = await this.getSettings();
      if (settings?.meeting?.autoDetectMeeting) {
        await this.startActivityMonitor();
      }
    } catch (error) {
      this.setSessionStatus('结束录音失败');
      this.addFeedbackItem(error.message, 'filler');
    } finally {
      this.isRecording = false;
      this.isStoppingRecording = false;
      clearInterval(this.timerInterval);
      this.transcriptEditor.readOnly = false;
      this.btnClear.disabled = false;
      this.workspace.endCapture(this);
    }
  }

  showReviewModal() {
    const durationText = `${this.stats.duration || 0}秒`;
    const wordText = `${this.stats.totalWords || this.fullText.length}字`;
    this.reviewSummary.textContent = `《${this.session.title}》 · ${new Date(this.session.startedAt || this.session.createdAt).toLocaleString('zh-CN')} · ID ${this.session.id.slice(0, 8)}：时长 ${durationText}，约 ${wordText}。保存的仅是这场会议的原文。`;
    this.reviewModal.classList.remove('hidden');
  }

  async confirmSaveTranscript() {
    const snapshot = createSaveSnapshot(this.session, this);
    const result = await this.saveMeetingTranscriptArtifact(snapshot);
    if (result?.success) this.reviewModal.classList.add('hidden');
  }

  async confirmSaveAndReport() {
    const generation = this.activeSessionGeneration;
    const snapshot = createSaveSnapshot(this.session, this);
    const settings = await this.getSettings();
    if (!settings?.meeting?.autoGenerateReport) {
      this.addFeedbackItem('设置未开启报告生成', 'filler');
      return;
    }
    const result = await this.saveMeetingTranscriptArtifact(snapshot);
    if (!result?.success || !this.isSessionCurrent(generation)) return;
    this.reviewModal.classList.add('hidden');
    await this.generateReport({ autoSave: true, snapshot, sessionDir: result.sessionDir });
  }

  discardCurrentRecording() {
    this.reviewModal.classList.add('hidden');
    this.awaitingFinalTranscript = false;
    this.clearAll();
    this.addFeedbackItem('录音已丢弃', 'filler');
  }

  // ===== ASR结果处理 =====

  normalizeRealtimeFragment(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  mergeRealtimeFragment(base, fragment) {
    if (!base) return fragment;
    if (!fragment) return base;

    const needsSpace = /[A-Za-z0-9]$/.test(base) && /^[A-Za-z0-9]/.test(fragment);
    return `${base}${needsSpace ? ' ' : ''}${fragment}`;
  }

  shouldFlushRealtimePhrase(text, gapMs) {
    if (!text) return false;
    if (/[。！？!?；;：:]$/.test(text)) return true;
    if (text.length >= 28) return true;
    return gapMs >= 2200 && text.length >= 12;
  }

  async flushRealtimePhraseBuffer() {
    const text = this.realtimePhraseBuffer.trim();
    if (!text) return;

    this.realtimePhraseBuffer = '';
    this.realtimePhraseLastAt = 0;
    this.sentences.push(text);
    this.fullText += `${this.fullText ? '\n' : ''}${text}`;
    this.transcriptRevision++;
    this.syncTranscriptEditor();
    this.updateTextActionVisibility();
    this.analyzeCurrentSentence(text);

    if (this.fullText.length - this.lastFeedbackText.length >= 30) {
      this.requestRealtimeFeedback();
    }

    this.renderSubtitle(text, true);
  }

  handleASRResult({ text, isFinal, asrMs, mode }) {
    if (asrMs != null && Date.now() - this.lastAsrPerfLogAt > 5000) {
      this.lastAsrPerfLogAt = Date.now();
      console.debug(`[ASR] mode=${mode || 'unknown'} chunkDecode=${asrMs}ms textLength=${text.length}`);
    }

    const fragment = this.normalizeRealtimeFragment(text);
    if (!fragment) return;

    if (isFinal) {
      const now = Date.now();
      const gapMs = this.realtimePhraseLastAt ? now - this.realtimePhraseLastAt : 0;
      this.realtimePhraseBuffer = this.mergeRealtimeFragment(this.realtimePhraseBuffer, fragment);
      this.realtimePhraseLastAt = now;

      if (this.shouldFlushRealtimePhrase(this.realtimePhraseBuffer, gapMs)) {
        this.flushRealtimePhraseBuffer();
      } else {
        this.renderSubtitle(this.realtimePhraseBuffer, false);
      }
      return;
    }

    const preview = this.mergeRealtimeFragment(this.realtimePhraseBuffer, fragment);
    this.renderSubtitle(preview, false);
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
    const stats = this.stats;
    const analysis = await this.api.analyzeText(text);
    if (this.stats !== stats) return;
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

  async loadTranscriptText(text, { duration = 0, requestFeedback = true, sessionGeneration = this.activeSessionGeneration } = {}) {
    if (!this.isSessionCurrent(sessionGeneration)) return false;
    this.subtitleContainer.innerHTML = '';
    this.fullText = text.trim();
    const revision = ++this.transcriptRevision;
    this.syncTranscriptEditor();
    this.sentences = this.splitTranscript(this.fullText);
    this.resetStats();

    for (const sentence of this.sentences) {
      const line = document.createElement('div');
      line.className = 'subtitle-line';
      line.innerHTML = this.highlightText(sentence);
      this.subtitleContainer.appendChild(line);

      const analysis = await this.api.analyzeText(sentence);
      if (!this.isSessionCurrent(sessionGeneration) || this.transcriptRevision !== revision) return false;
      if (analysis) {
        this.stats.fillers += analysis.fillers.length;
        this.stats.hedges += analysis.hedges.length;
        this.stats.vagueWords += analysis.vagueWords.length;
        this.stats.totalWords += analysis.totalWords;
      }
    }

    this.stats.duration = duration;
    this.updateStatsDisplay();
    this.syncTranscriptEditor();
    this.updateTextActionVisibility();
    this.setSessionStatus(this.fullText.trim() ? '已有原文' : '待开始');

    if (requestFeedback) {
      this.requestRealtimeFeedback();
    }
    return true;
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
    const generation = this.activeSessionGeneration;
    this.lastFeedbackText = this.fullText;
    const result = await this.api.getRealtimeFeedback(this.fullText);
    if (!this.isSessionCurrent(generation)) return;
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
    const generation = this.activeSessionGeneration;
    const snapshot = options.snapshot || createSaveSnapshot(this.session, this);
    if (!snapshot.transcript.trim()) {
      this.switchStage('transcript');
      this.transcriptEditor.focus();
      this.addFeedbackItem('先录制或粘贴原文，再生成报告', 'filler');
      return;
    }
    this.switchStage('report');
    this.setSessionStatus('生成报告中');
    this.btnCopyReport.classList.add('hidden');
    this.reportBody.textContent = '正在生成报告...';
    try {
      const result = await this.api.getFinalReport({ fullText: snapshot.transcript, stats: snapshot.stats });
      if (!result.success) throw new Error(result.error || '报告生成失败');
      if (options.autoSave) await this.saveMeetingReportArtifact(result.report, snapshot, options.sessionDir);
      if (!this.isSessionCurrent(generation)) return;
      this.lastReport = result.report;
      this.reportSnapshot = snapshot;
      this.renderReport(result.report);
      this.setSessionStatus('报告已生成');
    } catch (error) {
      if (!this.isSessionCurrent(generation)) return;
      this.reportBody.textContent = `生成失败：${error.message}`;
      this.setSessionStatus('报告生成失败');
    }
  }

  async generateMinutes() {
    const generation = this.activeSessionGeneration;
    const snapshot = createSaveSnapshot(this.session, this);
    if (!snapshot.transcript.trim()) {
      this.switchStage('transcript');
      this.transcriptEditor.focus();
      return;
    }
    this.switchStage('minutes');
    this.setSessionStatus('生成纪要中');
    this.minutesBody.textContent = '正在整理会议纪要...';
    this.btnGenerateMinutes.disabled = true;
    const sessionDir = this.meetingSession?.sessionDir;
    try {
      const result = await this.api.getMeetingMinutes({ fullText: snapshot.transcript, stats: snapshot.stats });
      if (!result.success || !result.minutes) throw new Error(result.error || '纪要生成失败');
      if (sessionDir) await this.saveMeetingMinutesArtifact(result.minutes, snapshot, sessionDir);
      if (!this.isSessionCurrent(generation)) return;
      this.lastMinutes = result.minutes;
      this.minutesSnapshot = snapshot;
      this.renderMinutes(result.minutes);
      this.btnGenerateMinutes.textContent = '重新生成';
      this.setSessionStatus('纪要已生成');
    } catch (error) {
      if (!this.isSessionCurrent(generation)) return;
      this.minutesBody.textContent = `生成失败：${error.message}`;
      this.setSessionStatus('纪要生成失败');
    } finally {
      this.btnGenerateMinutes.disabled = false;
    }
  }

  renderMarkdown(markdown) {
    return String(markdown || '')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/\n/g, '<br>');
  }

  renderMinutes(minutes) {
    this.minutesBody.innerHTML = this.renderSnapshotLabel(this.minutesSnapshot) + this.renderMarkdown(minutes);
    this.btnCopyMinutes.classList.remove('hidden');
    this.btnSaveMinutes.classList.remove('hidden');
  }

  async saveMinutes() {
    if (!this.lastMinutes) return;
    const snapshot = this.minutesSnapshot || createSaveSnapshot(this.session, this);
    await this.exportSnapshot(snapshot, '会议纪要', this.lastMinutes);
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
        <button id="btn-save-report" class="btn-primary">保存为 Markdown</button>
      </div>
      ${this.renderSnapshotLabel(this.reportSnapshot)}${html}
    `;
    this.btnCopyReport.classList.remove('hidden');

    this.root.getElementById('btn-save-report').addEventListener('click', () => this.saveReport());
  }

  async saveReport() {
    if (!this.lastReport) return;
    const snapshot = this.reportSnapshot || createSaveSnapshot(this.session, this);
    await this.exportSnapshot(snapshot, '表达报告', `## 原始对话\n\n${snapshot.transcript}\n\n---\n\n${this.lastReport}`);
  }

  renderSnapshotLabel(snapshot) {
    if (!snapshot) return '';
    return `<p class="analysis-note">《${this.escapeHtml(snapshot.title)}》 · ${this.escapeHtml(new Date(snapshot.startedAt).toLocaleString('zh-CN'))} · 原文版本 ${snapshot.transcriptRevision}</p>`;
  }

  async saveMeetingTranscriptArtifact(snapshot = createSaveSnapshot(this.session, this)) {
    if (this.savePromise) return this.savePromise;
    const generation = this.activeSessionGeneration;
    const pending = this.persistTranscriptSnapshot(snapshot);
    this.savePromise = pending;
    this.workspace.render();
    try {
      const result = await pending;
      if (result?.success && this.isSessionCurrent(generation)) {
        this.meetingSession = result;
        this.savedSnapshot = snapshot;
        this.savedPath = result.transcriptPath;
        this.addFeedbackItem(`《${snapshot.title}》原文已保存：${result.transcriptPath}`, 'good');
        if (result.audioPath && result.audioAnalysis) {
          this.setAudioFile({ filePath: result.audioPath, fileUrl: result.audioUrl, name: `${snapshot.title} · 录音` });
          this.renderAudioAnalysis(result.audioAnalysis);
        }
      }
      return result;
    } catch (error) {
      this.addFeedbackItem(`《${snapshot.title}》保存失败：${error.message}`, 'filler');
      return { success: false, error: error.message };
    } finally {
      this.savePromise = null;
      this.workspace.render();
    }
  }

  async persistTranscriptSnapshot(snapshot) {
    const settings = await this.getSettings();
    if (!settings?.meeting?.autoSaveArtifacts) throw new Error('设置未开启保存原文');
    if (!snapshot.transcript.trim()) throw new Error('这场会议没有可保存的原文');
    const analysis = await this.api.analyzeText(snapshot.transcript);
    if (analysis) snapshot.stats = { ...snapshot.stats, fillers: analysis.fillers.length,
      hedges: analysis.hedges.length, vagueWords: analysis.vagueWords.length, totalWords: analysis.totalWords };
    const result = await this.api.saveMeetingTranscript(snapshot);
    if (!result.success) throw new Error(result.error || '保存原文失败');
    return result;
  }

  async refreshSavedArtifactFromFinal(sessionGeneration) {
    if (this.finalArtifactRefreshPromise) return this.finalArtifactRefreshPromise;

    const refresh = (async () => {
      if (this.savePromise) await this.savePromise;
      if (!this.isSessionCurrent(sessionGeneration) || this.editorModified || this.transcriptSource !== 'final') return null;
      if (this.savedSnapshot?.transcriptSource !== 'realtime' || !this.meetingSession?.sessionDir) return null;

      const snapshot = createSaveSnapshot(this.session, this);
      const result = await this.saveMeetingTranscriptArtifact(snapshot);
      if (result?.success && this.isSessionCurrent(sessionGeneration)) {
        this.addFeedbackItem('最终稿及说话人分离结果已更新到原会议记录', 'good');
      }
      return result;
    })();

    this.finalArtifactRefreshPromise = refresh;
    try {
      return await refresh;
    } finally {
      if (this.finalArtifactRefreshPromise === refresh) this.finalArtifactRefreshPromise = null;
    }
  }

  async saveMeetingReportArtifact(report, snapshot, sessionDir) {
    if (!sessionDir) return;
    const result = await this.api.saveMeetingReport({ ...snapshot, sessionDir, report });
    if (!result.success) throw new Error(result.error || '保存报告失败');
    this.addFeedbackItem(`《${snapshot.title}》报告已保存：${result.reportPath}`, 'good');
  }

  async saveMeetingMinutesArtifact(minutes, snapshot, sessionDir) {
    if (!sessionDir) return;
    const settings = await this.getSettings();
    if (!settings?.meeting?.autoSaveArtifacts) return;
    const result = await this.api.saveMeetingMinutes({ ...snapshot, sessionDir, minutes });
    if (!result.success) throw new Error(result.error || '保存纪要失败');
    this.addFeedbackItem(`《${snapshot.title}》纪要已保存：${result.minutesPath}`, 'good');
  }

  async exportSnapshot(snapshot, kind, body) {
    const time = new Date(snapshot.startedAt).toLocaleString('zh-CN', { hour12: false });
    const source = { final: '最终稿', edited: '编辑稿', realtime: '实时稿', pasted: '粘贴原文' }[snapshot.transcriptSource] || snapshot.transcriptSource;
    const header = `# ${kind} · ${snapshot.title}\n\n**会议 ID**: ${snapshot.sessionId}\n**开始时间**: ${time}\n**结束时间**: ${snapshot.endedAt ? new Date(snapshot.endedAt).toLocaleString('zh-CN') : '未结束'}\n**原文版本**: ${snapshot.transcriptRevision}（${source}）\n\n---\n\n`;
    const cleanTitle = snapshot.title.replace(/[<>:"/\\\\|?*\x00-\x1f]/g, '_').slice(0, 60);
    const filename = `${cleanTitle}-${time.replace(/[^0-9]/g, '')}-${snapshot.sessionId.slice(0, 8)}-${kind}.md`;
    try {
      const result = await this.api.saveFile(header + body, filename, { title: `保存《${snapshot.title}》${kind}` });
      if (result.success) {
        if (kind === '会议原文') {
          this.savedSnapshot = snapshot;
          this.savedPath = result.path;
        }
        this.addFeedbackItem(`《${snapshot.title}》${kind}已保存：${result.path}`, 'good');
        this.workspace.render();
      }
    } catch (error) {
      this.addFeedbackItem(`《${snapshot.title}》保存失败：${error.message}`, 'filler');
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
    this.workspace.render();
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
    const text = this.fullText.trim() ? this.fullText : this.transcriptEditor.value.trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.btnCopyText.textContent = '✓ 已复制';
      setTimeout(() => { this.btnCopyText.textContent = '复制'; }, 1500);
    });
  }

  async saveOriginalText() {
    const snapshot = createSaveSnapshot(this.session, this);
    if (!snapshot.transcript.trim()) return;
    await this.exportSnapshot(snapshot, '会议原文', snapshot.transcript);
  }

  clearAll() {
    if (this.isRecording || this.isStoppingRecording && !this.session.endedAt) return;
    this.activeSessionGeneration = ++this.sessionGeneration;
    this.awaitingFinalTranscript = false;
    this.pendingFinalTranscriptGeneration = 0;
    this.transcriptRevision++;
    this.finalCandidate = null;
    this.editorModified = false;
    this.root.getElementById('btn-adopt-final').classList.add('hidden');
    this.fullText = '';
    this.sentences = [];
    this.lastReport = '';
    this.lastMinutes = '';
    this.meetingSession = null;
    this.savedSnapshot = null;
    this.savedPath = '';
    this.pendingAudioPath = '';
    this.speakerSegments = [];
    this.realtimePhraseBuffer = '';
    this.realtimePhraseLastAt = 0;
    this.subtitleContainer.innerHTML = '<div class="subtitle-line hint">点击下方按钮开始说话</div>';
    this.transcriptEditor.value = '';
    this.reportBody.innerHTML = '<p class="empty-state">完成录制或粘贴原文后，可以在这里生成表达分析报告。</p>';
    this.minutesBody.innerHTML = '<p class="empty-state">完成录音或粘贴原文后，可以在这里生成正式会议纪要。</p>';
    this.btnCopyMinutes.classList.add('hidden');
    this.btnSaveMinutes.classList.add('hidden');
    this.btnGenerateMinutes.textContent = '生成纪要';
    this.feedbackContent.innerHTML = '';
    this.resetStats();
    this.timer.textContent = '00:00';
    this.timer.classList.remove('active');
    this.btnReport.classList.add('hidden');
    this.btnCopyReport.classList.add('hidden');
    this.btnCopyText.classList.add('hidden');
    this.btnSaveText.classList.add('hidden');
    this.btnClear.classList.add('hidden');
    this.reviewModal.classList.add('hidden');
    this.setSessionStatus('待开始');
  }

  // ===== 粘贴逐字稿分析 =====

  openPasteModal() {
    this.switchStage('transcript');
    if (!this.transcriptEditor.value && this.fullText.trim()) {
      this.syncTranscriptEditor();
    }
    this.transcriptEditor.focus();
  }

  async analyzePastedText() {
    const text = this.transcriptEditor.value.trim() || this.pasteTextarea.value.trim();
    if (!text) return;

    await this.loadTranscriptText(text, { duration: 0, requestFeedback: false });

    // 显示操作按钮
    this.btnReport.classList.remove('hidden');
    this.btnCopyText.classList.remove('hidden');
    this.btnSaveText.classList.remove('hidden');
    this.btnClear.classList.remove('hidden');

    // 请求AI语境化反馈
    this.requestRealtimeFeedback();
    this.switchStage('optimize');
  }

  async polishTranscript() {
    const generation = this.activeSessionGeneration;
    const text = (this.transcriptEditor.value || this.fullText || '').trim();
    if (!text) {
      this.workspace.notice('请先录制或粘贴会议原文，再执行错字修正。');
      this.transcriptEditor.focus();
      return;
    }
    this.btnPolishTranscript.disabled = true;
    const label = this.btnPolishTranscript.textContent;
    this.btnPolishTranscript.textContent = '修正中…';
    try {
      const result = await this.api.polishTranscript({ fullText: text });
      if (!result.success || !result.text) throw new Error(result.error || '错字修正失败');
      if (!this.isSessionCurrent(generation)) return;
      this.transcriptEditor.value = result.text;
      this.handleTranscriptEditorInput();
      this.workspace.notice('错字修正完成，请审阅后点“保存”入库。');
      this.setSessionStatus('已修正，待审阅');
    } catch (error) {
      if (this.isSessionCurrent(generation)) {
        this.workspace.notice(`错字修正失败：${error.message}`);
      }
    } finally {
      if (this.isSessionCurrent(generation)) {
        this.btnPolishTranscript.disabled = false;
        this.btnPolishTranscript.textContent = label;
      }
    }
  }
}
