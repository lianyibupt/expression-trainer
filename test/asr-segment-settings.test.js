const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.html'), 'utf8');
const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const example = fs.readFileSync(path.join(__dirname, '..', 'settings.example.json'), 'utf8');

test('settings page exposes the auto-segment toggle', () => {
  assert.match(html, /id="auto-segment"/);
  assert.match(html, /自动断句补标点/);
});

test('settings page loads and saves the auto-segment field', () => {
  assert.match(settings, /autoSegmentInput = document\.getElementById\('auto-segment'\)/);
  assert.match(settings, /autoSegment: this\.autoSegmentInput\.checked/);
  assert.match(settings, /asr\.autoSegment !== false/);
});

test('default asr config and example json enable auto segmentation', () => {
  assert.match(main, /autoSegment: true/);
  assert.match(example, /autoSegment/);
});
