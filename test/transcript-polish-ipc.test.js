const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const feedback = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ai-feedback.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

test('sendTranscriptPolish chunks via splitTranscriptForPolish and joins parts with a single newline', () => {
  const executor = feedback.match(/async function sendTranscriptPolish[\s\S]*?\n}/);
  assert.ok(executor, 'sendTranscriptPolish function body not found');
  assert.match(executor[0], /splitTranscriptForPolish\(/);
  assert.match(executor[0], /return parts\.join\('\\n'\)/);
  assert.match(feedback, /getTranscriptPolishPrompt\(/);
});

test('main exposes a polish-transcript IPC channel', () => {
  assert.match(main, /sendTranscriptPolish/);
  assert.match(main, /ipcMain\.handle\('polish-transcript'/);
});

test('preload exposes polishTranscript', () => {
  assert.match(preload, /polishTranscript: \(payload\) => ipcRenderer\.invoke\('polish-transcript', payload\)/);
});
