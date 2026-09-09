const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');

test('transcript stage offers an AI punctuate button', () => {
  assert.match(html, /id="btn-punctuate-transcript"/);
  assert.match(html, />AI 补标点\/断句</);
  assert.match(app, /btnPunctuateTranscript = this\.root\.getElementById\('btn-punctuate-transcript'\)/);
});

test('punctuate writes back as an edited draft with polish-style guards', () => {
  assert.match(app, /async punctuateTranscript\(\)/);
  assert.match(app, /this\.api\.punctuateTranscript\(\{ fullText: text \}\)/);
  assert.match(app, /this\.transcriptRevision !== punctuateRevision/);
  assert.match(app, /polished === text/);
});
