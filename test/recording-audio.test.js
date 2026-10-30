const assert = require('node:assert/strict');
const test = require('node:test');
const { RecordingAudioRouter } = require('../src/recording-audio');

function capture() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return { stream: { getTracks: () => [track], getAudioTracks: () => [track] }, track };
}

function setup(overrides = {}) {
  const node = () => ({ connect() {}, disconnect() {} });
  const processor = node();
  const context = {
    destination: node(),
    createChannelMerger: node,
    createScriptProcessor: () => processor,
    createConstantSource: () => ({ ...node(), offset: { value: 1 }, start() {}, stop() {} }),
    createMediaStreamSource: node,
    async close() { this.closed = true; }
  };
  const microphone = capture();
  const system = capture();
  const received = [];
  let micRequests = 0;
  const router = new RecordingAudioRouter({ audioContext: context,
    requestMicrophone: async () => { micRequests++; return microphone.stream; },
    requestSystemAudio: async () => ({ stream: system.stream }),
    stopSystemAudio: async () => {},
    onSamples: (samples, activity) => received.push({ samples: Array.from(samples), activity }),
    ...overrides });
  const feed = (mic = [0.8, 0.8], output = [0.2, 0.2]) => {
    const channels = [Float32Array.from(mic), Float32Array.from(output)];
    processor.onaudioprocess({
      inputBuffer: { getChannelData: i => channels[i] },
      outputBuffer: { getChannelData: () => new Float32Array(mic.length) }
    });
    return received.at(-1);
  };
  return { router, microphone, system, received, feed, context, micRequests: () => micRequests };
}

test('system-only capture neither requests nor includes the microphone', async () => {
  const s = setup();
  await s.router.setEnabled('system', true);
  const result = s.feed();
  assert.equal(s.micRequests(), 0);
  assert.ok(result.samples.every(value => Math.abs(value - 0.2) < 0.00001));
  assert.equal(result.activity.microphoneRms, 0);
  await s.router.close();
  assert.equal(s.system.track.stopped, true);
});

test('disabling input immediately removes it from future samples and stops its track', async () => {
  const s = setup();
  await s.router.setEnabled('microphone', true);
  await s.router.setEnabled('system', true);
  assert.ok(s.feed().samples.every(value => Math.abs(value - 0.5) < 0.00001));
  const disabling = s.router.setEnabled('microphone', false);
  assert.equal(s.microphone.track.stopped, true);
  assert.ok(s.feed().samples.every(value => Math.abs(value - 0.2) < 0.00001));
  await disabling;
  await s.router.setEnabled('system', false);
  assert.deepEqual(s.feed().samples, [0, 0]);
  await s.router.close();
});

test('native system audio is independent of microphone callbacks and old queued samples are discarded on disable', async () => {
  const s = setup({ requestSystemAudio: async () => ({ native: true }) });
  await s.router.setEnabled('system', true);
  s.router.enqueueNative(Float32Array.from([0.3, 0.4, 0.9, 0.9]));
  assert.ok(Math.abs(s.feed([0, 0], [0, 0]).samples[0] - 0.3) < 0.00001);
  await s.router.setEnabled('system', false);
  s.router.enqueueNative(Float32Array.from([0.9, 0.9]));
  await s.router.setEnabled('system', true);
  assert.deepEqual(s.feed([0, 0], [0, 0]).samples, [0, 0]);
  assert.equal(s.micRequests(), 0);
  await s.router.close();
});

test('system output failure remains off and never falls back to microphone', async () => {
  const s = setup({ requestSystemAudio: async () => { throw new Error('permission denied'); } });
  await assert.rejects(s.router.setEnabled('system', true), /permission denied/);
  assert.equal(s.router.states.system, 'error');
  assert.equal(s.micRequests(), 0);
  assert.deepEqual(s.feed().samples, [0, 0]);
  await s.router.close();
});

test('stopping while permission is pending releases the late stream without reconnecting it', async () => {
  let resolveMic;
  const late = capture();
  const s = setup({ requestMicrophone: () => new Promise(resolve => { resolveMic = resolve; }) });
  const enabling = s.router.setEnabled('microphone', true);
  await new Promise(resolve => setImmediate(resolve));
  const closing = s.router.close();
  resolveMic(late.stream);
  await Promise.all([enabling, closing]);
  assert.equal(late.track.stopped, true);
  assert.equal(s.router.enabled.microphone, false);
  assert.equal(s.context.closed, true);
});

test('quick off/on changes serialize native helpers and do not retain disabled audio', async () => {
  const s = setup({ requestSystemAudio: async () => ({ native: true }) });
  await s.router.setEnabled('system', true);
  s.router.enqueueNative(Float32Array.from([0.9, 0.9]));
  const off = s.router.setEnabled('system', false);
  const on = s.router.setEnabled('system', true);
  await Promise.all([off, on]);
  assert.equal(s.router.enabled.system, true);
  assert.deepEqual(s.feed().samples, [0, 0]);
  await s.router.close();
});
