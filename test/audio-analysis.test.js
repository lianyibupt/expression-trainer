const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { analyzeAudioFile } = require('../lib/audio-analysis');

function writeTestWav(filePath) {
  const sampleRate = 16000;
  const samples = new Int16Array(sampleRate * 2);
  for (let i = sampleRate / 2; i < samples.length; i++) {
    samples[i] = Math.round(Math.sin(i / 8) * 12000);
  }
  const dataBytes = samples.byteLength;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, Buffer.from(samples.buffer)]));
}

test('analyzeAudioFile reports duration, speech ratio, and pause load', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-audio-analysis-'));
  const filePath = path.join(dir, 'meeting.wav');
  writeTestWav(filePath);

  const analysis = analyzeAudioFile(filePath);

  assert.equal(analysis.durationSeconds, 2);
  assert.ok(analysis.speechRatio > 0.4 && analysis.speechRatio < 0.8);
  assert.equal(analysis.interpretation.pauseLoad, '常规');
  assert.equal(analysis.sampleRate, 16000);
  assert.equal(analysis.timeline.length, 1);
  assert.equal(analysis.timeline[0].label, '相对平稳');
});
