const assert = require('node:assert/strict');
const test = require('node:test');
const { RecordingController } = require('../lib/recording-controller');

test('a new recording does not wait for the previous finalization and callbacks retain identity', async () => {
  const callbacks = [], results = [], samples = [];
  const controller = new RecordingController({
    initASR: async () => ({ mode: 'streaming-final' }),
    feedAudio: audio => { samples.push(audio); return { text: 'live' }; },
    stopRecognition: async ({ onFinalResult }) => {
      callbacks.push(onFinalResult);
      return { finalTextPending: true };
    }
  });
  await controller.start('a', {});
  await controller.stop('a', result => results.push(result));
  await controller.start('b', {});
  assert.equal(controller.feed('a', [1]), null);
  assert.equal(controller.feed('b', [2]).sessionId, 'b');
  await controller.stop('b', result => results.push(result));
  callbacks[1]({ finalText: 'B' });
  callbacks[0]({ finalText: 'A' });
  assert.deepEqual(samples, [[2]]);
  assert.deepEqual(results.map(r => [r.sessionId, r.finalText]), [['b', 'B'], ['a', 'A']]);
});

test('a stale stop or another start cannot reset the active microphone session', async () => {
  let stops = 0;
  const controller = new RecordingController({ initASR: async () => ({}),
    feedAudio: () => null, stopRecognition: async () => { stops++; return {}; } });
  await controller.start('a', {});
  await assert.rejects(controller.start('b', {}), /recording/i);
  await assert.rejects(controller.stop('b', () => {}), /session/i);
  assert.equal(stops, 0);
  await controller.stop('a', () => {});
  assert.equal(stops, 1);
});
