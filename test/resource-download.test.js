const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { downloadFile, safeResourcePath } = require('../lib/resource-download');

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
async function fixture(t, handler) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-download-'));
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, url: `http://127.0.0.1:${server.address().port}/model` };
}

test('downloads are atomic, verified, and reused without another request', async t => {
  const body = Buffer.from('a complete local model'); let requests = 0;
  const { root, url } = await fixture(t, (_req, res) => { requests++; res.end(body); });
  const destination = path.join(root, 'model.bin'); const progress = [];
  const options = { url, destination, size: body.length, sha256: sha(body), allowHttp: true, onProgress: value => progress.push(value) };
  await downloadFile(options);
  assert.deepEqual(fs.readFileSync(destination), body);
  assert.equal(fs.existsSync(destination + '.part'), false);
  assert.equal(progress.at(-1).received, body.length);
  await downloadFile(options); assert.equal(requests, 1);
});

test('resumes an interrupted file and verifies the complete result', async t => {
  const body = Buffer.from('0123456789abcdef'); let range;
  const { root, url } = await fixture(t, (req, res) => {
    range = req.headers.range;
    res.writeHead(206, { 'Content-Range': `bytes 5-${body.length - 1}/${body.length}` }); res.end(body.subarray(5));
  });
  const destination = path.join(root, 'model'); fs.writeFileSync(destination + '.part', body.subarray(0, 5));
  await downloadFile({ url, destination, size: body.length, sha256: sha(body), allowHttp: true });
  assert.equal(range, 'bytes=5-'); assert.deepEqual(fs.readFileSync(destination), body);
});

test('a checksum mismatch never becomes an installed file', async t => {
  const { root, url } = await fixture(t, (_req, res) => res.end('bad'));
  const destination = path.join(root, 'model');
  await assert.rejects(downloadFile({ url, destination, size: 3, sha256: sha('yes'), allowHttp: true }), /校验/);
  assert.equal(fs.existsSync(destination), false);
  assert.equal(fs.existsSync(destination + '.part'), false);
});

test('rejects insecure sources, invalid ranges and paths escaping the resource directory', async t => {
  const { root, url } = await fixture(t, (_req, res) => { res.writeHead(206, { 'Content-Range': 'bytes 1-3/4' }); res.end('bad'); });
  await assert.rejects(downloadFile({ url, destination: path.join(root, 'x'), size: 4, sha256: sha('good') }), /HTTPS/);
  await assert.rejects(downloadFile({ url, destination: path.join(root, 'x'), size: 4, sha256: sha('good'), allowHttp: true }), /范围/);
  for (const value of ['../secret', '/absolute', 'a/../../escape']) assert.throws(() => safeResourcePath(root, value), /路径/);
  assert.equal(safeResourcePath(root, 'models/a.bin'), path.join(root, 'models', 'a.bin'));
});
