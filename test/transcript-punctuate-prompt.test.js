const assert = require('node:assert/strict');
const test = require('node:test');

const { getTranscriptPunctuatePrompt } = require('../lib/prompts');

test('punctuate prompt only adds sentence punctuation and line breaks', () => {
  const source = '说话人 1：我们下周上线然后同步人力安排';
  const prompt = getTranscriptPunctuatePrompt(source);

  assert.match(prompt.system, /只增补句子结尾的标点/);
  assert.match(prompt.system, /不得增删改写/);
  assert.match(prompt.system, /填充词/);
  assert.match(prompt.system, /说话人/);
  assert.match(prompt.system, /一句一行/);
  assert.equal(prompt.user.includes(source), true);
});

test('punctuate prompt guards particles, line wraps and blank lines', () => {
  const prompt = getTranscriptPunctuatePrompt('A');
  assert.match(prompt.system, /语气词/);
  assert.match(prompt.system, /不要单独断成一句/);
  assert.match(prompt.system, /同一说话人内/);
  assert.match(prompt.system, /保留原文的空行分隔/);
  assert.match(prompt.user, /^会议逐字稿：\n\n---\n/);
});
