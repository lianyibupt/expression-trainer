const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function assertRegularDestination(file) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('归档目标文件不可写入：不允许符号链接或特殊文件');
}

function checkDestinations(directory, names) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('会议归档目录不可写入');
  for (const name of names) assertRegularDestination(path.join(directory, name));
}

function atomicFile(file, write) {
  assertRegularDestination(file);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}-${randomUUID()}.tmp`);
  try { write(temporary); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
}

function writeText(file, text) {
  atomicFile(file, temporary => fs.writeFileSync(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 }));
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatTimestamp(date) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());

  return {
    folder: `${year}-${month}-${day}-${hour}${minute}${second}`,
    display: `${year}-${month}-${day} ${hour}:${minute}:${second}`
  };
}

function getUniqueSessionDir(rootDir, folderName) {
  let candidate = path.join(rootDir, folderName);
  let suffix = 2;

  while (fs.existsSync(candidate)) {
    candidate = path.join(rootDir, `${folderName}-${suffix}`);
    suffix += 1;
  }

  return candidate;
}

function buildHeader({ timestamp, stats, sessionId, title, startedAt, endedAt, transcriptRevision, transcriptSource }) {
  const duration = Number(stats.duration || 0);
  const totalWords = Number(stats.totalWords || 0);

  const identity = sessionId ? `**会议**: ${String(title || '').replace(/[\r\n]/g, ' ')}\n**会议 ID**: ${sessionId}\n**开始时间**: ${formatTimestamp(new Date(startedAt)).display}\n**结束时间**: ${endedAt ? formatTimestamp(new Date(endedAt)).display : '未结束'}\n**原文版本**: ${transcriptRevision ?? 0} (${transcriptSource || 'realtime'})\n` : '';
  return `${identity}**时间**: ${timestamp.display}\n**时长**: ${duration}秒\n**总字数**: ${totalWords}`;
}

function assertSessionOwnership(metadataPath, sessionId) {
  assertRegularDestination(metadataPath);
  if (!sessionId) return;
  if (!/^[A-Za-z0-9-]{1,80}$/.test(sessionId)) throw new Error('Invalid session ID');
  if (fs.existsSync(metadataPath)) {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (metadata.sessionId && metadata.sessionId !== sessionId) throw new Error('Meeting session ownership mismatch');
  }
}

function writeMetadata(metadataPath, metadata) {
  writeText(metadataPath, JSON.stringify(metadata, null, 2));
}

function createTranscriptArtifact({ rootDir, sessionDir: existingDir, now = new Date(), transcript, stats = {}, ...identity }) {
  if (!rootDir) throw new Error('rootDir is required');

  const { sessionId, startedAt } = identity;
  if (sessionId && (!startedAt || !Number.isFinite(new Date(startedAt).getTime()))) throw new Error('Recording start time is required');
  if (sessionId && !/^[A-Za-z0-9-]{1,80}$/.test(sessionId)) throw new Error('Invalid session ID');
  const timestamp = formatTimestamp(sessionId ? new Date(startedAt) : now);
  const sessionDir = existingDir
    ? require('./meeting-history').resolveArchive(rootDir, path.basename(existingDir))
    : sessionId ? path.join(rootDir, `${timestamp.folder}-${sessionId}`) : getUniqueSessionDir(rootDir, timestamp.folder);
  assertSessionOwnership(path.join(sessionDir, 'metadata.json'), sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  checkDestinations(sessionDir, ['metadata.json', 'transcript.md', 'transcript.txt']);

  const cleanTranscript = String(transcript || '').trim();
  const header = buildHeader({ timestamp, stats, ...identity });
  const transcriptMarkdown = `# 原始对话\n\n${header}\n\n---\n\n${cleanTranscript}\n`;

  const transcriptPath = path.join(sessionDir, 'transcript.md');
  const metadataPath = path.join(sessionDir, 'metadata.json');

  writeText(transcriptPath, transcriptMarkdown);
  writeText(path.join(sessionDir, 'transcript.txt'), cleanTranscript);
  const existing = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, 'utf8')) : {};
  writeMetadata(metadataPath, {
    ...existing,
    ...identity,
    createdAt: existing.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
    stats,
    files: {
      ...existing.files,
      transcript: 'transcript.md', transcriptText: 'transcript.txt'
    }
  });

  return { sessionDir, transcriptPath, metadataPath };
}

function saveReportArtifact({ sessionDir, now = new Date(), createdAt, transcript, report, stats = {}, ...identity }) {
  if (!sessionDir) throw new Error('sessionDir is required');
  checkDestinations(sessionDir, ['metadata.json', 'report.md', 'report-content.md']);

  const timestamp = formatTimestamp(now);
  const cleanTranscript = String(transcript || '').trim();
  const cleanReport = String(report || '').trim();
  const header = buildHeader({ timestamp, stats, ...identity });
  const reportMarkdown = `# 对话分析报告\n\n${header}\n\n---\n\n## 原始对话\n\n${cleanTranscript}\n\n---\n\n${cleanReport}\n`;

  const reportPath = path.join(sessionDir, 'report.md');
  const metadataPath = path.join(sessionDir, 'metadata.json');
  assertSessionOwnership(metadataPath, identity.sessionId);
  let metadata = { createdAt: createdAt || now.toISOString(), stats, files: {} };

  if (fs.existsSync(metadataPath)) {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  }

  metadata.stats ||= stats;
  metadata.files = { ...(metadata.files || {}), report: 'report.md', reportContent: 'report-content.md' };
  metadata.artifactSnapshots = { ...metadata.artifactSnapshots, report: { ...identity, transcript, stats } };

  writeText(reportPath, reportMarkdown);
  writeText(path.join(sessionDir, 'report-content.md'), cleanReport);
  writeMetadata(metadataPath, metadata);

  return { sessionDir, reportPath, metadataPath };
}

