const assert = require('node:assert/strict');
const test = require('node:test');

const { segmentLine, segmentTranscript } = require('../lib/sentence-segment');

test('unpunctuated Chinese text gets one sentence per line with terminal periods', () => {
  const input = '我们这次会议主要讨论下周的上线计划然后还要同步一下人力安排所以请大家提前准备好数据';
  const lines = segmentTranscript(input).split('\n').filter(Boolean);
  assert.ok(lines.length >= 3, `expected >=3 sentences, got ${lines.length}: ${lines.join(' | ')}`);
  for (const line of lines) assert.match(line, /[。！？!?]$/);
  // 内容无丢失：去掉句末标点后拼接 == 输入
  const content = lines.map(l => l.replace(/[。！？!?]$/, '')).join('');
  assert.equal(content, input);
});

test('already punctuated text is respected without duplicated endings', () => {
  const input = '你好。然后我们去开会吧？下周见。';
  const out = segmentTranscript(input);
  assert.equal(out.includes('你好。'), true);
  assert.equal(out.includes('下周见。'), true);
  assert.doesNotMatch(out, /。。/);
  assert.equal(out.split('\n').filter(Boolean).length >= 2, true);
});

test('English-dominant sentences end with an ASCII period', () => {
  const input = 'we need to ship this release today and tomorrow we will discuss the roadmap with the team';
  const lines = segmentTranscript(input).split('\n').filter(Boolean);
  assert.ok(lines.length >= 2);
  for (const line of lines) assert.match(line, /[.!?]$/);
});

test('mixed zh/en keeps speaker labels and blank lines and never merges lines', () => {
  const input = '说话人 1：我们先看需求然后你补充一下细节\n\n说话人 2：好的 没问题';
  const out = segmentTranscript(input);
  assert.match(out, /说话人 1：/);
  assert.match(out, /说话人 2：/);
  assert.equal(out.includes('\n\n'), true);
});

test('declarative sentences keep 。 while clear questions get ？', () => {
  const input = '你觉得这个方案整体上是可行吗我们要不要先做一个小范围的实验来验证';
  const lines = segmentTranscript(input).split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '你觉得这个方案整体上是可行吗？');
  assert.equal(lines[1], '我们要不要先做一个小范围的实验来验证。');
});

test('segmentLine returns [] for empty/whitespace input', () => {
  assert.deepEqual(segmentLine('   '), []);
  assert.deepEqual(segmentLine(''), []);
});
