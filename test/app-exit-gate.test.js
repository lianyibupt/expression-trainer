const assert = require('node:assert/strict');
const test = require('node:test');
const { AppExitGate } = require('../lib/app-exit-gate');

test('exit gate emits one renderer request and blocks until approved', () => {
  let requests = 0;
  const gate = new AppExitGate(() => { requests += 1; });
  assert.equal(gate.request(), false);
  assert.equal(gate.request(), false);
  assert.equal(requests, 1);
  gate.approve();
  assert.equal(gate.request(), true);
});

test('cancel returns the gate to idle', () => {
  let requests = 0;
  const gate = new AppExitGate(() => { requests += 1; });
  gate.request();
  gate.cancel();
  gate.request();
  assert.equal(requests, 2);
});

test('a renderer readiness handshake redelivers an early exit request', () => {
  let requests = 0;
  const gate = new AppExitGate(() => { requests++; });
  gate.request();
  gate.rendererReady();
  assert.equal(requests, 2);
  gate.approve(); gate.rendererReady();
  assert.equal(requests, 2);
});
