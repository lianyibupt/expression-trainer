const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8'), context);
const prototype = vm.runInContext('ExpressionTrainer.prototype', context);

function trainer(enabled = true) {
  const calls = [], feedback = [], attributes = {};
  const value = Object.assign(Object.create(prototype), {
    settings: { meeting: { expressionOptimizationEnabled: enabled } },
    fullText: '今天讨论迁移方案。', activeSessionGeneration: 1,
    btnExpressionOptimization: { setAttribute: (key, val) => { attributes[key] = val; } },
    expressionOptimizationStatus: {},
    api: { getRealtimeFeedback: async text => { calls.push(text); return { success: true, feedback: '建议补充结论' }; } },
    addFeedbackItem: text => feedback.push(text)
  });
  return { value, calls, feedback, attributes };
}

test('disabled optimization skips all realtime model requests, then can be re-enabled', async () => {
  const { value, calls, feedback } = trainer(false);
  await value.requestRealtimeFeedback();
  assert.equal(calls.length, 0);
  value.applyExpressionOptimizationSetting(true);
  await value.requestRealtimeFeedback();
  assert.deepEqual(calls, [value.fullText]);
  assert.deepEqual(feedback, ['建议补充结论']);
});

test('turning off and back on suppresses feedback from an earlier request', async () => {
  const { value, feedback } = trainer();
  let finish;
  value.api.getRealtimeFeedback = () => new Promise(resolve => { finish = resolve; });
  const pending = value.requestRealtimeFeedback();
  value.applyExpressionOptimizationSetting(false);
  value.applyExpressionOptimizationSetting(true);
  finish({ success: true, feedback: '已过期建议' });
  await pending;
  assert.deepEqual(feedback, []);
});

test('toggle preserves other settings, persists the choice and synchronizes meetings', async () => {
  const { value, attributes } = trainer();
  const stored = { provider: 'custom', meeting: { outputDir: '/meetings', autoSaveArtifacts: true } };
  let saved, synchronized;
  value.api.getSettings = async () => stored;
  value.api.saveSettings = async settings => { saved = settings; return { success: true }; };
  value.workspace = { applyExpressionOptimizationSetting: enabled => { synchronized = enabled; } };
  await value.toggleExpressionOptimization();
  assert.equal(saved.meeting.expressionOptimizationEnabled, false);
  assert.equal(saved.meeting.outputDir, '/meetings');
  assert.equal(saved.provider, 'custom');
  assert.equal(synchronized, false);
  assert.equal(attributes['aria-checked'], 'false');
  assert.match(value.expressionOptimizationStatus.textContent, /已关闭/);
  assert.equal(value.btnExpressionOptimization.disabled, false);
});

test('a failed save restores the persisted state and leaves the toggle usable', async () => {
  const { value, feedback } = trainer();
  value.api.getSettings = async () => ({ meeting: { expressionOptimizationEnabled: true } });
  value.api.saveSettings = async () => { throw new Error('磁盘不可写'); };
  value.workspace = { applyExpressionOptimizationSetting() {} };
  await value.toggleExpressionOptimization();
  assert.equal(value.settings.meeting.expressionOptimizationEnabled, true);
  assert.equal(value.btnExpressionOptimization.disabled, false);
  assert.match(feedback[0], /磁盘不可写/);
});

test('main process blocks realtime feedback even when a caller bypasses the UI', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const handler = source.match(/ipcMain\.handle\('get-realtime-feedback', ([\s\S]*?)\n}\);/)[1] + '\n}';
  let requests = 0;
  const scope = vm.createContext({
    loadSettings: () => ({ meeting: { expressionOptimizationEnabled: false } }),
    getCurrentProviderSettings: () => ({}), loadCustomPrompt: () => null,
    sendFeedback: async () => { requests++; return '不应生成'; }
  });
  const result = await vm.runInContext(`(${handler})`, scope)(null, '会议原文');
  assert.equal(requests, 0);
  assert.equal(result.skipped, true);
});
