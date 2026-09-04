class RecordingController {
  constructor(asr) {
    this.asr = asr;
    this.activeId = null;
    this.transitioning = false;
  }

  async start(sessionId, config) {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('Session ID is required');
    if (this.activeId || this.transitioning) throw new Error('Another recording is active');
    this.transitioning = true;
    try {
      const result = await this.asr.initASR(config);
      this.activeId = sessionId;
      return { ...result, sessionId };
    } finally {
      this.transitioning = false;
    }
  }

  feed(sessionId, samples) {
    if (sessionId !== this.activeId || !this.activeId || this.transitioning) return null;
    const result = this.asr.feedAudio(samples);
    return result ? { ...result, sessionId } : null;
  }

  async stop(sessionId, onFinalResult) {
    if (!sessionId || sessionId !== this.activeId || this.transitioning) throw new Error('Recording session mismatch');
    this.transitioning = true;
    try {
      const result = await this.asr.stopRecognition({
        onFinalResult: payload => onFinalResult({ ...payload, sessionId })
      });
      return { ...(typeof result === 'string' ? { finalText: result } : result), sessionId };
    } finally {
      this.activeId = null;
      this.transitioning = false;
    }
  }
}

module.exports = { RecordingController };
