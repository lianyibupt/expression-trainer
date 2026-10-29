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

test('worker progress and speaker fallback reach the terminal without logging transcript contents', async t => {
  const lines = [];
  for (const method of ['log', 'warn', 'error']) t.mock.method(console, method, line => lines.push(line));
  const sourcePath = path.join(__dirname, '../lib/asr.js');
  const nativeRequire = createRequire(sourcePath);
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = child.stderr.setEncoding = () => {};
  const sandbox = { module: { exports: {} }, __dirname: path.dirname(sourcePath), console,
    Buffer, process, setTimeout, clearTimeout,
    require: name => name === 'child_process' ? { spawn: () => child } : nativeRequire(name) };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8') + '\nmodule.exports.runWorker = transcribeWithQwen3Python;', sandbox);
  const progress = [];
  const pending = sandbox.module.exports.runWorker(new Float32Array(16000), 'model', {
    jobId: 'test-job', onProgress: payload => progress.push(payload.stage)
  });
  child.stdout.emit('data', '{"progress":true,"stage":"transcri');
  child.stdout.emit('data', 'bing","processedSeconds":1,"totalSeconds":1}\n');
  child.stdout.emit('data', '{"text":"private transcript","speaker_error":"sensitive error","speaker_count":0}\n');
  child.emit('exit', 0);
  assert.equal((await pending).text, 'private transcript');
  assert.deepEqual(progress, ['loading-model', 'transcribing']);
  assert.ok(lines.some(line => /音频转写/.test(line) && /jobId="test-job"/.test(line)));
  assert.ok(lines.some(line => /说话人分离失败/.test(line)));
  assert.ok(lines.some(line => /完成/.test(line) && /textChars=18/.test(line)));
  assert.ok(!/private transcript|sensitive error/.test(lines.join('\n')));
});
