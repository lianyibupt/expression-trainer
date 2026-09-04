class MeetingWorkspace {
  constructor() {
    this.sessions = new MeetingSessions();
    this.hosts = document.getElementById('session-hosts');
    this.template = document.getElementById('session-template');
    this.monitorApp = null;
    this.monitorStarting = null;
    this.create();
  }

  create() {
    const session = this.sessions.create();
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    root.appendChild(this.template.content.cloneNode(true));
    this.hosts.appendChild(host);
    session.host = host;
    session.root = root;
    session.trainer = new ExpressionTrainer({ root, session, workspace: this,
      api: createSessionAPI(window.api, session.id) });
    root.getElementById('btn-new-session').addEventListener('click', () => this.create());
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
    if (this.sessions.recordingId || this.monitorStarting || this.monitorApp?.activityMonitor) return;
    this.monitorApp = trainer;
    this.monitorStarting = trainer.startActivityMonitor({ claimed: true });
    try { await this.monitorStarting; }
    finally { this.monitorStarting = null; }
  }

  render() {
    const all = [...this.sessions.items.values()];
    const recording = this.sessions.get(this.sessions.recordingId);
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
        root.getElementById('btn-start').disabled = Boolean(recording && recording !== session);
      }
      root.getElementById('recording-banner').classList.toggle('hidden', !recording);
      root.getElementById('recording-banner-text').textContent = recording ? `正在录制《${recording.title}》 · ${recording.trainer?.timer.textContent || '00:00'}${recording.trainer?.isPaused ? '（已暂停）' : ''}` : '';
      root.getElementById('btn-stop-recording').disabled = Boolean(recording?.trainer?.isStartingRecording || recording?.trainer?.isStoppingRecording);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => { window.meetingWorkspace = new MeetingWorkspace(); });
