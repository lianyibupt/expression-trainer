(function (root) {
  class RecordingAudioRouter {
    constructor({ audioContext, requestMicrophone, requestSystemAudio, stopSystemAudio, onSamples, onState = () => {}, onSourceError = () => {} }) {
      this.context = audioContext;
      this.requests = { microphone: async () => ({ stream: await requestMicrophone() }), system: requestSystemAudio };
      this.stopSystemAudio = stopSystemAudio;
      this.onSamples = onSamples;
      this.onState = onState;
      this.onSourceError = onSourceError;
      this.enabled = { microphone: false, system: false };
      this.states = { microphone: 'off', system: 'off' };
      this.versions = { microphone: 0, system: 0 };
      this.operations = { microphone: Promise.resolve(), system: Promise.resolve() };
      this.captures = {};
      this.nativeQueue = [];
      this.nativeSamples = 0;
      this.closed = false;

      // Keep the graph running in system-only or all-off mode, without opening
      // a microphone. Independent channels also gate already-buffered input.
      this.merger = audioContext.createChannelMerger(2);
      this.processor = audioContext.createScriptProcessor(2048, 2, 1);
      this.silence = audioContext.createConstantSource();
      this.silence.offset.value = 0;
      this.silence.connect(this.merger, 0, 0);
      this.silence.start();
      this.merger.connect(this.processor);
      this.processor.connect(audioContext.destination);
      this.processor.onaudioprocess = event => this.process(event);
    }

    setState(kind, state) {
      this.states[kind] = state;
      this.onState({ ...this.states });
    }

    release(kind) {
      this.enabled[kind] = false;
      const capture = this.captures[kind];
      delete this.captures[kind];
      capture?.node?.disconnect();
      for (const track of capture?.stream?.getTracks() || []) {
        track.removeEventListener?.('ended', capture.onEnded);
        track.stop();
      }
      if (kind === 'system') {
        this.nativeQueue = [];
        this.nativeSamples = 0;
      }
    }

    setEnabled(kind, enabled) {
      if (!Object.hasOwn(this.enabled, kind)) return Promise.reject(new Error('Unknown audio source'));
      if (this.closed) return Promise.resolve(false);
      if (enabled && this.states[kind] === 'on') return Promise.resolve(true);
      const version = ++this.versions[kind];
      // This happens synchronously, before any permission request/async cleanup.
      this.release(kind);
      this.setState(kind, enabled ? 'starting' : 'off');
      const isCurrent = () => !this.closed && this.versions[kind] === version;
      const operation = this.operations[kind].catch(() => {}).then(async () => {
        if (!isCurrent()) return false;
        if (kind === 'system') await this.stopSystemAudio();
        if (!enabled || !isCurrent()) return false;
        let capture;
        try {
          capture = await this.requests[kind]();
          if (!capture?.native && !capture?.stream?.getAudioTracks().length) throw new Error('未获得音频轨道');
          if (!isCurrent()) {
            capture.stream?.getTracks().forEach(track => track.stop());
            if (kind === 'system') await this.stopSystemAudio();
            return false;
          }
          if (capture.stream) {
            capture.node = this.context.createMediaStreamSource(capture.stream);
            capture.node.connect(this.merger, 0, kind === 'microphone' ? 0 : 1);
          }
          capture.onEnded = () => this.sourceEnded(kind);
          for (const track of capture.stream?.getAudioTracks() || []) track.addEventListener?.('ended', capture.onEnded);
          this.captures[kind] = capture;
          this.enabled[kind] = true;
          this.setState(kind, 'on');
          return true;
        } catch (error) {
          capture?.node?.disconnect();
          capture?.stream?.getTracks().forEach(track => track.stop());
          if (kind === 'system') await this.stopSystemAudio();
          if (isCurrent()) {
            this.release(kind);
            this.setState(kind, 'error');
            this.onSourceError(kind, error);
          }
          throw error;
        }
      });
      this.operations[kind] = operation;
      return operation;
    }

    sourceEnded(kind) {
      if (this.closed || !this.enabled[kind]) return;
      this.setEnabled(kind, false).catch(() => {});
      this.onSourceError(kind, new Error('音频采集中断，请重新开启此来源'));
    }

    enqueueNative(samples) {
      if (this.closed || !this.enabled.system || !this.captures.system?.native || !samples.length) return;
      this.nativeQueue.push(new Float32Array(samples));
      this.nativeSamples += samples.length;
      while (this.nativeSamples > 16000 * 30 && this.nativeQueue.length) {
        this.nativeSamples -= this.nativeQueue.shift().length;
      }
    }

    consumeNative(length) {
      const result = new Float32Array(length);
      let offset = 0;
      while (offset < length && this.nativeQueue.length) {
        const chunk = this.nativeQueue[0];
        const take = Math.min(length - offset, chunk.length);
        result.set(chunk.subarray(0, take), offset);
        offset += take;
        this.nativeSamples -= take;
        if (take === chunk.length) this.nativeQueue.shift();
        else this.nativeQueue[0] = chunk.subarray(take);
      }
      return result;
    }

    process(event) {
      // Never play captured microphone/system audio through the app itself.
      event.outputBuffer.getChannelData(0).fill(0);
      if (this.closed) return;
      const microphone = event.inputBuffer.getChannelData(0);
      const system = this.captures.system?.native ? this.consumeNative(microphone.length) : event.inputBuffer.getChannelData(1);
      const mixed = new Float32Array(microphone.length);
      const count = Number(this.enabled.microphone) + Number(this.enabled.system);
      let micEnergy = 0;
      let systemEnergy = 0;
      for (let i = 0; i < mixed.length; i++) {
        const micSample = this.enabled.microphone ? microphone[i] : 0;
        const systemSample = this.enabled.system ? system[i] : 0;
        mixed[i] = count ? Math.max(-1, Math.min(1, (micSample + systemSample) / count)) : 0;
        micEnergy += micSample * micSample;
        systemEnergy += systemSample * systemSample;
      }
      this.onSamples(mixed, {
        microphoneRms: Math.sqrt(micEnergy / (mixed.length || 1)),
        systemRms: Math.sqrt(systemEnergy / (mixed.length || 1))
      });
    }

    close() {
      if (this.closing) return this.closing;
      this.closed = true;
      this.versions.microphone++;
      this.versions.system++;
      this.release('microphone');
      this.release('system');
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
      this.merger.disconnect();
      this.silence.stop();
      this.silence.disconnect();
      this.closing = (async () => {
        await Promise.allSettled(Object.values(this.operations));
        try { await this.stopSystemAudio(); }
        finally { await this.context.close(); }
      })();
      return this.closing;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { RecordingAudioRouter };
  else root.RecordingAudioRouter = RecordingAudioRouter;
})(globalThis);
