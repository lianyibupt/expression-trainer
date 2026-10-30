const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');

test('main page contains an independent meeting minutes stage', () => {
  assert.match(html, /data-stage="minutes"/);
  assert.match(html, /data-panel="minutes"/);
  assert.match(html, /id="btn-generate-minutes"/);
  assert.match(html, /id="btn-copy-minutes"/);
  assert.match(html, /id="btn-save-minutes"/);
  assert.match(html, /id="minutes-body"/);
  assert.match(html, /id="btn-go-minutes"/);
});

test('main page contains the independent audio analysis workbench', () => {
  assert.match(html, /data-stage="audio"/);
  assert.match(html, /data-panel="audio"/);
  assert.match(html, /id="audio-dropzone"/);
  assert.match(html, /id="audio-player"/);
  assert.match(html, /id="audio-waveform"/);
  assert.match(html, /id="btn-audio-analyze"/);
  assert.match(html, /id="btn-audio-transcribe"/);
});

test('meeting session async results are guarded against stale sessions', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  assert.match(app, /this\.sessionGeneration = 0/);
  assert.match(app, /this\.activeSessionGeneration = sessionGeneration/);
  assert.match(app, /this\.pendingFinalTranscriptGeneration !== this\.activeSessionGeneration/);
  assert.doesNotMatch(app, /上一场会议整理中，等待完成/);
  assert.match(app, /createSaveSnapshot\(this\.session, this\)/);
  assert.match(app, /if \(!this\.isSessionCurrent\(sessionGeneration\)\)\s*(?:return(?:\s+false)?;|\{\s*return\s*\{\s*success:\s*false,)/);
});

test('meeting tabs provide close, reopen and recording-owner controls', () => {
  assert.match(html, /id="meeting-tabs"/);
  assert.match(html, /id="recent-sessions"/);
  assert.match(html, /id="btn-new-session"/);
  assert.match(html, /id="recording-banner"/);
  assert.match(html, /id="btn-stop-recording"/);
  assert.match(html, /id="meeting-save-status"/);
});
