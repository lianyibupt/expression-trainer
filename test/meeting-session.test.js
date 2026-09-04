const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createMeetingArtifacts, createTranscriptArtifact, saveMinutesArtifact, saveReportArtifact, saveAudioArtifact } = require('../lib/meeting-session');

test('meeting saves reuse only their own folder and include recording identity', t => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-identity-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const identity = { sessionId: 'meeting-a', title: 'Planning', startedAt: '2026-09-03T01:00:00Z', endedAt: '2026-09-03T02:00:00Z', transcriptRevision: 3, transcriptSource: 'edited' };
  const a = createTranscriptArtifact({ ...identity, rootDir, transcript: 'A', now: new Date('2026-09-04T03:00:00Z') });
  const b = createTranscriptArtifact({ ...identity, sessionId: 'meeting-b', rootDir, transcript: 'B' });
  assert.notEqual(a.sessionDir, b.sessionDir);
  const updated = createTranscriptArtifact({ ...identity, rootDir, transcript: 'updated A' });
  assert.equal(updated.sessionDir, a.sessionDir);
  assert.match(fs.readFileSync(a.transcriptPath, 'utf8'), /meeting-a/);
  assert.match(fs.readFileSync(a.transcriptPath, 'utf8'), /Planning/);
  assert.match(fs.readFileSync(b.transcriptPath, 'utf8'), /\nB\n/);
  const metadata = JSON.parse(fs.readFileSync(a.metadataPath, 'utf8'));
  assert.equal(metadata.startedAt, identity.startedAt);
  assert.equal(metadata.transcriptRevision, 3);
  assert.throws(() => saveReportArtifact({ ...identity, sessionId: 'meeting-b', sessionDir: a.sessionDir, report: 'wrong report' }), /ownership mismatch/);
  assert.equal(fs.existsSync(path.join(a.sessionDir, 'report.md')), false);
  assert.throws(() => saveMinutesArtifact({ ...identity, sessionId: 'meeting-b', sessionDir: a.sessionDir, minutes: 'wrong minutes' }), /ownership mismatch/);
  assert.equal(fs.existsSync(path.join(a.sessionDir, 'minutes.md')), false);
});

test('createMeetingArtifacts saves transcript, report, and metadata in a session folder', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-session-'));
  const now = new Date(2026, 7, 3, 9, 10, 11);

  const result = createMeetingArtifacts({
    rootDir,
    now,
    transcript: '今天我们讨论自动录音，然后生成表达报告。',
    report: '## 总评\n\n表达清晰。',
    stats: { duration: 65, totalWords: 21, fillers: 1, hedges: 0, vagueWords: 0 }
  });

  assert.equal(path.basename(result.sessionDir), '2026-08-03-091011');
  assert.equal(fs.readFileSync(result.transcriptPath, 'utf8'), '# 原始对话\n\n**时间**: 2026-08-03 09:10:11\n**时长**: 65秒\n**总字数**: 21\n\n---\n\n今天我们讨论自动录音，然后生成表达报告。\n');
  assert.equal(fs.readFileSync(result.reportPath, 'utf8'), '# 对话分析报告\n\n**时间**: 2026-08-03 09:10:11\n**时长**: 65秒\n**总字数**: 21\n\n---\n\n## 原始对话\n\n今天我们讨论自动录音，然后生成表达报告。\n\n---\n\n## 总评\n\n表达清晰。\n');

  const metadata = JSON.parse(fs.readFileSync(result.metadataPath, 'utf8'));
  assert.deepEqual(metadata.stats, { duration: 65, totalWords: 21, fillers: 1, hedges: 0, vagueWords: 0 });
  assert.equal(metadata.files.transcript, 'transcript.md');
  assert.equal(metadata.files.report, 'report.md');
});

