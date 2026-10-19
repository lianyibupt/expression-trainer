const assert = require('node:assert/strict');
const test = require('node:test');

const { getMeetingMinutesPrompt } = require('../lib/prompts');
const { splitMeetingText, sendMeetingMinutes } = require('../lib/ai-feedback');

test('meeting minutes prompt requires the fixed formal structure', () => {
  const prompt = getMeetingMinutesPrompt('说话人 1：我们决定下周发布。', {});

  assert.match(prompt.system, /# 会议纪要/);
  assert.match(prompt.system, /## 会议主题/);
  assert.match(prompt.system, /## 核心结论/);
  assert.match(prompt.system, /## 讨论要点/);
  assert.match(prompt.system, /## 决策事项/);
  assert.match(prompt.system, /\| 决策 \| 依据 \| 影响 \|/);
  assert.match(prompt.system, /\| 待办事项 \| 负责人 \| 截止时间 \| 状态 \|/);
  assert.match(prompt.system, /未明确/);
});

test('splitMeetingText keeps chunks under the configured character limit', () => {
  const chunks = splitMeetingText('甲'.repeat(2500), 1000);

  assert.equal(chunks.length, 3);
  assert.ok(chunks.every(chunk => chunk.length <= 1000));
});

test('minutes prompt organizes topics and separates existing plans from meeting decisions', () => {
  const source = '说话人 1：目前的做法是先验证，我建议以后扩大范围。';
  const prompt = getMeetingMinutesPrompt(source, {}, { goals: '重点关注技术方案', glossary: 'Deep Agents' });
  assert.match(prompt.system, /按议题/);
  assert.match(prompt.system, /既有计划/);
  assert.match(prompt.system, /不等于本次会议决策/);
  assert.match(prompt.system, /分歧/);
  assert.match(prompt.system, /不要.*流水账/);
  assert.match(prompt.system, /Deep Agents/);
  assert.ok(prompt.user.includes(source));
});

function mockProvider(t, responses) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(init.body));
    const response = responses.shift();
    assert.ok(response, 'unexpected extra provider request');
    return { ok: true, json: async () => ({ choices: [{ message: { content: response.text }, finish_reason: response.finish || 'stop' }] }) };
  });
  return requests;
}
const settings = { provider: 'deepseek', apiKey: 'test-only', model: 'test-model' };

test('short minutes use the full transcript and a low temperature', async t => {
  const requests = mockProvider(t, [{ text: '# 会议纪要\n\n## 会议主题\n测试' }]);
  const result = await sendMeetingMinutes('说话人 1：今天确认验证范围。', {}, settings);
  assert.match(result, /^# 会议纪要/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].temperature, 0.2);
  assert.match(requests[0].messages[1].content, /今天确认验证范围/);
});

test('long minutes retain ordered evidence extracts before final synthesis', async t => {
  const requests = mockProvider(t, [{ text: '前段：建议扩大，尚未决定。' }, { text: '后段：决定先验证。' }, { text: '# 会议纪要' }]);
  const result = await sendMeetingMinutes('甲'.repeat(12000) + '\n后续决定先验证。', {}, settings, { glossary: '验收范围' });
  assert.equal(result, '# 会议纪要');
  assert.equal(requests.length, 3);
  for (const request of requests) assert.equal(request.temperature, 0.2);
  assert.match(requests[0].messages[0].content, /分歧/);
  assert.match(requests[0].messages[0].content, /修订/);
  assert.match(requests[0].messages[0].content, /验收范围/);
  const merged = requests[2].messages[1].content;
  assert.match(merged, /片段 1\/2[\s\S]*前段[\s\S]*片段 2\/2[\s\S]*后段/);
});

test('minutes reject empty and truncated responses instead of saving partial output', async t => {
  mockProvider(t, [{ text: '   ' }, { text: '# 会议纪要\n半句话', finish: 'length' }]);
  await assert.rejects(sendMeetingMinutes('会议原文', {}, settings), /空/);
  await assert.rejects(sendMeetingMinutes('会议原文', {}, settings), /截断/);
});

test('a failed chunk stops generation instead of merging partial evidence', async t => {
  const requests = mockProvider(t, [{ text: '不完整摘要', finish: 'length' }]);
  await assert.rejects(sendMeetingMinutes('甲'.repeat(12001), {}, settings), /截断/);
  assert.equal(requests.length, 1);
});