function saveMinutesArtifact({ sessionDir, now = new Date(), transcript, minutes, stats = {}, ...identity }) {
  if (!sessionDir) throw new Error('sessionDir is required');
  checkDestinations(sessionDir, ['metadata.json', 'minutes.md', 'minutes-content.md']);

  const minutesPath = path.join(sessionDir, 'minutes.md');
  assertSessionOwnership(path.join(sessionDir, 'metadata.json'), identity.sessionId);
  const cleanMinutes = String(minutes || '').trim();
  const minutesBody = cleanMinutes.replace(/^# 会议纪要\s*/u, '').trim();
  const header = buildHeader({ timestamp: formatTimestamp(now), stats, ...identity });
  writeText(minutesPath, `# 会议纪要\n\n${header}\n\n---\n\n${minutesBody}\n`);

  const metadataPath = path.join(sessionDir, 'metadata.json');
  const metadata = fs.existsSync(metadataPath)
    ? JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    : { createdAt: now.toISOString(), stats, files: {} };
  metadata.stats ||= stats;
  metadata.files = { ...(metadata.files || {}), minutes: 'minutes.md', minutesContent: 'minutes-content.md' };
  metadata.artifactSnapshots = { ...metadata.artifactSnapshots, minutes: { ...identity, transcript, stats } };
  writeText(path.join(sessionDir, 'minutes-content.md'), cleanMinutes);
  if (transcript && !metadata.files.transcript) metadata.files.transcript = 'transcript.md';
  writeMetadata(metadataPath, metadata);

  return { sessionDir, minutesPath, metadataPath };
}

function saveAudioArtifact({ sessionDir, audioPath, audioAnalysis }) {
  if (!sessionDir || !audioPath) return { sessionDir };
  if (!fs.existsSync(audioPath)) throw new Error(`录音文件不存在: ${audioPath}`);
  checkDestinations(sessionDir, ['metadata.json', 'meeting.wav', 'audio-analysis.json', 'audio-analysis.md']);

  const targetAudioPath = path.join(sessionDir, 'meeting.wav');
  if (fs.realpathSync(audioPath) !== (fs.existsSync(targetAudioPath) ? fs.realpathSync(targetAudioPath) : path.resolve(targetAudioPath))) {
    atomicFile(targetAudioPath, temporary => fs.copyFileSync(audioPath, temporary, fs.constants.COPYFILE_EXCL));
  }
  const analysisPath = path.join(sessionDir, 'audio-analysis.json');
  writeText(analysisPath, JSON.stringify(audioAnalysis || {}, null, 2));
  const analysisMarkdownPath = path.join(sessionDir, 'audio-analysis.md');
  const analysis = audioAnalysis || {};
  const interpretation = analysis.interpretation || {};
  writeText(analysisMarkdownPath, [
    '# 本地音频分析',
    '',
    `- 时长：${analysis.durationSeconds ?? '-'} 秒`,
    `- 有效发言占比：${analysis.speechRatio == null ? '-' : `${Math.round(analysis.speechRatio * 100)}%`}`,
    `- 静音时长：${analysis.silenceSeconds ?? '-'} 秒`,
    `- 平均能量：${analysis.averageRms ?? '-'}`,
    `- 能量变化次数：${analysis.energyChangeCount ?? '-'}`,
    `- openSMILE：${audioAnalysis?.openSmile?.enabled ? '已启用（eGeMAPS）' : `未启用${audioAnalysis?.openSmile?.error ? `（${audioAnalysis.openSmile.error}）` : ''}`}`,
    `- 能量水平：${interpretation.energy || '-'}`,
    `- 停顿负荷：${interpretation.pauseLoad || '-'}`,
    `- 稳定性：${interpretation.stability || '-'}`,
    '',
    '## 使用边界',
    '',
    ...(analysis.limitations || []).map(item => `- ${item}`),
    ''
  ].join('\n'));

  const metadataPath = path.join(sessionDir, 'metadata.json');
  const metadata = fs.existsSync(metadataPath)
    ? JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    : { createdAt: new Date().toISOString(), stats: {}, files: {} };
  metadata.files = {
    ...(metadata.files || {}),
    audio: 'meeting.wav',
    audioAnalysis: 'audio-analysis.json',
    audioAnalysisMarkdown: 'audio-analysis.md'
  };
  metadata.audioAnalysis = audioAnalysis || {};
  writeMetadata(metadataPath, metadata);
  return {
    sessionDir,
    audioPath: targetAudioPath,
    audioAnalysisPath: analysisPath,
    audioAnalysisMarkdownPath: analysisMarkdownPath,
    audioAnalysis
  };
}

function createMeetingArtifacts({ rootDir, now = new Date(), transcript, report, stats = {} }) {
  const transcriptResult = createTranscriptArtifact({ rootDir, now, transcript, stats });
  const reportResult = saveReportArtifact({
    sessionDir: transcriptResult.sessionDir,
    now,
    createdAt: now.toISOString(),
    transcript,
    report,
    stats
  });

  return { ...transcriptResult, reportPath: reportResult.reportPath };
}

module.exports = { createMeetingArtifacts, createTranscriptArtifact, saveReportArtifact, saveMinutesArtifact, saveAudioArtifact, formatTimestamp };
