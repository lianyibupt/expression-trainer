const fs = require('fs');
const path = require('path');

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

function buildHeader({ timestamp, stats }) {
  const duration = Number(stats.duration || 0);
  const totalWords = Number(stats.totalWords || 0);

  return `**时间**: ${timestamp.display}\n**时长**: ${duration}秒\n**总字数**: ${totalWords}`;
}

function writeMetadata(metadataPath, metadata) {
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
}

function createTranscriptArtifact({ rootDir, now = new Date(), transcript, stats = {} }) {
  if (!rootDir) throw new Error('rootDir is required');

  const timestamp = formatTimestamp(now);
  const sessionDir = getUniqueSessionDir(rootDir, timestamp.folder);
  fs.mkdirSync(sessionDir, { recursive: true });

  const cleanTranscript = String(transcript || '').trim();
  const header = buildHeader({ timestamp, stats });
  const transcriptMarkdown = `# 原始对话\n\n${header}\n\n---\n\n${cleanTranscript}\n`;

  const transcriptPath = path.join(sessionDir, 'transcript.md');
  const metadataPath = path.join(sessionDir, 'metadata.json');

  fs.writeFileSync(transcriptPath, transcriptMarkdown, 'utf8');
  writeMetadata(metadataPath, {
    createdAt: now.toISOString(),
    stats,
    files: {
      transcript: 'transcript.md'
    }
  });

  return { sessionDir, transcriptPath, metadataPath };
}

function saveReportArtifact({ sessionDir, now = new Date(), createdAt, transcript, report, stats = {} }) {
  if (!sessionDir) throw new Error('sessionDir is required');

  const timestamp = formatTimestamp(now);
  const cleanTranscript = String(transcript || '').trim();
  const cleanReport = String(report || '').trim();
  const header = buildHeader({ timestamp, stats });
  const reportMarkdown = `# 对话分析报告\n\n${header}\n\n---\n\n## 原始对话\n\n${cleanTranscript}\n\n---\n\n${cleanReport}\n`;

  const reportPath = path.join(sessionDir, 'report.md');
  const metadataPath = path.join(sessionDir, 'metadata.json');
  let metadata = { createdAt: createdAt || now.toISOString(), stats, files: {} };

  if (fs.existsSync(metadataPath)) {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  }

  metadata.stats = stats;
  metadata.files = { ...(metadata.files || {}), report: 'report.md' };

  fs.writeFileSync(reportPath, reportMarkdown, 'utf8');
  writeMetadata(metadataPath, metadata);

  return { sessionDir, reportPath, metadataPath };
}

function saveMinutesArtifact({ sessionDir, now = new Date(), transcript, minutes, stats = {} }) {
  if (!sessionDir) throw new Error('sessionDir is required');

  const minutesPath = path.join(sessionDir, 'minutes.md');
  const cleanMinutes = String(minutes || '').trim();
  const minutesBody = cleanMinutes.replace(/^# 会议纪要\s*/u, '').trim();
  const header = buildHeader({ timestamp: formatTimestamp(now), stats });
  fs.writeFileSync(minutesPath, `# 会议纪要\n\n${header}\n\n---\n\n${minutesBody}\n`, 'utf8');

  const metadataPath = path.join(sessionDir, 'metadata.json');
  const metadata = fs.existsSync(metadataPath)
    ? JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    : { createdAt: now.toISOString(), stats, files: {} };
  metadata.stats = stats;
  metadata.files = { ...(metadata.files || {}), minutes: 'minutes.md' };
  if (transcript && !metadata.files.transcript) metadata.files.transcript = 'transcript.md';
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

  return { sessionDir, minutesPath, metadataPath };
}

function saveAudioArtifact({ sessionDir, audioPath, audioAnalysis }) {
  if (!sessionDir || !audioPath) return { sessionDir };
  if (!fs.existsSync(audioPath)) throw new Error(`录音文件不存在: ${audioPath}`);

  const targetAudioPath = path.join(sessionDir, 'meeting.wav');
  fs.copyFileSync(audioPath, targetAudioPath);
  const analysisPath = path.join(sessionDir, 'audio-analysis.json');
  fs.writeFileSync(analysisPath, JSON.stringify(audioAnalysis || {}, null, 2), 'utf8');
  const analysisMarkdownPath = path.join(sessionDir, 'audio-analysis.md');
  const analysis = audioAnalysis || {};
  const interpretation = analysis.interpretation || {};
  fs.writeFileSync(analysisMarkdownPath, [
    '# 本地音频分析',
    '',
    `- 时长：${analysis.durationSeconds ?? '-'} 秒`,
    `- 有效发言占比：${analysis.speechRatio == null ? '-' : `${Math.round(analysis.speechRatio * 100)}%`}`,
    `- 静音时长：${analysis.silenceSeconds ?? '-'} 秒`,
    `- 平均能量：${analysis.averageRms ?? '-'}`,
    `- 能量变化次数：${analysis.energyChangeCount ?? '-'}`,
    `- 能量水平：${interpretation.energy || '-'}`,
    `- 停顿负荷：${interpretation.pauseLoad || '-'}`,
    `- 稳定性：${interpretation.stability || '-'}`,
    '',
    '## 使用边界',
    '',
    ...(analysis.limitations || []).map(item => `- ${item}`),
    ''
  ].join('\n'), 'utf8');

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
