const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');

test('cancelling an uploaded-audio job does not cancel another meeting finalization', async () => {
  const sourcePath = path.join(__dirname, '../lib/asr.js');
  const nativeRequire = createRequire(sourcePath);
  const children = [];
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = child.stderr.setEncoding = () => {};
    child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('exit', 1)); };
    children.push(child);
    return child;
  };
  const sandbox = { module: { exports: {} }, __dirname: path.dirname(sourcePath), console,
    Buffer, process, setTimeout, clearTimeout,
    require: name => name === 'child_process' ? { spawn } : nativeRequire(name) };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8') + '\nmodule.exports.runWorker = transcribeWithQwen3Python;', sandbox);
  const { runWorker, cancelQwen3Transcription } = sandbox.module.exports;
  const a = runWorker(new Float32Array(10), 'model', { jobId: 'meeting-a-final' });
  const b = runWorker(new Float32Array(10), 'model', { jobId: 'meeting-b-upload' });
  const rejection = assert.rejects(b, /exited with code 1/);
  assert.equal(cancelQwen3Transcription('meeting-b-upload'), true);
  assert.equal(children[0].killed, undefined);
  assert.equal(children[1].killed, true);
  children[0].stdout.emit('data', '{"text":"A final"}\n');
  children[0].emit('exit', 0);
  assert.equal((await a).text, 'A final');
  await rejection;
  assert.equal(cancelQwen3Transcription('meeting-b-upload'), false);
  assert.equal(cancelQwen3Transcription('unknown'), false);
});

test('Qwen workers use the local model cache without network probes by default', async () => {
  const sourcePath = path.join(__dirname, '../lib/asr.js');
  const nativeRequire = createRequire(sourcePath);
  let spawnOptions;
  const spawn = (command, args, options) => {
    spawnOptions = options;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = child.stderr.setEncoding = () => {};
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.emit('data', '{"text":"local final"}\n');
      child.emit('exit', 0);
    });
    return child;
  };
  const sandbox = { module: { exports: {} }, __dirname: path.dirname(sourcePath), console,
    Buffer, process, setTimeout, clearTimeout,
    require: name => name === 'child_process' ? { spawn } : nativeRequire(name) };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8') + '\nmodule.exports.runWorker = transcribeWithQwen3Python;', sandbox);

  await sandbox.module.exports.runWorker(new Float32Array(10), 'model', { jobId: 'offline' });

  assert.equal(spawnOptions.env.HF_HUB_OFFLINE, '1');
  assert.equal(spawnOptions.env.TRANSFORMERS_OFFLINE, '1');
});
