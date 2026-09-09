const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const asr = fs.readFileSync(path.join(__dirname, '..', 'lib', 'asr.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('asr.js no longer hardcodes Chinese as the Qwen3-ASR language', () => {
  assert.doesNotMatch(asr, /'--language', 'Chinese'/);
  assert.match(asr, /QWEN3_ASR_LANGUAGE/);
  assert.match(asr, /language: qwen3Language/);
});

test('audio file transcription passes the configured language through', () => {
  assert.match(main, /settings\.asr\?\.qwen3Language/);
});
