const assert = require('node:assert/strict');
const test = require('node:test');
const { describeMeetingExitState, collectPendingMeetings } = require('../lib/meeting-exit');

function trainer(overrides = {}) {
  return {
    isRecording: false,
    isStoppingRecording: false,
    awaitingFinalTranscript: false,
    savePromise: null,
    fullText: '',
    transcriptRevision: 0,
    transcriptSource: 'realtime',
    pendingAudioPath: '',
    speakerSegments: [],
    lastMinutes: '',
    lastReport: '',
    savedSnapshot: null,
    savedArtifacts: { minutes: '', report: '' },
    ...overrides
  };
}

test('blank meeting is safe while recording and pending final are not', () => {
  const session = { id: 'a', title: 'A', open: true };
  assert.equal(describeMeetingExitState(session, trainer()).pending, false);
  assert.equal(describeMeetingExitState(session, trainer({ isRecording: true })).reason, 'recording');
  assert.equal(describeMeetingExitState(session, trainer({ awaitingFinalTranscript: true })).reason, 'finalizing');
});

test('content and generated artifacts remain pending until their exact revisions are saved', () => {
  const session = { id: 'a', title: 'A', open: false };
  const state = trainer({ fullText: '原文', transcriptRevision: 2, lastMinutes: '纪要', lastReport: '报告' });
  assert.deepEqual(describeMeetingExitState(session, state).artifacts, ['transcript', 'minutes', 'report']);
  state.savedSnapshot = { title: 'A', transcriptRevision: 2, transcriptSource: 'realtime' };
  state.savedArtifacts = { minutes: '纪要', report: '报告' };
  assert.equal(describeMeetingExitState(session, state).pending, false);
  state.transcriptRevision = 3;
  assert.equal(describeMeetingExitState(session, state).pending, true);
});

test('collector includes recently closed sessions', () => {
  const sessions = [
    { id: 'open', title: 'Open', open: true, trainer: trainer() },
    { id: 'closed', title: 'Closed', open: false, trainer: trainer({ fullText: '未保存' }) }
  ];
  assert.deepEqual(collectPendingMeetings(sessions).map(item => item.id), ['closed']);
});

test('exit waits for starting capture and in-flight generated artifacts', () => {
  const session = { id: 'a', title: 'A' };
  assert.equal(describeMeetingExitState(session, trainer({ isStartingRecording: true })).pending, true);
  assert.equal(describeMeetingExitState(session, trainer({ reportPromise: Promise.resolve() })).reason, 'generating');
  assert.equal(describeMeetingExitState(session, trainer({ minutesPromise: Promise.resolve() })).reason, 'generating');
});
