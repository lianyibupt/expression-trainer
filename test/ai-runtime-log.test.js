const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { sendMeetingMinutes } = require('../lib/ai-feedback');

test('real HTTP requests report chunk progress, status and failure without disclosing request or response text', async t => {
  const lines = [];
  for (const method of ['log', 'error']) t.mock.method(console, method, line => lines.push(line));
  let requests = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    requests++;
    if (requests === 4) {
      res.writeHead(429);
      res.end('private provider error');
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'private result' } }] }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const settings = { provider: 'custom', baseUrl: `http://127.0.0.1:${server.address().port}`,
    apiKey: 'private-key', customModel: 'test-model' };
  assert.equal(await sendMeetingMinutes('密'.repeat(12001), {}, settings), 'private result');
  await assert.rejects(sendMeetingMinutes('private transcript', {}, settings), /429/);
  assert.ok(lines.some(line => /片段 1\/2/.test(line)));
  assert.ok(lines.some(line => /片段 2\/2/.test(line)));
  assert.ok(lines.some(line => /汇总/.test(line)));
  assert.ok(lines.some(line => /失败/.test(line) && /httpStatus=429/.test(line)));
  assert.ok(!/private-key|private transcript|private result|private provider error/.test(lines.join('\n')));
});
