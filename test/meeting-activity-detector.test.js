const assert = require('node:assert/strict');
const test = require('node:test');

const { MeetingActivityDetector } = require('../lib/meeting-activity-detector');

test('detector starts recording after continuous microphone activity', () => {
  const detector = new MeetingActivityDetector({ startAfterSec: 60, stopAfterSec: 180 });

  assert.equal(detector.update({ nowMs: 0, hasInput: true, hasOutput: false }), null);
  assert.equal(detector.update({ nowMs: 59_000, hasInput: true, hasOutput: false }), null);
  assert.equal(detector.update({ nowMs: 60_000, hasInput: true, hasOutput: false }), 'start');
  assert.equal(detector.isRecording, true);
});

test('detector resets pending start when microphone activity stops early', () => {
  const detector = new MeetingActivityDetector({ startAfterSec: 60, stopAfterSec: 180 });

  detector.update({ nowMs: 0, hasInput: true, hasOutput: false });
  detector.update({ nowMs: 30_000, hasInput: false, hasOutput: false });

  assert.equal(detector.update({ nowMs: 70_000, hasInput: true, hasOutput: false }), null);
  assert.equal(detector.update({ nowMs: 129_000, hasInput: true, hasOutput: false }), null);
  assert.equal(detector.update({ nowMs: 130_000, hasInput: true, hasOutput: false }), 'start');
});

test('detector asks for review instead of finalizing after quiet time', () => {
  const detector = new MeetingActivityDetector({ startAfterSec: 60, reviewAfterSec: 180 });

  detector.update({ nowMs: 0, hasInput: true, hasOutput: false });
  assert.equal(detector.update({ nowMs: 60_000, hasInput: true, hasOutput: false }), 'start');
  assert.equal(detector.update({ nowMs: 120_000, hasInput: false, hasOutput: false }), null);
  assert.equal(detector.update({ nowMs: 299_000, hasInput: false, hasOutput: false }), null);
  assert.equal(detector.update({ nowMs: 300_000, hasInput: false, hasOutput: false }), 'review');
  assert.equal(detector.isRecording, true);
});

test('detector does not ask for review while audio output is still active', () => {
  const detector = new MeetingActivityDetector({ startAfterSec: 60, reviewAfterSec: 180 });

  detector.update({ nowMs: 0, hasInput: true, hasOutput: false });
  detector.update({ nowMs: 60_000, hasInput: true, hasOutput: false });
  detector.update({ nowMs: 120_000, hasInput: false, hasOutput: true });
  assert.equal(detector.update({ nowMs: 360_000, hasInput: false, hasOutput: true }), null);
  assert.equal(detector.update({ nowMs: 361_000, hasInput: false, hasOutput: false }), null);
  assert.equal(detector.update({ nowMs: 541_000, hasInput: false, hasOutput: false }), 'review');
});

test('detector ignores short recordings before review threshold can create artifacts', () => {
  const detector = new MeetingActivityDetector({ startAfterSec: 10, reviewAfterSec: 30, minReviewRecordingSec: 120 });

  detector.update({ nowMs: 0, hasInput: true, hasOutput: false });
  assert.equal(detector.update({ nowMs: 10_000, hasInput: true, hasOutput: false }), 'start');
  detector.update({ nowMs: 20_000, hasInput: false, hasOutput: false });
  assert.equal(detector.update({ nowMs: 50_000, hasInput: false, hasOutput: false }), 'discard');
  assert.equal(detector.isRecording, false);
});