test('createMeetingArtifacts avoids overwriting an existing session folder', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-session-'));
  fs.mkdirSync(path.join(rootDir, '2026-08-03-091011'));

  const result = createMeetingArtifacts({
    rootDir,
    now: new Date(2026, 7, 3, 9, 10, 11),
    transcript: '第二场会议',
    report: '报告',
    stats: {}
  });

  assert.equal(path.basename(result.sessionDir), '2026-08-03-091011-2');
});

test('transcript and report can be saved in two separate steps', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-session-'));
  const stats = { duration: 10, totalWords: 8, fillers: 0, hedges: 0, vagueWords: 1 };

  const transcriptResult = createTranscriptArtifact({
    rootDir,
    now: new Date(2026, 7, 3, 9, 10, 11),
    transcript: '先保存原始对话。',
    stats
  });

  assert.equal(fs.existsSync(transcriptResult.transcriptPath), true);
  assert.equal(fs.existsSync(path.join(transcriptResult.sessionDir, 'report.md')), false);

  const reportResult = saveReportArtifact({
    sessionDir: transcriptResult.sessionDir,
    transcript: '先保存原始对话。',
    report: '## 总评\n\n再保存报告。',
    stats,
    createdAt: '2026-08-03T01:10:11.000Z'
  });

  assert.equal(reportResult.reportPath, path.join(transcriptResult.sessionDir, 'report.md'));
  assert.match(fs.readFileSync(reportResult.reportPath, 'utf8'), /再保存报告/);

  const metadata = JSON.parse(fs.readFileSync(transcriptResult.metadataPath, 'utf8'));
  assert.equal(metadata.files.transcript, 'transcript.md');
  assert.equal(metadata.files.report, 'report.md');
});

test('minutes can be saved and updated in an existing session folder', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-session-'));
  const transcriptResult = createTranscriptArtifact({
    rootDir,
    now: new Date(2026, 7, 11, 18, 10, 11),
    transcript: '会议原文',
    stats: { duration: 30, totalWords: 8 }
  });

  const first = saveMinutesArtifact({
    sessionDir: transcriptResult.sessionDir,
    minutes: '# 会议纪要\n\n第一版',
    stats: { duration: 30, totalWords: 8 }
  });
  const second = saveMinutesArtifact({
    sessionDir: transcriptResult.sessionDir,
    minutes: '# 会议纪要\n\n第二版',
    stats: { duration: 30, totalWords: 8 }
  });

  assert.equal(first.minutesPath, path.join(transcriptResult.sessionDir, 'minutes.md'));
  assert.equal(second.minutesPath, first.minutesPath);
  assert.match(fs.readFileSync(first.minutesPath, 'utf8'), /第二版/);

  const metadata = JSON.parse(fs.readFileSync(transcriptResult.metadataPath, 'utf8'));
  assert.equal(metadata.files.minutes, 'minutes.md');
});

test('audio artifact copies the recording and stores local analysis metadata', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-session-'));
  const sourcePath = path.join(rootDir, 'source.wav');
  fs.writeFileSync(sourcePath, Buffer.from('wav-test'));
  const transcriptResult = createTranscriptArtifact({
    rootDir,
    transcript: '会议原文',
    stats: { duration: 2 }
  });
  const analysis = { version: 1, speechRatio: 0.5 };

  const result = saveAudioArtifact({
    sessionDir: transcriptResult.sessionDir,
    audioPath: sourcePath,
    audioAnalysis: analysis
  });

  assert.equal(fs.readFileSync(result.audioPath, 'utf8'), 'wav-test');
  assert.deepEqual(JSON.parse(fs.readFileSync(result.audioAnalysisPath, 'utf8')), analysis);
  assert.match(fs.readFileSync(result.audioAnalysisMarkdownPath, 'utf8'), /有效发言占比：50%/);
  const metadata = JSON.parse(fs.readFileSync(transcriptResult.metadataPath, 'utf8'));
  assert.equal(metadata.files.audio, 'meeting.wav');
  assert.equal(metadata.files.audioAnalysis, 'audio-analysis.json');
});
