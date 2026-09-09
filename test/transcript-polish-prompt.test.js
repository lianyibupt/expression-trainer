const assert = require('node:assert/strict');
const test = require('node:test');

const { getTranscriptPolishPrompt } = require('../lib/prompts');

test('transcript polish prompt only fixes ASR errors and preserves spoken content', () => {
  const source = '说话人 1：那个我们嗯下周上线吧。';
  const prompt = getTranscriptPolishPrompt(source);

  assert.match(prompt.system, /只修正语音识别造成的错误/);
  assert.match(prompt.system, /填充词/);
  assert.match(prompt.system, /说话人标签/);
  assert.match(prompt.system, /【？】/);
  assert.match(prompt.system, /只输出修正后的全文/);
  assert.equal(prompt.user.includes(source), true);
});

test('transcript polish prompt carries an optional glossary hint', () => {
  const prompt = getTranscriptPolishPrompt('hello', { glossary: 'A/B test' });
  assert.match(prompt.system, /A\/B test/);
});
