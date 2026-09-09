const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const feedback = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ai-feedback.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

test('ai-feedback exposes a punctuate executor reusing the polish chunker', () => {
  assert.match(feedback, /sendTranscriptPunctuate/);
  assert.match(feedback, /splitTranscriptForPolish\(/);
  assert.match(feedback, /getTranscriptPunctuatePrompt\(/);
});

test('main exposes punctuate-transcript channel', () => {
  assert.match(main, /sendTranscriptPunctuate/);
  assert.match(main, /ipcMain\.handle\('punctuate-transcript'/);
});

test('preload exposes punctuateTranscript', () => {
  assert.match(preload, /punctuateTranscript: \(payload\) => ipcRenderer\.invoke\('punctuate-transcript', payload\)/);
});
