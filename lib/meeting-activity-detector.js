class MeetingActivityDetector {
  constructor({ startAfterSec = 60, stopAfterSec, reviewAfterSec = 180, minReviewRecordingSec = 120 } = {}) {
    this.startAfterMs = startAfterSec * 1000;
    this.reviewAfterMs = (stopAfterSec || reviewAfterSec) * 1000;
    this.minReviewRecordingMs = minReviewRecordingSec * 1000;
    this.activeSinceMs = null;
    this.quietSinceMs = null;
    this.recordingStartedAtMs = null;
    this.isRecording = false;
  }

  reset() {
    this.activeSinceMs = null;
    this.quietSinceMs = null;
    this.recordingStartedAtMs = null;
    this.isRecording = false;
  }

  markRecordingStarted(nowMs = Date.now()) {
    this.isRecording = true;
    this.activeSinceMs = null;
    this.quietSinceMs = null;
    this.recordingStartedAtMs = nowMs;
    this.lastTransitionMs = nowMs;
  }

  markRecordingStopped(nowMs = Date.now()) {
    this.isRecording = false;
    this.activeSinceMs = null;
    this.quietSinceMs = null;
    this.recordingStartedAtMs = null;
    this.lastTransitionMs = nowMs;
  }

  update({ nowMs = Date.now(), hasInput, hasOutput = false }) {
    const isActive = Boolean(hasInput || hasOutput);

    if (!this.isRecording) {
      if (!hasInput) {
        this.activeSinceMs = null;
        return null;
      }

      if (this.activeSinceMs === null) {
        this.activeSinceMs = nowMs;
        return null;
      }

      if (nowMs - this.activeSinceMs >= this.startAfterMs) {
        this.markRecordingStarted(nowMs);
        return 'start';
      }

      return null;
    }

    if (isActive) {
      this.quietSinceMs = null;
      return null;
    }

    if (this.quietSinceMs === null) {
      this.quietSinceMs = nowMs;
      return null;
    }

    if (nowMs - this.quietSinceMs >= this.reviewAfterMs) {
      const recordingDurationMs = this.recordingStartedAtMs === null ? 0 : nowMs - this.recordingStartedAtMs;
      if (recordingDurationMs < this.minReviewRecordingMs) {
        this.markRecordingStopped(nowMs);
        return 'discard';
      }

      this.quietSinceMs = null;
      return 'review';
    }

    return null;
  }
}

module.exports = { MeetingActivityDetector };
