const assert = require('node:assert/strict');
const test = require('node:test');
const { MeetingSessions, createSessionAPI, createSaveSnapshot } = require('../src/meeting-sessions');

test('clearing content resets an automatic title but preserves manual naming', () => {
  const sessions = new MeetingSessions();
  const session = sessions.create('a');
  session.title = '旧内容的主题'; session.titleSource = 'auto';
  sessions.resetAutomaticTitle(session.id);
  assert.equal(session.title, '会议 1');
  assert.equal(session.titleSource, 'default');
  session.title = '手动名称'; session.titleSource = 'manual';
  sessions.resetAutomaticTitle(session.id);
  assert.equal(session.title, '手动名称');
});

test('closing a tab preserves its identity and workbench for reopening', () => {
  const sessions = new MeetingSessions();
  const a = sessions.create('a');
  const b = sessions.create('b');
  a.trainer = { fullText: 'meeting A' };
  assert.equal(sessions.close(a.id), true);
  assert.equal(a.open, false);
  assert.equal(sessions.activeId, b.id);
  sessions.select(a.id);
  assert.equal(a.open, true);
  assert.equal(sessions.get(a.id).trainer.fullText, 'meeting A');
});

test('view selection and closing are independent of microphone ownership', () => {
  const sessions = new MeetingSessions();
  const a = sessions.create('a');
  const b = sessions.create('b');
  assert.equal(sessions.claimRecording(b.id), true);
  sessions.select(a.id);
  assert.equal(sessions.recordingId, b.id);
  assert.equal(sessions.close(b.id), false);
  assert.equal(sessions.claimRecording(a.id), false);
  sessions.releaseRecording(a.id);
  assert.equal(sessions.recordingId, b.id);
  sessions.releaseRecording(b.id);
  assert.equal(sessions.close(b.id), true);
});

test('late final events are delivered to their original, even closed, meeting', () => {
  const listeners = [];
  const base = { onASRFinalResult: cb => listeners.push(cb) };
  const resultsA = [], resultsB = [];
  createSessionAPI(base, 'a').onASRFinalResult(r => resultsA.push(r.finalText));
  createSessionAPI(base, 'b').onASRFinalResult(r => resultsB.push(r.finalText));
  for (const cb of listeners) cb({ sessionId: 'b', finalText: 'B' });
  for (const cb of listeners) cb({ sessionId: 'a', finalText: 'A' });
  for (const cb of listeners) cb({ finalText: 'unidentified' });
  assert.deepEqual(resultsA, ['A']);
  assert.deepEqual(resultsB, ['B']);
});

test('save snapshot retains identity, edited text, and speaker data after changes', () => {
  const sessions = new MeetingSessions();
  const a = sessions.create('a');
  a.title = 'Planning';
  const trainer = { fullText: 'live', transcriptEditor: { value: 'edited A' },
    stats: { totalWords: 1 }, pendingAudioPath: '/a.wav',
    speakerSegments: [{ speaker: 'A', start: 0 }], transcriptRevision: 2,
    transcriptSource: 'edited', lastMinutes: '现有纪要', lastReport: '现有报告' };
  const snapshot = createSaveSnapshot(a, trainer);
  a.title = 'renamed';
  trainer.transcriptEditor.value = 'changed';
  trainer.stats.totalWords = 999;
  trainer.speakerSegments[0].speaker = 'changed';
  trainer.lastMinutes = 'changed minutes';
  trainer.lastReport = 'changed report';
  assert.equal(snapshot.sessionId, 'a');
  assert.equal(snapshot.title, 'Planning');
  assert.equal(snapshot.transcript, 'edited A');
  assert.equal(snapshot.speakerSegments[0].speaker, 'A');
  assert.equal(snapshot.stats.totalWords, 1);
  assert.equal(snapshot.minutes, '现有纪要');
  assert.equal(snapshot.report, '现有报告');
  assert.notEqual(snapshot.speakerSegments, trainer.speakerSegments);
});

test('save snapshot preserves an audio-only recording without requiring transcript text', () => {
  const sessions = new MeetingSessions();
  const session = sessions.create('audio-only');
  const snapshot = createSaveSnapshot(session, {
    transcriptEditor: { value: '' }, transcriptRevision: 0, transcriptSource: 'realtime',
    stats: {}, pendingAudioPath: '/recordings/audio-only.wav', speakerSegments: [],
    lastMinutes: '', lastReport: ''
  });
  assert.equal(snapshot.transcript, '');
  assert.equal(snapshot.audioPath, '/recordings/audio-only.wav');
});

test('emotion events and pause requests are scoped to the intended meeting', () => {
  const callbacks = [], events = [], pauses = [];
  const api = createSessionAPI({ onLiveEmotion: cb => callbacks.push(cb),
    pauseLiveEmotion: (id, paused) => pauses.push({ id, paused }) }, 'a');
  api.onLiveEmotion(r => events.push(r));
  callbacks[0]({ sessionId: 'b' }); callbacks[0]({ sessionId: 'a', status: 'result' });
  api.pauseLiveEmotion(true);
  assert.equal(events.length, 1);
  assert.deepEqual(pauses, [{ id: 'a', paused: true }]);
});
