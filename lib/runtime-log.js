// Terminal logs deliberately accept metadata only. Never pass transcripts,
// prompts, provider responses, worker stderr or settings to the logger.
const FIELDS = new Set([
  'taskId', 'sessionId', 'jobId', 'engine', 'finalEngine', 'modelPreset', 'model', 'provider',
  'language', 'speakerDiarization', 'offline', 'pid', 'stage', 'elapsedSec', 'idleSec',
  'processedSeconds', 'totalSeconds', 'audioSeconds', 'textChars', 'speakerCount',
  'segments', 'chunks', 'chunk', 'httpStatus', 'exitCode', 'signal', 'errorType', 'errorCode',
  'hasInput', 'hasOutput', 'isRecording', 'action', 'startAfterSec', 'reviewAfterSec',
  'autoDetectMeeting', 'autoStartRecording', 'captureSystemAudio', 'path', 'mode'
]);
let nextTaskId = 0;

function log(scope, message, details = {}, level = 'INFO') {
  const fields = Object.entries(details)
    .filter(([key, value]) => FIELDS.has(key) && value != null && ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => `${key}=${typeof value === 'string' ? JSON.stringify(value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 240)) : value}`)
    .join(' ');
  const timestamp = new Date().toLocaleString('sv-SE', { hour12: false });
  const line = `[${timestamp}] [${level}] [${scope}] ${message}${fields ? ` | ${fields}` : ''}`;
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
}

function startTask(scope, label, details = {}) {
  const startedAt = Date.now();
  let updatedAt = startedAt;
  let stage = label;
  let progress = {};
  let finished = false;
  const identity = { ...details, taskId: `${scope}-${++nextTaskId}` };
  const elapsed = () => ({ elapsedSec: Math.round((Date.now() - startedAt) / 1000) });
  log(scope, `${label}：开始`, identity);
  const heartbeat = setInterval(() => {
    log(scope, `${label}：仍在处理（${stage}）`, {
      ...identity, ...progress, ...elapsed(), idleSec: Math.round((Date.now() - updatedAt) / 1000)
    });
  }, 15000);
  heartbeat.unref?.();
  const finish = (message, fields, level) => {
    if (finished) return;
    finished = true;
    clearInterval(heartbeat);
    log(scope, `${label}：${message}`, { ...identity, ...elapsed(), ...fields }, level);
  };
  return {
    update(message, fields = {}) {
      if (finished) return;
      stage = message;
      progress = fields;
      updatedAt = Date.now();
      log(scope, `${label}：${message}`, { ...identity, ...fields, ...elapsed() });
    },
    done(fields = {}) { finish('完成', fields, 'INFO'); },
    fail(error, fields = {}) {
      finish('失败（详细错误请查看界面）', {
        errorType: error?.name || 'Error',
        errorCode: /^E[A-Z_]+$/.test(error?.code || '') ? error.code : undefined,
        ...fields
      }, 'ERROR');
    }
  };
}

module.exports = { log, startTask };
