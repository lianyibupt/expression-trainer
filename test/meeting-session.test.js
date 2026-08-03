const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createMeetingArtifacts, createTranscriptArtifact, saveReportArtifact } = require('../lib/meeting-session');

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
