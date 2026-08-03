const assert = require('node:assert/strict');
const test = require('node:test');

const { mixFloat32Samples } = require('../lib/audio-mix');

test('mixFloat32Samples averages microphone and system samples', () => {
  const mixed = mixFloat32Samples([
    new Float32Array([0.2, 0.4, -0.4]),
    new Float32Array([0.4, 0.2, -0.2])
  ]);

  assert.deepEqual(Array.from(mixed), [0.30000001192092896, 0.30000001192092896, -0.30000001192092896]);
});

test('mixFloat32Samples pads shorter streams with silence', () => {
  const mixed = mixFloat32Samples([
    new Float32Array([0.4, 0.4]),
    new Float32Array([0.2])
  ]);

  assert.deepEqual(Array.from(mixed), [0.30000001192092896, 0.20000000298023224]);
});

test('mixFloat32Samples clamps output samples', () => {
  const mixed = mixFloat32Samples([
    new Float32Array([2]),
    new Float32Array([2])
  ]);

  assert.deepEqual(Array.from(mixed), [1]);
});
