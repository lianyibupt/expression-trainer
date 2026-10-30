const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createSaveSnapshot } = require('../src/meeting-sessions');
const context = vm.createContext({ createSaveSnapshot, setTimeout });
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../src/app.js'), 'utf8'), context);
const prototype = vm.runInContext('ExpressionTrainer.prototype', context);

test('exit waits for an existing report task before taking the save snapshot', async () => {
  let finish;
  const value = Object.create(prototype);
  Object.assign(value, { session: { id: 'a' }, transcriptEditor: { value: '原文' }, stats: {}, speakerSegments: [],
    waitForFinalTranscript: async () => ({ success: true }),
    reportPromise: new Promise(resolve => { finish = resolve; }),
    saveAllExistingArtifactsForExit: async snapshot => ({ success: true, sessionDir: snapshot.report }) });
  const pending = value.prepareForExit();
  await new Promise(resolve => setImmediate(resolve));
  value.lastReport = '已完成报告';
  finish();
  assert.equal((await pending).sessionDir, '已完成报告');
});

test('explicit exit save works even when automatic artifact saving is disabled', async () => {
  const value = Object.create(prototype);
  Object.assign(value, { getSettings: async () => ({ meeting: { autoSaveArtifacts: false } }),
    api: { analyzeText: async () => null, saveMeetingTranscript: async () => ({ success: true }) } });
  assert.equal((await value.persistTranscriptSnapshot({ transcript: '原文' }, { force: true })).success, true);
});

test('an existing generated report can be archived after the current transcript is cleared', async () => {
  const value = Object.create(prototype);
  Object.assign(value, { getSettings: async () => ({ meeting: {} }),
    api: { saveMeetingTranscript: async () => ({ success: true }) } });
  assert.equal((await value.persistTranscriptSnapshot({ transcript: '', report: '# 已有报告' }, { allowAudioOnly: true, force: true })).success, true);
});
