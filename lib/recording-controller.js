const { log, startTask } = require('./runtime-log');

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
    const task = startTask('录音', '准备录音', { sessionId });
    try {
      const result = await this.asr.initASR(config);
      this.activeId = sessionId;
      this.audioSamples = 0;
      this.lastAudioLogAt = null;
      task.done({ mode: result.mode });
      log('录音', '识别引擎就绪，等待音频输入', { sessionId });
      return { ...result, sessionId };
    } catch (error) {
      task.fail(error);
      throw error;
    } finally {
      this.transitioning = false;
    }
  }

  feed(sessionId, samples) {
    if (sessionId !== this.activeId || !this.activeId || this.transitioning) return null;
    const result = this.asr.feedAudio(samples);
    this.audioSamples += samples.length;
    if (this.lastAudioLogAt === null || Date.now() - this.lastAudioLogAt >= 10000) {
      this.lastAudioLogAt = Date.now();
      log('录音', '正在接收音频并识别', { sessionId, audioSeconds: Math.round(this.audioSamples / 16000) });
    }
    return result ? { ...result, sessionId } : null;
  }

  async stop(sessionId, onFinalResult) {
    if (!sessionId || sessionId !== this.activeId || this.transitioning) throw new Error('Recording session mismatch');
    this.transitioning = true;
    const task = startTask('录音', '停止录音', { sessionId, audioSeconds: Math.round(this.audioSamples / 16000) });
    try {
      const result = await this.asr.stopRecognition({
        jobId: `${sessionId}:final`,
        onFinalResult: payload => {
          log('录音', payload.finalTextError ? '最终稿生成失败，保留实时稿' : '最终稿已返回', {
            sessionId, textChars: (payload.finalText || '').length, speakerCount: payload.speakerCount
          }, payload.finalTextError ? 'ERROR' : 'INFO');
          onFinalResult({ ...payload, sessionId });
        }
      });
      task.done();
      if (result?.finalTextPending) log('录音', '录音已结束，后台正在生成最终稿', { sessionId, jobId: `${sessionId}:final` });
      return { ...(typeof result === 'string' ? { finalText: result } : result), sessionId };
    } catch (error) {
      task.fail(error);
      throw error;
    } finally {
      this.activeId = null;
      this.transitioning = false;
    }
  }
}

module.exports = { RecordingController };
