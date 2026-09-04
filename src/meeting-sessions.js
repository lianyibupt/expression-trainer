(function (root) {
  class MeetingSessions {
    constructor() {
      this.items = new Map();
      this.activeId = null;
      this.recordingId = null;
    }

    create(id = globalThis.crypto.randomUUID()) {
      if (this.items.has(id)) throw new Error('Duplicate session ID');
      const now = new Date();
      const session = { id, title: `会议 ${this.items.size + 1}`, createdAt: now.toISOString(),
        startedAt: null, endedAt: null, open: true, status: '待开始' };
      this.items.set(id, session);
      this.select(id);
      return session;
    }

    get(id) { return this.items.get(id); }

    select(id) {
      const session = this.get(id);
      if (!session) return false;
      session.open = true;
      this.activeId = id;
      return true;
    }

    close(id) {
      const session = this.get(id);
      if (!session || id === this.recordingId) return false;
      const open = [...this.items.values()].filter(item => item.open);
      const index = open.indexOf(session);
      session.open = false;
      if (this.activeId === id) this.activeId = (open[index + 1] || open[index - 1])?.id || null;
      return true;
    }

    claimRecording(id) {
      if (!this.get(id) || this.recordingId) return false;
      this.recordingId = id;
      return true;
    }

    releaseRecording(id) {
      if (this.recordingId === id) this.recordingId = null;
    }
  }

  function createSessionAPI(api, sessionId) {
    return {
      ...api,
      initASR: () => api.initASR(sessionId),
      feedAudio: samples => api.feedAudio(samples, sessionId),
      stopASR: () => api.stopASR(sessionId),
      onASRFinalResult: callback => api.onASRFinalResult(result => {
        if (result?.sessionId === sessionId) return callback(result);
      }),
      onAudioAnalysisProgress: callback => api.onAudioAnalysisProgress(progress => {
        if (progress?.sessionId === sessionId) return callback(progress);
      }),
      analyzeAudioFile: payload => api.analyzeAudioFile({ ...payload, sessionId }),
      transcribeAudioFile: payload => api.transcribeAudioFile({ ...payload, sessionId }),
      cancelAudioAnalysis: jobId => api.cancelAudioAnalysis({ sessionId, jobId })
    };
  }

  function createSaveSnapshot(session, trainer) {
    return {
      sessionId: session.id,
      title: session.title,
      startedAt: session.startedAt || session.createdAt,
      endedAt: session.endedAt,
      transcript: trainer.transcriptEditor.value,
      transcriptRevision: trainer.transcriptRevision,
      transcriptSource: trainer.transcriptSource,
      stats: { ...trainer.stats },
      audioPath: trainer.pendingAudioPath,
      speakerSegments: trainer.speakerSegments.map(segment => ({ ...segment }))
    };
  }

  const exports = { MeetingSessions, createSessionAPI, createSaveSnapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else Object.assign(root, exports);
})(globalThis);
