const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

test('main transforms final transcript text with the auto-segment rule', () => {
  assert.match(main, /require\('\.\/lib\/sentence-segment'\)/);
  assert.match(main, /applyAutoSegmentText/);
  assert.match(main, /ipcMain\.handle\('segment-text'/);
  assert.match(main, /payload\.finalText = applyAutoSegmentText\(payload\.finalText\)/);
});

test('preload exposes segmentText', () => {
  assert.match(preload, /segmentText: \(text\) => ipcRenderer\.invoke\('segment-text', \{ text \}\)/);
});
