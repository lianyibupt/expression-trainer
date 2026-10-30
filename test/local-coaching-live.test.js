const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const timers = new Map(); let next = 0;
  const context = vm.createContext({
    setTimeout: (callback, delay) => { const id = ++next; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => { callback(); return 1; }
  });
  for (const name of ['expression-analysis.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', name), 'utf8'), context);
  const value = Object.assign(Object.create(vm.runInContext('ExpressionTrainer.prototype', context)), {
    fullText: '', sentences: [], transcriptRevision: 0, activeSessionGeneration: 1,
    realtimePhraseBuffer: '', realtimePhraseLastAt: 0, lastFeedbackText: '',
    settings: { asr: { autoSegment: true }, meeting: { expressionOptimizationEnabled: false } },
    stats: { duration: 5, totalWords: 0 }, isRecording: true,
    localCoachingContent: { innerHTML: '', scrollTop: 0, scrollHeight: 300, clientHeight: 100 },
    localCoachingFilter: { value: '', innerHTML: '' }, localCoachingSummary: {},
    btnLocalCoachingFollow: { setAttribute() {} },
    updateStatsDisplay() {}, renderSubtitle() {}, syncTranscriptEditor() {}, updateTextActionVisibility() {},
    api: { segmentText: async text => ({ success: true, text }) }
  });
  const runTimers = () => {
    const pending = [...timers.values()]; timers.clear();
    for (const item of pending) item.callback();
  };
  return { value, timers, runTimers };
}

test('short final fragments show local hints without waiting for punctuation or 28 characters', () => {
  const { value, timers, runTimers } = setup();
  value.handleASRResult({ text: '这个这个接口', isFinal: true });
  assert.equal(value.fullText, '');
  assert.equal(timers.size, 1);
  assert.ok([...timers.values()][0].delay <= 120);
  runTimers();
  assert.ok(value.localAnalysis.findings.some(item => item.category === 'repetition'));
  assert.equal(value.stats.fillers, 0, 'uncommitted previews must not change persisted counters');
  assert.match(value.localCoachingContent.innerHTML, /识别中/);
});

test('rapid interim corrections share a bounded update and replace outdated preview hints', () => {
  const { value, timers, runTimers } = setup();
  value.handleASRResult({ text: '这个这个接口', isFinal: false });
  const firstTimer = [...timers.keys()][0];
  value.handleASRResult({ text: '这个这个接口还需要', isFinal: false });
  assert.equal([...timers.keys()][0], firstTimer);
  assert.equal(timers.size, 1);
  runTimers();
  assert.ok(value.localAnalysis.findings.length > 0);
  value.handleASRResult({ text: '这个接口负责读日志', isFinal: false });
  runTimers();
  assert.equal(value.localAnalysis.findings.length, 0);
  assert.equal(value.fullText, '');
  assert.equal(value.transcriptRevision, 0);
});

test('local feedback does not wait for segmentation and preserves newly buffered fragments', async () => {
  const { value, runTimers } = setup(); let finish;
  value.api.segmentText = text => new Promise(resolve => { finish = () => resolve({ success: true, text }); });
  value.handleASRResult({ text: '这个这个接口。', isFinal: true });
  runTimers();
  assert.ok(value.localAnalysis.findings.some(item => item.category === 'repetition'));
  value.handleASRResult({ text: '后续我们尽快跟进一下', isFinal: true });
  runTimers();
  assert.ok(value.localAnalysis.findings.some(item => item.category === 'action'));
  finish(); await value.realtimeFlushChain;
  assert.equal(value.fullText, '这个这个接口。');
  assert.equal(value.localAnalysis.findings.filter(item => item.category === 'repetition').length, 1);
  assert.equal(value.stats.fillers, 1);
  assert.ok(value.localAnalysis.findings.some(item => item.category === 'action'));
});

test('reset removes scheduled preview work and rejects old segmentation completions', async () => {
  const { value, timers, runTimers } = setup(); let finish;
  value.api.segmentText = text => new Promise(resolve => { finish = () => resolve({ success: true, text }); });
  value.handleASRResult({ text: '这个这个接口。', isFinal: true });
  const pending = value.realtimeFlushChain;
  value.resetLocalCoachingRealtime();
  assert.equal(timers.size, 0);
  finish(); await pending; runTimers();
  assert.equal(value.fullText, '');
  assert.equal(value.getLocalCoachingText(), '');
});

test('list shows recent findings chronologically and follows the newest item by default', () => {
  const { value } = setup();
  value.fullText = ['甲', '乙', '丙', '丁', '戊', '己'].map(label => `这个这个接口${label}。`).join('\n');
  value.refreshLocalCoaching();
  const starts = [...value.localCoachingContent.innerHTML.matchAll(/data-coaching-start="(\d+)"/g)].map(item => Number(item[1]));
  const latest = value.localAnalysis.findings.filter(item => item.category === 'repetition').slice(-3).map(item => item.start);
  assert.deepEqual(starts, Array.from(latest));
  assert.equal(value.localCoachingContent.scrollTop, 300);
  value.setLocalCoachingFollowLatest(false);
  value.localCoachingContent.scrollTop = 40;
  value.fullText += '\n这个这个新接口。';
  value.refreshLocalCoaching();
  assert.equal(value.localCoachingContent.scrollTop, 40);
  value.setLocalCoachingFollowLatest(true);
  assert.equal(value.localCoachingContent.scrollTop, 300);
});
