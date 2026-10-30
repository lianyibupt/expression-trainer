const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDeepSeekSettings, getDeepSeekRequestBody } = require('../lib/deepseek-config');
const { sendFeedback, sendReport, sendMeetingMinutes, testConnection } = require('../lib/ai-feedback');

test('migrates old flat and per-provider application models without mutating inputs', () => {
  for (const model of ['', 'deepseek-chat', 'deepseek-coder']) {
    const flat = { provider: 'deepseek', model, apiKey: 'test' };
    const before = JSON.stringify(flat);
    assert.equal(normalizeDeepSeekSettings(flat).model, 'deepseek-flash');
    assert.equal(JSON.stringify(flat), before);
    const nested = { provider: 'custom', providers: { deepseek: { model, apiKey: 'test' }, custom: { model: 'mine' } }, asr: { language: 'auto' } };
    const original = JSON.stringify(nested);
    const migrated = normalizeDeepSeekSettings(nested);
    assert.equal(migrated.providers.deepseek.model, 'deepseek-flash');
    assert.equal(migrated.providers.custom.model, 'mine');
    assert.equal(JSON.stringify(nested), original);
  }
});

test('preserves unknown, manually configured and current model identifiers', () => {
  for (const model of ['my-custom-model', 'deepseek-reasoner', 'deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-flash']) {
    assert.equal(normalizeDeepSeekSettings({ provider: 'deepseek', model }).model, model);
  }
  assert.deepEqual(normalizeDeepSeekSettings({ provider: 'custom', model: 'deepseek-chat' }), { provider: 'custom', model: 'deepseek-chat' });
});

test('thinking controls apply only to known models on the official DeepSeek endpoint', () => {
  const endpoint = 'https://api.deepseek.com/v1/chat/completions';
  assert.deepEqual(getDeepSeekRequestBody(endpoint, 'deepseek-flash'), { thinking: { type: 'disabled' } });
  assert.deepEqual(getDeepSeekRequestBody(endpoint, 'my-model'), {});
  assert.deepEqual(getDeepSeekRequestBody('https://proxy.example/v1/chat/completions', 'deepseek-flash'), {});
  assert.deepEqual(getDeepSeekRequestBody('https://api.deepseek.com.example/v1/chat/completions', 'deepseek-flash'), {});
});

test('feedback, reports, minutes and connection checks use compatible request bodies', async t => {
  const requests = [];
  t.mock.method(global, 'fetch', async (endpoint, options) => {
    requests.push({ endpoint, ...JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '通过' } }] }) };
  });
  const settings = { provider: 'deepseek', apiKey: 'test', model: 'deepseek-chat' };
  await sendFeedback('原文', settings);
  await sendReport('原文', {}, settings);
  await sendMeetingMinutes('原文', {}, settings);
  await testConnection(settings);
  assert.equal(requests.length, 4);
  for (const request of requests) {
    assert.equal(request.model, 'deepseek-flash');
    assert.deepEqual(request.thinking, { type: 'disabled' });
  }
  await sendFeedback('原文', { provider: 'custom', baseUrl: 'https://proxy.example/v1', model: 'deepseek-chat' });
  assert.equal(requests.at(-1).model, 'deepseek-chat');
  assert.equal('thinking' in requests.at(-1), false);
});
