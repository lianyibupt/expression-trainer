const test = require('node:test');
const assert = require('node:assert/strict');
const { sendMeetingMinutes, testConnection } = require('../lib/ai-feedback');

const settings = { provider: 'deepseek', model: 'deepseek-flash' };
function success() {
  return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '# 会议纪要' } }] }) };
}

test('missing official provider keys fail before transmitting a request', async t => {
  let requests = 0;
  t.mock.method(global, 'fetch', async () => { requests++; return success(); });
  await assert.rejects(sendMeetingMinutes('测试文本', {}, { ...settings, apiKey: '' }), /DeepSeek.*API Key.*设置/);
  const result = await testConnection({ ...settings, apiKey: '  ' });
  assert.equal(result.success, false);
  assert.match(result.error, /DeepSeek.*API Key.*设置/);
  assert.equal(requests, 0);
});

test('both connection checks and minutes use exactly one Bearer prefix', async t => {
  const headers = [];
  t.mock.method(global, 'fetch', async (_url, options) => { headers.push(options.headers.Authorization); return success(); });
  const config = { ...settings, apiKey: '  Bearer sk-test-only  ' };
  await sendMeetingMinutes('测试文本', {}, config);
  assert.equal((await testConnection(config)).success, true);
  assert.deepEqual(headers, ['Bearer sk-test-only', 'Bearer sk-test-only']);
  assert.equal(config.apiKey, '  Bearer sk-test-only  ');
});

test('401 responses give actionable guidance without echoing provider content', async t => {
  t.mock.method(global, 'fetch', async () => ({ ok: false, status: 401, text: async () => 'Authentication Fails secret-value' }));
  await assert.rejects(sendMeetingMinutes('测试文本', {}, { ...settings, apiKey: 'sk-test-only' }), error => {
    assert.match(error.message, /401.*DeepSeek.*API Key.*设置/);
    assert.doesNotMatch(error.message, /secret-value/);
    return true;
  });
  const result = await testConnection({ ...settings, apiKey: 'sk-test-only' });
  assert.equal(result.success, false);
  assert.match(result.error, /401.*DeepSeek.*API Key.*设置/);
});

test('custom local endpoints still allow empty keys', async t => {
  t.mock.method(global, 'fetch', async () => success());
  const result = await testConnection({ provider: 'custom', baseUrl: 'http://localhost:1234/v1', model: 'local' });
  assert.equal(result.success, true);
});
