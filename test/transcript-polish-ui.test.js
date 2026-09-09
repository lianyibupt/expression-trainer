const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');

test('transcript stage offers an AI polish button', () => {
  assert.match(html, /id="btn-polish-transcript"/);
  assert.match(html, />AI 修正错字</);
  assert.match(app, /btnPolishTranscript = this\.root\.getElementById\('btn-polish-transcript'\)/);
});

test('polish result is written back into the editor as an edited draft', () => {
  assert.match(app, /polishTranscript\(\)/);
  assert.match(app, /this\.api\.polishTranscript\(\{ fullText: text \}\)/);
  assert.match(app, /this\.handleTranscriptEditorInput\(\)/);
});
