const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { analyzeAudioFile, buildConversationAnalysis } = require('../lib/audio-analysis');

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

test('buildConversationAnalysis combines sentiment, clarity, participation, and interaction signals', () => {
  const result = buildConversationAnalysis({
    durationSeconds: 20,
    speechRatio: 0.8,
    energyChangeCount: 4,
    speechFrameCount: 100,
    pitchVariationHz: 12,
    timeline: [],
    interpretation: { energy: '中等', pauseLoad: '常规', stability: '相对稳定' }
  }, {
    text: '说话人 1：我支持这个方案，下一步今天确定。\n说话人 2：我担心风险，可能需要再看一下。哈哈。',
    speaker_segments: [
      { speaker: '说话人 1', start: 0, end: 5, text: '我支持这个方案，下一步今天确定。' },
      { speaker: '说话人 2', start: 5.5, end: 10, text: '我担心风险，可能需要再看一下。哈哈。' }
    ]
  });

  assert.equal(result.atmosphere.sentiment.agreement, 1);
  assert.equal(result.atmosphere.sentiment.concern, 2);
  assert.equal(result.atmosphere.nonVerbal.laughterCount, 1);
  assert.equal(result.interaction.speakerCount, 2);
  assert.equal(result.interaction.turnCount, 2);
  assert.equal(result.clarity.hedgeCount, 0, 'a calibrated possibility is not a hedging defect');
  assert.equal(result.clarity.informationDensity, 1);
});

test('analysis keeps participation but no longer computes per-speaker acoustics or emotions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-speaker-analysis-'));
  const filePath = path.join(dir, 'meeting.wav');
  writeTestWav(filePath);

  const analysis = analyzeAudioFile(filePath, [
    { speaker: '说话人 1', start: 0.5, end: 1.1, text: '我支持。' },
    { speaker: '说话人 2', start: 1.2, end: 1.8, text: '我担心风险。' }
  ]);

  assert.equal(analysis.speakerAcoustics, undefined);
  const conversation = buildConversationAnalysis(analysis, { speaker_segments: [
    { speaker: 'A', start: 0, end: 1, text: '支持。' },
    { speaker: 'B', start: 1, end: 2, text: '担心。' }
  ] });
  assert.equal(conversation.interaction.speakers.length, 2);
  for (const speaker of conversation.interaction.speakers) {
    assert.equal(speaker.sentiment, undefined);
    assert.equal(speaker.dominantSignals, undefined);
    assert.equal(speaker.acoustics, undefined);
    assert.equal(speaker.participation, 0.5);
  }
});
