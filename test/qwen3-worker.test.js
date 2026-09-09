const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const worker = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'qwen3_asr_worker.py'), 'utf8');

test('qwen3 worker normalizes auto/blank language to auto-detection', () => {
  assert.match(worker, /def normalize_language/);
  assert.match(worker, /auto|none|null/i);
  assert.match(worker, /known\.get\(tok\.lower\(\), tok\)/);
});

test('qwen3 worker falls back to auto-detection when the package rejects a language list', () => {
  assert.match(worker, /isinstance\(language, list\)/);
  assert.match(worker, /language=None/);
});
