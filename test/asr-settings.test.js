const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.html'), 'utf8');
const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.js'), 'utf8');
const example = fs.readFileSync(path.join(__dirname, '..', 'settings.example.json'), 'utf8');

test('settings page exposes a Qwen3 transcription language selector', () => {
  assert.match(html, /id="qwen3-language"/);
  assert.match(html, /value="auto"/);
  assert.match(html, /自动识别/);
});

test('settings page loads and saves the Qwen3 language field', () => {
  assert.match(settings, /qwen3LanguageSelect = document\.getElementById\('qwen3-language'\)/);
  assert.match(settings, /qwen3Language: this\.qwen3LanguageSelect\.value/);
  assert.match(settings, /asr\.qwen3Language \|\| 'auto'/);
});

test('settings example includes qwen3Language', () => {
  assert.match(example, /qwen3Language/);
});
