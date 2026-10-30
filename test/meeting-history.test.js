const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listMeetingHistory, readMeetingHistory } = require('../lib/meeting-history');
const { createTranscriptArtifact, saveReportArtifact, saveMinutesArtifact, saveAudioArtifact } = require('../lib/meeting-session');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-history-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('old default titles derive from transcripts without writes and content is searchable', t => {
  const rootDir = fixture(t);
  const saved = createTranscriptArtifact({ rootDir, sessionId: 'old', title: '会议 1', startedAt: '2026-01-01T00:00:00Z',
    transcript: '说话人 1：大家好。今天主要讨论搜索系统迁移方案。稍后还要确认回滚预案。' });
  const before = fs.readFileSync(saved.metadataPath, 'utf8');
  const rows = listMeetingHistory(rootDir, { query: '回滚' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, '搜索系统迁移方案');
  assert.equal(readMeetingHistory(rootDir, rows[0].archiveId).title, rows[0].title);
  assert.equal(fs.readFileSync(saved.metadataPath, 'utf8'), before);
});

test('custom titles are preserved while searching transcript and minutes content', t => {
  const rootDir = fixture(t);
  const saved = createTranscriptArtifact({ rootDir, title: '例会', transcript: '搜索系统迁移。' });
  saveMinutesArtifact({ sessionDir: saved.sessionDir, minutes: '待办：准备回滚演练。' });
  assert.equal(listMeetingHistory(rootDir, { query: '搜索系统' })[0].title, '例会');
  assert.equal(listMeetingHistory(rootDir, { query: '回滚演练' }).length, 1);
});

test('saved meetings reopen exact text and artifact versions after a new history read', t => {
  const rootDir = fixture(t);
  const identity = { sessionId: 'meeting-a', title: '项目评审', startedAt: '2026-10-30T08:00:00Z', transcriptRevision: 3, transcriptSource: 'edited' };
  const original = '第一段\n\n---\n\n保留原文里的分隔线。<img src=x>';
  const saved = createTranscriptArtifact({ rootDir, transcript: original, stats: { totalWords: 50 }, ...identity });
  saveReportArtifact({ ...identity, sessionDir: saved.sessionDir, transcript: '旧稿', transcriptRevision: 2, report: '# 报告\n\n保留版本', stats: { totalWords: 20 } });
  saveMinutesArtifact({ ...identity, sessionDir: saved.sessionDir, transcript: original, minutes: '# 会议纪要\n\n- 待确认' });
  const rows = listMeetingHistory(rootDir);
  assert.equal(rows.length, 1);
  assert.equal(listMeetingHistory(rootDir, { query: '评审' }).length, 1);
  assert.equal(listMeetingHistory(rootDir, { query: '不存在' }).length, 0);
  const restored = readMeetingHistory(rootDir, rows[0].archiveId);
  assert.equal(restored.transcript, original);
  assert.equal(restored.report, '# 报告\n\n保留版本');
  assert.equal(restored.minutes, '# 会议纪要\n\n- 待确认');
  assert.equal(restored.snapshots.report.transcriptRevision, 2);
  assert.equal(restored.metadata.transcriptRevision, 3);
  assert.equal(restored.metadata.stats.totalWords, 50);
});

test('legacy Markdown archives load without migration writes and malformed metadata is skipped', t => {
  const rootDir = fixture(t);
  const dir = path.join(rootDir, '2026-08-01-120000');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ createdAt: '2026-08-01T04:00:00Z', files: { transcript: 'transcript.md', report: 'report.md' } }));
  fs.writeFileSync(path.join(dir, 'transcript.md'), '# 原始对话\n\n**时间**: 日期\n\n---\n\n旧版原文\n');
  fs.writeFileSync(path.join(dir, 'report.md'), '# 历史报告\n\n正文');
  fs.mkdirSync(path.join(rootDir, 'broken'));
  fs.writeFileSync(path.join(rootDir, 'broken/metadata.json'), '{bad');
  const before = fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8');
  const rows = listMeetingHistory(rootDir);
  assert.equal(rows.length, 1);
  const restored = readMeetingHistory(rootDir, rows[0].archiveId);
  assert.equal(restored.transcript, '旧版原文');
  assert.match(restored.report, /正文/);
  assert.match(restored.sessionId, /^[A-Za-z0-9-]+$/);
  assert.equal(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'), before);
});

test('history rejects traversal and symlinked directories or artifact files', t => {
  const rootDir = fixture(t), outside = fixture(t);
  fs.writeFileSync(path.join(outside, 'private.txt'), 'private');
  fs.symlinkSync(outside, path.join(rootDir, 'linked'));
  assert.throws(() => readMeetingHistory(rootDir, '../outside'));
  assert.throws(() => readMeetingHistory(rootDir, 'linked'));
  const dir = path.join(rootDir, 'safe'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ files: { transcript: '../private.txt' } }));
  assert.throws(() => readMeetingHistory(rootDir, 'safe'));
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ files: { transcript: 'transcript.md' } }));
  fs.symlinkSync(path.join(outside, 'private.txt'), path.join(dir, 'transcript.md'));
  assert.throws(() => readMeetingHistory(rootDir, 'safe'));
});

test('restored legacy meeting saves into its existing archive and keeps the archived audio', t => {
  const rootDir = fixture(t), sessionDir = path.join(rootDir, 'legacy'); fs.mkdirSync(sessionDir);
  fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({ files: {} }));
  const result = createTranscriptArtifact({ rootDir, sessionDir, sessionId: 'legacy-id', startedAt: '2026-01-01T00:00:00Z', transcript: '编辑后' });
  assert.equal(result.sessionDir, fs.realpathSync(sessionDir));
  assert.equal(fs.readdirSync(rootDir).length, 1);
});

test('saving refuses unreferenced symlink destinations without overwriting outside files', t => {
  const rootDir = fixture(t), outside = path.join(fixture(t), 'outside.txt');
  fs.writeFileSync(outside, 'outside original');
  const identity = { sessionId: 'safe', startedAt: '2026-01-01T00:00:00Z', transcript: 'original' };
  const saved = createTranscriptArtifact({ rootDir, ...identity });
  for (const name of ['transcript.txt', 'transcript.md', 'metadata.json', 'report.md', 'report-content.md', 'minutes.md', 'minutes-content.md', 'meeting.wav', 'audio-analysis.json', 'audio-analysis.md']) {
    const target = path.join(saved.sessionDir, name);
    const original = fs.existsSync(target) ? fs.readFileSync(target) : null;
    fs.rmSync(target, { force: true }); fs.symlinkSync(outside, target);
    const operation = name.startsWith('report')
      ? () => saveReportArtifact({ ...identity, sessionDir: saved.sessionDir, report: 'changed' })
      : name.startsWith('minutes')
        ? () => saveMinutesArtifact({ ...identity, sessionDir: saved.sessionDir, minutes: 'changed' })
        : name === 'meeting.wav' || name.startsWith('audio-analysis')
          ? () => saveAudioArtifact({ sessionDir: saved.sessionDir, audioPath: outside, audioAnalysis: {} })
          : () => createTranscriptArtifact({ rootDir, sessionDir: saved.sessionDir, ...identity, transcript: 'changed' });
    assert.throws(operation, /链接|文件|JSON|Unexpected/);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'outside original');
    fs.unlinkSync(target); if (original) fs.writeFileSync(target, original);
  }
});
