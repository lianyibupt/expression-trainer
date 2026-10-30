const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ResourceManager } = require('../lib/resource-manager');

test('only validated resources are ready, and a failed transfer can be retried', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-manager-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from('model'); let fail = true;
  const catalog = [{ id: 'model', label: '模型', kind: 'model', directory: 'models/test', files: [{ path: 'model.bin', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), url: 'https://example.com/model' }] }];
  const manager = new ResourceManager({ root, catalog, download: async ({ destination }) => {
    if (fail) throw new Error('网络中断'); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, bytes);
  } });
  assert.equal(manager.status()[0].ready, false);
  await assert.rejects(manager.install('model'), /网络中断/);
  assert.equal(manager.status()[0].ready, false);
  fail = false; await manager.install('model'); assert.equal(manager.status()[0].ready, true);
  fs.unlinkSync(path.join(root, 'models/test/model.bin'));
  assert.equal(manager.status()[0].ready, false);
  await assert.rejects(manager.install('../anything'), /未知资源/);
});

test('cancel aborts the active task and does not mark an unfinished model ready', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-cancel-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = new ResourceManager({ root, catalog: [{ id: 'model', label: '模型', kind: 'model', directory: 'models/test', files: [{ path: 'a', size: 1, sha256: 'a'.repeat(64), url: 'https://example.com/a' }] }], download: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  const job = manager.install('model'); await new Promise(resolve => setImmediate(resolve)); manager.cancel();
  await assert.rejects(job, /取消/); assert.equal(manager.status()[0].ready, false);
});
