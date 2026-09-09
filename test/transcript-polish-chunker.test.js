const assert = require('node:assert/strict');
const test = require('node:test');

const { splitTranscriptForPolish } = require('../lib/ai-feedback');

test('short transcript returns a single chunk equal to the trimmed input', () => {
  const text = '  说话人 1：你好，欢迎来到今天的分享。\n说话人 2：谢谢！  ';
  const chunks = splitTranscriptForPolish(text, 4000);

  assert.deepEqual(chunks, [text.trim()]);
});

test('multi-line speaker transcript round-trips byte-for-byte when no line exceeds the cap', () => {
  const text = [
    '说话人 1：这个功能需要在月底前上线。',
    '说话人 2：好的，我会在下周完成第一版。',
    '说话人 1：记得把会议结论同步到群里。',
    '说话人 3：没问题，我来跟进。'
  ].join('\n');
  const chunks = splitTranscriptForPolish(text, 30);

  assert.ok(chunks.length > 1, 'expected multiple chunks');
  assert.ok(chunks.every(chunk => chunk.length <= 30));
  assert.equal(chunks.join('\n'), text.trim());
});

test('empty or blank input returns no chunks', () => {
  assert.deepEqual(splitTranscriptForPolish(''), []);
  assert.deepEqual(splitTranscriptForPolish('   \n  '), []);
  assert.deepEqual(splitTranscriptForPolish(null), []);
  assert.deepEqual(splitTranscriptForPolish(undefined), []);
});

test('blank-line separators between speakers survive the round-trip', () => {
  const text = '说话人 1：a\n\n说话人 2：b';
  const chunks = splitTranscriptForPolish(text, 12);

  assert.equal(chunks.join('\n'), text.trim());

  // 首尾空行属于外层空白，被整体 trim 掉；内部空行分隔原样保留
  const padded = '\n\n说话人 1：a\n\n说话人 2：b\n\n';
  const paddedChunks = splitTranscriptForPolish(padded, 12);
  assert.equal(paddedChunks.join('\n'), padded.trim());
  assert.equal(paddedChunks.join('\n'), text);
});

test('a single overlong line is split only at sentence boundaries, every piece ≤ maxChars', () => {
  const line = '甲'.repeat(9) + '。' + '乙'.repeat(8) + '！' + '丙'.repeat(7) + '？';
  const chunks = splitTranscriptForPolish(line, 20);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 20));
  // 句中只插入断点：拼接回来内容与顺序完全一致
  assert.equal(chunks.join(''), line);
});

test('overlong lines with no sentence end in the window are hard-cut, longer tails re-split', () => {
  // 整个窗口内没有句末标点 → 前段按 maxChars 硬切
  const hard = '甲'.repeat(25) + '。';
  const hardChunks = splitTranscriptForPolish(hard, 20);
  assert.ok(hardChunks.every(chunk => chunk.length <= 20));
  assert.equal(hardChunks.join(''), hard);

  // 三个短句连成长行 → while 循环在句末标点处逐段重切
  const line = ('甲'.repeat(14) + '。').repeat(3);
  const chunks = splitTranscriptForPolish(line, 20);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 20));
  assert.equal(chunks.join(''), line);
});
