const assert = require('node:assert/strict');
const test = require('node:test');

const { getMeetingMinutesPrompt } = require('../lib/prompts');
const { splitMeetingText } = require('../lib/ai-feedback');

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
