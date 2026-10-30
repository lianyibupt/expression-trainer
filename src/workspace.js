class MeetingWorkspace {
  constructor() {
    this.sessions = new MeetingSessions();
    this.hosts = document.getElementById('session-hosts');
    this.template = document.getElementById('session-template');
    this.monitorApp = null;
    this.monitorStarting = null;
    this.audioSourceSelection = null;
    this.exitModal = document.getElementById('exit-modal');
    this.exitSummary = document.getElementById('exit-summary');
    this.exitProgress = document.getElementById('exit-progress');
    this.exitError = document.getElementById('exit-error');
    this.exitFallbackActions = document.getElementById('exit-fallback-actions');
    this.btnExitSave = document.getElementById('btn-exit-save');
    this.btnExitCancel = document.getElementById('btn-exit-cancel');
    this.btnExitDiscard = document.getElementById('btn-exit-discard');
    this.exitState = 'idle';
    this.exitPending = [];
    this.exitProgressById = new Map();
    this.exitIndex = 0;
    this.exitFailure = null;
    this.exitControls = new Map();
    this.bindExitEvents();
    this.history = new MeetingHistoryPanel(this);
    this.create();
  }

  bindExitEvents() {
    window.api.onAppExitRequested(() => this.handleAppExitRequest());
    this.btnExitSave.addEventListener('click', () => this.saveAllAndExit());
    this.btnExitCancel.addEventListener('click', () => this.cancelExit());
    this.btnExitDiscard.addEventListener('click', () => this.confirmDiscardAndExit());
    document.getElementById('btn-exit-retry-final').addEventListener('click', () => this.retryFailedFinalTranscript());
    document.getElementById('btn-exit-save-realtime').addEventListener('click', () => this.acceptFailedRealtimeTranscript());
    this.exitModal.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.exitState !== 'saving') {
        event.preventDefault();
        this.cancelExit();
      }
    });
  }

  create({ record } = {}) {
    const session = this.sessions.create(record?.sessionId);
    if (record) Object.assign(session, { title: record.title, titleSource: record.titleSource, startedAt: record.startedAt,
      endedAt: record.endedAt, archiveId: record.archiveId, restored: true });
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    root.appendChild(this.template.content.cloneNode(true));
    this.hosts.appendChild(host);
    session.host = host;
    session.root = root;
    session.trainer = new ExpressionTrainer({ root, session, workspace: this,
      api: createSessionAPI(window.api, session.id) });
    root.getElementById('btn-new-session').addEventListener('click', () => this.create());
    root.getElementById('btn-history').addEventListener('click', () => this.history.show());
    root.getElementById('meeting-tabs').addEventListener('click', event => {
      const button = event.target.closest('button[data-session]');
      if (!button) return;
      if (button.dataset.action === 'close') this.close(button.dataset.session);
      else this.select(button.dataset.session, true);
    });
    root.getElementById('meeting-tabs').addEventListener('keydown', event => {
      const tab = event.target.closest('[role="tab"]');
      if (!tab) return;
      const open = [...this.sessions.items.values()].filter(item => item.open);
      const index = open.findIndex(item => item.id === tab.dataset.session);
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % open.length;
      if (event.key === 'ArrowLeft') next = (index + open.length - 1) % open.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = open.length - 1;
      if (next != null) { event.preventDefault(); this.select(open[next].id, true); }
      if (event.key === 'Delete') { event.preventDefault(); this.close(tab.dataset.session); }
    });
    root.getElementById('recent-sessions').addEventListener('change', event => {
      if (event.target.value) this.select(event.target.value);
    });
    root.getElementById('meeting-title').addEventListener('change', event => {
      session.title = event.target.value.trim() || session.title;
      session.titleSource = 'manual';
      this.render();
    });
    root.getElementById('btn-view-recording').addEventListener('click', () => {
      if (this.sessions.recordingId) this.select(this.sessions.recordingId);
    });
    root.getElementById('btn-stop-recording').addEventListener('click', () => {
      this.sessions.get(this.sessions.recordingId)?.trainer.stopRecording();
    });
    this.render();
    return session.trainer;
  }

  async openArchivedMeeting(record) {
    if (this.exitState !== 'idle') return;
    const existing = this.sessions.get(record.sessionId);
    if (existing) {
      this.select(existing.id);
      this.notice('这场会议已在工作区中打开，已保留当前内容。');
      return;
    }
    const trainer = this.create({ record });
    await trainer.restoreArchive(record);
    this.render();
  }

  select(id, focus = false) {
    if (!this.sessions.select(id)) return;
    this.render();
    const session = this.sessions.get(id);
    session.trainer.drawAudioWaveform();
    if (focus) session.root.querySelector(`[role="tab"][data-session="${id}"]`).focus();
  }

  close(id) {
    const session = this.sessions.get(id);
    if (!session || !this.sessions.close(id)) {
      this.notice('请先结束这场会议的录音，再关闭标签。');
      return;
    }
    session.trainer.audioPlayer.pause();
    if (!this.sessions.activeId) this.create();
    this.render();
    this.notice(`已关闭《${session.title}》，可从“最近关闭”重新打开；未保存内容仅保留到本次应用退出。`);
  }

  notice(text) {
    const current = this.sessions.get(this.sessions.activeId);
    if (current) current.root.getElementById('session-notice').textContent = text;
  }

  ownsAudio(trainer) {
    return this.sessions.recordingId ? this.sessions.recordingId === trainer.session.id : this.monitorApp === trainer;
  }

  async beginCapture(trainer) {
    if (this.exitState !== 'idle') return false;
    if (!this.sessions.claimRecording(trainer.session.id)) {
      this.notice('已有会议正在录音，请先结束当前录音。');
      return false;
    }
    this.render();
    try {
      if (this.monitorStarting) await this.monitorStarting;
      if (this.monitorApp) await this.monitorApp.stopActivityMonitor();
      this.monitorApp = null;
      return true;
    } catch (error) {
      this.endCapture(trainer);
      throw error;
    }
  }

  endCapture(trainer) {
    this.sessions.releaseRecording(trainer.session.id);
    this.render();
  }

  async startMonitor(trainer) {
    if (this.exitState !== 'idle') return;
    if (this.sessions.recordingId || this.monitorStarting || this.monitorApp?.activityMonitor) return;
    this.monitorApp = trainer;
    this.monitorStarting = trainer.startActivityMonitor({ claimed: true });
    try { await this.monitorStarting; }
    finally { this.monitorStarting = null; }
  }

  async handleAppExitRequest() {
    if (this.exitState !== 'idle') return;
    this.history?.hide();
    const pending = collectPendingMeetings([...this.sessions.items.values()]);
    if (!pending.length) {
      this.exitState = 'approved';
      await window.api.approveAppExit();
      return;
    }

    this.exitPending = pending;
    this.exitIndex = 0;
    this.exitFailure = null;
    this.exitState = 'confirming';
    this.exitProgressById = new Map(pending.map(item => [item.id, {
      state: 'pending',
      label: this.describeInitialExitWork(item)
    }]));
    this.setExitLocked(true);
    this.resetExitActions();
    this.renderExitModal();
    this.exitModal.classList.remove('hidden');
    queueMicrotask(() => this.btnExitSave.focus());
  }

  describeInitialExitWork(item) {
    if (item.reason === 'recording') return '待结束录音并等待最终稿';
    if (item.reason === 'finalizing') return '等待最终稿';
    if (item.reason === 'saving') return '等待现有保存完成';
    if (item.reason === 'generating') return '等待已有报告或纪要生成完成';
    const names = { transcript: '原文/录音', minutes: '纪要', report: '报告' };
    const artifacts = item.artifacts.map(name => names[name] || name).join('、');
    return artifacts ? `待保存：${artifacts}` : '待保存';
  }

  renderExitModal() {
    const savedCount = [...this.exitProgressById.values()].filter(item => item.state === 'saved').length;
    this.exitSummary.textContent = this.exitState === 'discard-confirm'
      ? '这会永久放弃下列会议尚未保存的内容。应用退出后无法恢复。'
      : `共 ${this.exitPending.length} 场会议需要处理；已保存 ${savedCount} 场。应用只会保存已有内容，不会生成新的纪要或报告。`;
    this.exitProgress.innerHTML = this.exitPending.map(item => {
      const progress = this.exitProgressById.get(item.id) || { state: 'pending', label: '待处理' };
      return `<li class="exit-progress-row is-${progress.state}" data-exit-session="${item.id}"><span class="exit-meeting-title">${this.escapeHtml(item.title)}</span><span class="exit-progress-label">${this.escapeHtml(progress.label)}</span></li>`;
    }).join('');
  }

  resetExitActions() {
    this.exitError.classList.add('hidden');
    this.exitError.textContent = '';
    this.exitFallbackActions.classList.add('hidden');
    this.btnExitSave.textContent = '保存全部并退出';
    this.btnExitSave.disabled = false;
    this.btnExitCancel.disabled = false;
    this.btnExitDiscard.disabled = false;
    this.btnExitDiscard.textContent = '放弃未保存内容并退出';
  }

  async saveAllAndExit() {
    if (this.exitState === 'saving' || this.exitState === 'approved' || this.exitState === 'discard-confirm') return;
    this.exitState = 'saving';
    this.exitFailure = null;
    this.exitError.classList.add('hidden');
    this.exitFallbackActions.classList.add('hidden');
    this.btnExitSave.disabled = true;
    this.btnExitCancel.disabled = true;
    this.btnExitDiscard.disabled = true;

    for (; this.exitIndex < this.exitPending.length; this.exitIndex += 1) {
      const item = this.exitPending[this.exitIndex];
      const session = this.sessions.get(item.id);
      const trainer = session?.trainer;
      if (!trainer) {
        this.showExitFailure(session || item, { success: false, stage: 'saving', error: '会议实例不存在' });
        return;
      }

      const currentState = trainer.isRecording || trainer.isStoppingRecording
        ? '正在结束录音并等待最终稿'
        : trainer.awaitingFinalTranscript ? '等待最终稿' : '正在保存';
      this.exitProgressById.set(item.id, { state: 'working', label: currentState });
      this.renderExitModal();

      let result;
      try {
        result = await trainer.prepareForExit();
      } catch (error) {
        result = { success: false, stage: 'saving', error: error.message };
      }
      if (!result?.success) {
        this.showExitFailure(session, result || { stage: 'saving', error: '未知错误' });
        return;
      }

      this.exitProgressById.set(item.id, { state: 'saved', label: '已保存' });
      this.renderExitModal();
    }

    if (this.exitState !== 'saving') return;
    this.exitState = 'approved';
    this.btnExitSave.textContent = '已保存，正在退出…';
    await window.api.approveAppExit();
  }

  showExitFailure(session, result) {
    this.exitState = 'failed';
    this.exitFailure = { sessionId: session.id, result };
    const finalFailure = result.stage === 'final-transcript';
    this.exitProgressById.set(session.id, {
      state: 'failed',
      label: finalFailure ? '最终稿失败' : result.stage === 'stopping' ? '结束录音失败' : '保存失败'
    });
    this.renderExitModal();
    this.exitError.textContent = `《${session.title}》处理失败：${result.error || '未知错误'}。应用仍保持打开。`;
    this.exitError.classList.remove('hidden');
    this.exitFallbackActions.classList.toggle('hidden', !finalFailure);
    document.getElementById('btn-exit-save-realtime').disabled = !result.canSaveRealtime;
    this.btnExitSave.textContent = finalFailure ? '等待选择最终稿处理方式' : '重试保存';
    this.btnExitSave.disabled = finalFailure;
    this.btnExitCancel.disabled = false;
    this.btnExitDiscard.disabled = false;
  }

  async retryFailedFinalTranscript() {
    if (this.exitState !== 'failed' || this.exitFailure?.result.stage !== 'final-transcript') return;
    const session = this.sessions.get(this.exitFailure.sessionId);
    this.exitState = 'saving';
    this.exitError.classList.add('hidden');
    this.exitFallbackActions.classList.add('hidden');
    this.btnExitCancel.disabled = true;
    this.btnExitDiscard.disabled = true;
    this.exitProgressById.set(session.id, { state: 'working', label: '正在重试最终稿' });
    this.renderExitModal();
    const result = await session.trainer.retryFinalTranscript();
    if (!result.success) {
      this.showExitFailure(session, { stage: 'final-transcript', ...result });
      return;
    }
    this.exitState = 'failed';
    this.exitFailure = null;
    await this.saveAllAndExit();
  }

  async acceptFailedRealtimeTranscript() {
    if (this.exitState !== 'failed' || this.exitFailure?.result.stage !== 'final-transcript') return;
    const session = this.sessions.get(this.exitFailure.sessionId);
    const result = session.trainer.acceptRealtimeTranscriptForExit();
    if (!result.success) {
      this.showExitFailure(session, { stage: 'final-transcript', ...result });
      return;
    }
    this.exitFailure = null;
    await this.saveAllAndExit();
  }

  async cancelExit() {
    if (this.exitState === 'saving' || this.exitState === 'approved') return;
    this.exitState = 'idle';
    this.exitPending = [];
    this.exitProgressById.clear();
    this.exitIndex = 0;
    this.exitFailure = null;
    this.exitModal.classList.add('hidden');
    this.setExitLocked(false);
    this.resetExitActions();
    await window.api.cancelAppExit();
  }

  async confirmDiscardAndExit() {
    if (this.exitState === 'saving' || this.exitState === 'approved') return;
    if (this.exitState !== 'discard-confirm') {
      this.exitState = 'discard-confirm';
      this.exitError.textContent = '确认后将不再尝试保存。请仅在你明确接受数据丢失时继续。';
      this.exitError.classList.remove('hidden');
      this.exitFallbackActions.classList.add('hidden');
      this.btnExitSave.disabled = true;
      this.btnExitDiscard.textContent = '确认放弃并退出';
      this.renderExitModal();
      this.btnExitDiscard.focus();
      return;
    }
    this.exitState = 'approved';
    this.btnExitDiscard.disabled = true;
    await window.api.forceAppExit();
  }

  setExitLocked(locked) {
    const selector = [
      '#btn-new-session', '#btn-start', '#btn-paste', '#btn-pause', '#btn-resume', '#btn-stop',
      '#btn-stop-recording', '#btn-report', '#btn-generate-minutes', '#btn-audio-select',
      '#btn-audio-analyze', '#btn-audio-transcribe', '#btn-clear', '#btn-polish-transcript',
      '#btn-punctuate-transcript', '#meeting-title', '#transcript-editor', '#btn-history',
      '#btn-microphone-source', '#btn-system-source', '#btn-review-save', '#btn-review-report', '#btn-review-discard'
    ].join(',');
    if (locked) {
      for (const session of this.sessions.items.values()) {
        if (!session.root) continue;
        session.host.inert = true;
        for (const control of session.root.querySelectorAll(selector)) {
          if (!this.exitControls.has(control)) this.exitControls.set(control, control.disabled);
          control.disabled = true;
        }
      }
      return;
    }
    for (const [control, wasDisabled] of this.exitControls) control.disabled = wasDisabled;
    for (const session of this.sessions.items.values()) if (session.host) session.host.inert = false;
    this.exitControls.clear();
    this.render();
  }

  escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  render() {
    const all = [...this.sessions.items.values()];
    const recording = this.sessions.get(this.sessions.recordingId);
    const exitLocked = this.exitState !== 'idle';
    for (const session of all) {
      if (!session.root) continue;
      const { root, trainer } = session;
      const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
      session.host.hidden = session.id !== this.sessions.activeId;
      const tabs = all.filter(item => item.open).map(item => {
        const selected = item.id === this.sessions.activeId;
        const capturing = item.id === this.sessions.recordingId;
        const status = capturing ? (item.trainer?.isStoppingRecording ? '结束中' : item.trainer?.isStartingRecording ? '启动中' : item.trainer?.isPaused ? '已暂停' : '录音中') : item.status;
        const time = new Date(item.startedAt || item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        return `<div class="meeting-tab ${selected ? 'selected' : ''}"><button role="tab" aria-selected="${selected}" tabindex="${selected ? '0' : '-1'}" data-session="${item.id}" title="${escape(item.title)} · ${time}">${escape(item.title)} · ${time}<small>${escape(status)}</small></button><button class="tab-close" data-session="${item.id}" data-action="close" aria-label="关闭 ${escape(item.title)}" title="${capturing ? '请先结束录音' : '关闭标签，不删除内容'}" ${capturing ? 'disabled' : ''}>×</button></div>`;
      }).join('');
      if (session.tabMarkup !== tabs) {
        root.getElementById('meeting-tabs').innerHTML = tabs;
        session.tabMarkup = tabs;
      }
      const recent = '<option value="">最近关闭</option>' + all.filter(item => !item.open).map(item => `<option value="${item.id}">${escape(item.title)} · ${new Date(item.startedAt || item.createdAt).toLocaleString('zh-CN')} · ${escape(item.status)} · ${item.id.slice(0, 8)}</option>`).join('');
      if (session.recentMarkup !== recent) {
        root.getElementById('recent-sessions').innerHTML = recent;
        session.recentMarkup = recent;
      }
      const name = root.getElementById('meeting-title');
      if (root.activeElement !== name) name.value = session.title;
      const start = new Date(session.startedAt || session.createdAt).toLocaleString('zh-CN', { hour12: false });
      const source = { final: '最终稿', edited: '编辑稿', realtime: '实时稿', pasted: '粘贴原文' }[trainer?.transcriptSource] || '实时稿';
      root.getElementById('meeting-identity').textContent = `${session.startedAt ? '开始' : '创建'}：${start} · ID ${session.id.slice(0, 8)} · 原文版本 ${trainer?.transcriptRevision || 0}（${source}）`;
      if (trainer) {
        const saved = trainer.savedSnapshot;
        const changed = saved && (saved.transcriptRevision !== trainer.transcriptRevision || saved.title !== session.title);
        root.getElementById('meeting-save-status').textContent = trainer.savePromise ? '正在保存本场会议…' : saved ? `${changed ? '有未保存修改' : '已保存'}：${trainer.savedPath || trainer.meetingSession?.sessionDir || ''}` : '未保存';
        root.getElementById('btn-save-text').textContent = `保存《${session.title}》原文`;
        root.getElementById('btn-review-save').textContent = `保存《${session.title}》原文`;
        root.getElementById('btn-start').disabled = exitLocked || Boolean(recording && recording !== session);
      }
      root.getElementById('recording-banner').classList.toggle('hidden', !recording);
      root.getElementById('recording-banner-text').textContent = recording ? `正在录制《${recording.title}》 · ${recording.trainer?.timer.textContent || '00:00'}${recording.trainer?.isPaused ? '（已暂停）' : ''}` : '';
      root.getElementById('btn-stop-recording').disabled = exitLocked || Boolean(recording?.trainer?.isStartingRecording || recording?.trainer?.isStoppingRecording);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => { window.meetingWorkspace = new MeetingWorkspace(); });
