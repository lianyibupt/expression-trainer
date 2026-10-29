const assert = require('node:assert/strict');
const test = require('node:test');

test('long tasks report the current stage and stop heartbeats after completion or failure', t => {
  const { startTask } = require('../lib/runtime-log');
  const lines = [];
  t.mock.method(console, 'log', line => lines.push(line));
  t.mock.method(console, 'error', line => lines.push(line));
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const a = startTask('ASR', '最终转写', { jobId: 'a' });
  const b = startTask('AI', '会议纪要', { jobId: 'b' });
  a.update('说话人分离', { processedSeconds: 10, totalSeconds: 60 });
  t.mock.timers.tick(15000);
  assert.ok(lines.some(line => /仍在处理.*说话人分离/.test(line) && /jobId="a"/.test(line)));
  a.done({ textChars: 12 });
  b.fail(new Error('private transcript and secret-key'));
  const count = lines.length;
  t.mock.timers.tick(30000);
  a.done();
  assert.equal(lines.length, count);
  assert.ok(lines.some(line => /完成.*elapsedSec=15/.test(line)));
  assert.ok(lines.some(line => /ERROR.*会议纪要.*失败/.test(line)));
  assert.ok(!lines.join('\n').includes('private transcript'));
  assert.ok(!lines.join('\n').includes('secret-key'));
});

test('runtime metadata excludes content, credentials and untrusted extra fields', t => {
  const { log } = require('../lib/runtime-log');
  const lines = [];
  t.mock.method(console, 'log', line => lines.push(line));
  log('AI', '发送请求', { sessionId: 'a\nforged-line', textChars: 12,
    apiKey: 'secret-key', fullText: 'private transcript', endpoint: 'https://u:password@example.test/?key=secret' });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[\d{4}-\d{2}-\d{2} /);
  assert.match(lines[0], /\[INFO\] \[AI\]/);
  assert.ok(!lines[0].includes('\n'));
  assert.match(lines[0], /textChars=12/);
  assert.ok(!/secret|private|password/.test(lines[0]));
});
