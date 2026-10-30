const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { isDefaultMeetingTitle, extractMeetingTitle } = require('../src/meeting-title');

function resolveArchive(rootDir, archiveId) {
  if (typeof archiveId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,180}$/.test(archiveId)) {
    throw new Error('无效的会议归档标识');
  }
  const root = fs.realpathSync(rootDir);
  const directory = path.join(root, archiveId);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(fs.realpathSync(directory)) !== root) {
    throw new Error('会议归档超出保存目录');
  }
  return directory;
}

function readFile(directory, filename, maxBytes = 16 * 1024 * 1024) {
  if (typeof filename !== 'string' || !filename || path.basename(filename) !== filename || /[/\\]/.test(filename) || filename === '..') {
    throw new Error('无效的会议文件路径');
  }
  const file = path.join(directory, filename);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error('会议文件不可读取');
  return fs.readFileSync(file, 'utf8');
}

function readMetadata(directory) {
  const metadata = JSON.parse(readFile(directory, 'metadata.json', 2 * 1024 * 1024));
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
      !metadata.files || typeof metadata.files !== 'object' || Array.isArray(metadata.files)) {
    throw new Error('会议元数据格式无效');
  }
  if (metadata.sessionId && !/^[A-Za-z0-9-]{1,80}$/.test(metadata.sessionId)) throw new Error('会议 ID 无效');
  return metadata;
}

function readTranscript(directory, files) {
  let transcript = files.transcriptText ? readFile(directory, files.transcriptText)
    : files.transcript ? readFile(directory, files.transcript) : '';
  if (!files.transcriptText && /^# 原始对话\r?\n/.test(transcript)) {
    const separator = /\r?\n---\r?\n\r?\n/.exec(transcript);
    if (separator) transcript = transcript.slice(separator.index + separator[0].length).trim();
  }
  return transcript;
}

function summary(archiveId, metadata, directory) {
  const timestamp = metadata.startedAt || metadata.createdAt;
  let title = String(metadata.title || `会议 ${archiveId}`);
  let titleSource = metadata.titleSource;
  if (titleSource !== 'manual' && (isDefaultMeetingTitle(metadata.title) || title === `会议 ${archiveId}`)) {
    try {
      const extracted = extractMeetingTitle(readTranscript(directory, metadata.files));
      if (extracted) { title = extracted; titleSource = 'auto'; }
    } catch { /* Keep the archive visible even if its transcript is unavailable. */ }
  }
  return {
    archiveId,
    sessionId: metadata.sessionId || `archive-${createHash('sha256').update(archiveId).digest('hex').slice(0, 24)}`,
    title, titleSource,
    startedAt: Number.isFinite(Date.parse(timestamp)) ? timestamp : new Date(0).toISOString(),
    endedAt: metadata.endedAt || null,
    stats: metadata.stats || {},
    hasTranscript: Boolean(metadata.files.transcript || metadata.files.transcriptText),
    hasMinutes: Boolean(metadata.files.minutes),
    hasReport: Boolean(metadata.files.report),
    hasAudio: Boolean(metadata.files.audio)
  };
}

function listMeetingHistory(rootDir, { query = '', limit = 100, offset = 0 } = {}) {
  if (!fs.existsSync(rootDir)) return [];
  const needle = String(query).trim().toLocaleLowerCase();
  const rows = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try {
      const directory = resolveArchive(rootDir, entry.name);
      const metadata = readMetadata(directory);
      const row = summary(entry.name, metadata, directory);
      let matches = !needle || `${row.title} ${metadata.title || ''} ${row.startedAt}`.toLocaleLowerCase().includes(needle);
      if (!matches) {
        const files = metadata.files;
        const readers = [() => readTranscript(directory, files),
          ...[files.minutesContent || files.minutes, files.reportContent || files.report].filter(Boolean).map(file => () => readFile(directory, file))];
        matches = readers.some(read => {
          try { return read().toLocaleLowerCase().includes(needle); }
          catch { return false; }
        });
      }
      if (matches) rows.push(row);
    } catch { /* A damaged archive must not hide other meetings. */ }
  }
  rows.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.archiveId.localeCompare(b.archiveId));
  const start = Math.max(0, Number(offset) || 0);
  return rows.slice(start, start + Math.max(1, Math.min(100, Number(limit) || 100)));
}

function readMeetingHistory(rootDir, archiveId) {
  const sessionDir = resolveArchive(rootDir, archiveId);
  const metadata = readMetadata(sessionDir);
  const files = metadata.files;
  const text = key => files[key] ? readFile(sessionDir, files[key]) : '';
  const transcript = readTranscript(sessionDir, files);
  let audioPath = '';
  if (files.audio) {
    const filename = files.audio;
    if (path.basename(filename) !== filename || /[/\\]/.test(filename)) throw new Error('无效的录音文件路径');
    audioPath = path.join(sessionDir, filename);
    const stat = fs.lstatSync(audioPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('录音文件不可读取');
  }
  return {
    ...summary(archiveId, metadata, sessionDir), sessionDir, metadata, transcript,
    report: files.reportContent ? text('reportContent') : text('report'),
    minutes: files.minutesContent ? text('minutesContent') : text('minutes'),
    snapshots: metadata.artifactSnapshots || {},
    speakerSegments: metadata.speakerSegments || [],
    audioPath, audioAnalysis: metadata.audioAnalysis || null
  };
}

module.exports = { resolveArchive, listMeetingHistory, readMeetingHistory };
