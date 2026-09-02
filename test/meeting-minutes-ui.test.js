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
