const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');

test('realtime flush segments the buffered phrase into sentences', () => {
  assert.match(app, /this\.api\.segmentText\(text\)/);
  assert.match(app, /\.split\('\\n'\)/);
  assert.match(app, /autoSegment/);
});

test('audio analysis display segments the transcription text', () => {
  assert.match(app, /segmentText\(transcription\?\.text \|\| ''\)/);
});
