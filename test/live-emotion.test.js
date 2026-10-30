const test = require('node:test');
const assert = require('node:assert/strict');
const { LiveEmotion, classifyScores } = require('../lib/live-emotion');

const voice = seconds => new Float32Array(16000 * seconds).fill(0.1);
const tick = () => new Promise(resolve => setImmediate(resolve));
const scores = { labels: ['neutral', 'happy', 'angry'], scores: [0.6, 0.3, 0.1] };

test('windows start at six seconds, advance three seconds, and keep only newest pending window', async () => {
  const requests = [], events = [], completes = [];
  const live = new LiveEmotion({ infer: samples => new Promise(resolve => { requests.push(samples); completes.push(resolve); }) });
  live.start('a', r => events.push(r));
  live.feed('a', voice(5));
  assert.equal(requests.length, 0);
  live.feed('a', voice(1));
  assert.equal(requests.length, 1);
  live.feed('a', voice(9));
  assert.equal(requests.length, 1);
  completes.shift()(scores);
  await tick();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].length, 96000);
  completes.shift()(scores);
  await tick();
  assert.equal(events.at(-1).endSeconds, 15);
  assert.equal(events.at(-1).sessionId, 'a');
  assert.equal(events.at(-1).candidates[0].label, '中性');
  assert.equal(events.at(-1).candidates[1].label, '愉快');
  live.stop('a');
});

test('pause clears windows and drops old inference even after resume', async () => {
  let resolve; const events = [];
  const live = new LiveEmotion({ infer: () => new Promise(r => { resolve = r; }) });
  live.start('a', r => events.push(r));
  live.feed('a', voice(6));
  live.pause('a', true);
  live.pause('a', false);
  resolve(scores); await tick();
  assert.equal(events.filter(r => r.status === 'result').length, 0);
  live.feed('a', voice(3));
  assert.equal(events.at(-1).status, 'collecting');
  live.stop('a');
});

test('stopping and restarting same meeting ignores previous recording result', async () => {
  let resolve; const events = [];
  const live = new LiveEmotion({ infer: () => new Promise(r => { resolve = r; }) });
  live.start('a', r => events.push(r)); live.feed('a', voice(6));
  live.stop('a'); live.start('a', r => events.push(r));
  resolve(scores); await tick();
  assert.equal(events.filter(r => r.status === 'result').length, 0);
  live.feed('other', voice(6));
  assert.equal(live.sampleCount, 0);
  live.stop('a');
});

test('silence bypasses inference and worker errors remain explicit', async () => {
  let calls = 0; const events = [];
  const live = new LiveEmotion({ infer: async () => { calls++; throw new Error('model missing'); } });
  live.start('a', r => events.push(r));
  live.feed('a', new Float32Array(96000)); await tick();
  assert.equal(calls, 0); assert.equal(events.at(-1).status, 'silence');
  live.feed('a', voice(6)); await tick();
  assert.equal(events.at(-1).status, 'unavailable');
  assert.match(events.at(-1).message, /model missing/);
  live.stop('a');
});

test('unknown, low scores and malformed scores do not fabricate an emotion', () => {
  assert.equal(classifyScores({ labels: ['unknown', 'happy'], scores: [0.8, 0.2] }).status, 'uncertain');
  assert.equal(classifyScores({ labels: ['happy', 'sad', 'neutral'], scores: [0.34, 0.33, 0.33] }).status, 'uncertain');
  assert.throws(() => classifyScores({ labels: ['happy'], scores: [NaN] }));
  assert.throws(() => classifyScores({ labels: ['happy'], scores: [] }));
});

test('model startup errors reject cleanly before there is an inference request', async () => {
  const { EmotionWorker } = require('../lib/live-emotion');
  const { EventEmitter } = require('node:events');
  const { PassThrough } = require('node:stream');
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.kill = () => {};
  const worker = new EmotionWorker({ spawnProcess: () => child, exists: () => true });
  const ready = worker.start();
  child.stdout.write(JSON.stringify({ error: 'invalid model weights' }) + '\n');
  await assert.rejects(ready, /invalid model weights/);
  assert.equal(worker.child, null);
});

test('a recording stopped before warmup does not start an orphan model process', async () => {
  let loads = 0;
  const live = new LiveEmotion({ infer: async () => scores, warmup: async () => { loads++; } });
  live.start('a', () => {});
  live.stop('a');
  await tick();
  assert.equal(loads, 0);
});
