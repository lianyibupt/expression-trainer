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

module.exports = { createMeetingArtifacts, createTranscriptArtifact, saveReportArtifact, formatTimestamp };
