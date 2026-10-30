class MeetingHistoryPanel {
  constructor(workspace) {
    this.workspace = workspace;
    this.modal = document.getElementById('history-modal');
    this.list = document.getElementById('history-list');
    this.status = document.getElementById('history-status');
    this.search = document.getElementById('history-search');
    this.more = document.getElementById('btn-history-more');
    this.rows = [];
    this.request = 0;
    document.getElementById('btn-history-close').addEventListener('click', () => this.hide());
    document.getElementById('history-search-form').addEventListener('submit', event => {
      event.preventDefault(); this.load();
    });
    this.more.addEventListener('click', () => this.load(true));
    this.modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); this.hide(); }
    });
  }

  async show() {
    if (this.workspace.exitState !== 'idle') return;
    this.modal.classList.remove('hidden');
    this.search.focus();
    await this.load();
  }

  hide() {
    this.modal.classList.add('hidden');
    this.workspace.sessions.get(this.workspace.sessions.activeId)?.root.getElementById('btn-history').focus();
  }

  async load(append = false) {
    const request = ++this.request;
    if (!append) this.rows = [];
    this.status.textContent = '正在读取会议归档…';
    this.more.disabled = true;
    try {
      const result = await window.api.listMeetingHistory({ query: this.search.value, offset: this.rows.length, limit: 50 });
      if (request !== this.request) return;
      if (!result.success) throw new Error(result.error || '读取历史会议失败');
      this.rows.push(...result.meetings);
      document.getElementById('history-directory').textContent = `保存目录：${result.rootDir}`;
      this.list.replaceChildren(...this.rows.map(row => this.renderRow(row)));
      this.status.textContent = this.rows.length ? `已显示 ${this.rows.length} 场会议` : '暂无匹配的已保存会议。保存会议后可在这里重新打开。';
      this.more.classList.toggle('hidden', result.meetings.length < 50);
    } catch (error) {
      if (request === this.request) this.status.textContent = `读取失败：${error.message}`;
    } finally {
      if (request === this.request) this.more.disabled = false;
    }
  }

  renderRow(row) {
    const item = document.createElement('article'); item.className = 'history-item';
    const title = document.createElement('h3'); title.textContent = row.title;
    const detail = document.createElement('p');
    const artifacts = [row.hasTranscript && '原文', row.hasMinutes && '纪要', row.hasReport && '报告', row.hasAudio && '录音'].filter(Boolean).join(' / ');
    detail.textContent = `${new Date(row.startedAt).toLocaleString('zh-CN')} · ${artifacts || '会议记录'}`;
    const button = document.createElement('button'); button.className = 'btn-secondary'; button.textContent = '打开会议';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const result = await window.api.readMeetingHistory(row.archiveId);
        if (!result.success) throw new Error(result.error || '读取会议失败');
        await this.workspace.openArchivedMeeting(result.meeting);
        this.hide();
      } catch (error) { this.status.textContent = `打开失败：${error.message}`; }
      finally { button.disabled = false; }
    });
    item.append(title, detail, button);
    return item;
  }
}
