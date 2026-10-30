// Real local-model smoke check; the default input is the model's public example.
const path = require('path');
const assert = require('node:assert/strict');
const { EmotionWorker, LiveEmotion } = require('../lib/live-emotion');
const { readWav16kMono } = require('../lib/audio-analysis');

async function main() {
  const worker = new EmotionWorker();
  const started = Date.now();
  const live = new LiveEmotion({ infer: samples => worker.infer(samples),
    warmup: () => worker.start(), close: () => worker.close() });
  try {
    await worker.start();
    const loadMs = Date.now() - started;
    const input = readWav16kMono(process.argv[2] || path.join(__dirname, '..', 'models', 'emotion2vec_plus_base', 'example', 'test.wav'));
    const samples = new Float32Array(96000);
    samples.set(input.subarray(0, samples.length));
    const events = [];
    const result = await new Promise((resolve, reject) => {
      live.start('local-model-check', event => {
        events.push(event.status);
        if (['result', 'uncertain', 'silence'].includes(event.status)) resolve(event);
        if (event.status === 'unavailable') reject(new Error(event.message));
      });
      // Use the same small PCM chunks as the recording feed, rather than calling
      // the classifier directly. This also verifies buffering and result delivery.
      for (let offset = 0; offset < samples.length; offset += 2048) live.feed('local-model-check', samples.subarray(offset, offset + 2048));
    });
    assert.ok(events.includes('analyzing'), 'The fixture must contain audible samples');
    assert.equal(result.endSeconds, 6);
    assert.equal(result.sessionId, 'local-model-check');
    const rounds = [];
    for (let i = 0; i < 2; i++) {
      const before = Date.now();
      const raw = await worker.infer(samples);
      assert.equal(raw.labels.length, 9);
      assert.equal(raw.scores.length, 9);
      rounds.push(Date.now() - before);
    }
    live.pause('local-model-check', true);
    live.stop('local-model-check');
    console.log(JSON.stringify({ loadMs, events, result, repeatInferenceMs: rounds }, null, 2));
  } finally { worker.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
