const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const MeetingTitle = require('../src/meeting-title');
const { sendMeetingTitle } = require('../lib/ai-feedback');

test('fallback extracts a short topic after greetings and speaker labels', () => {
  const title = MeetingTitle.extractMeetingTitle('说话人 1：大家好。\n[00:05] 说话人 2：今天主要讨论搜索系统迁移方案与上线验证。\n说话人 1：下周开始验证。');
  assert.equal(title, '搜索系统迁移方案与上线验证');
  assert.equal(MeetingTitle.extractMeetingTitle('你好。谢谢。'), '');
  assert.ok(Array.from(MeetingTitle.extractMeetingTitle('迁移方案'.repeat(30))).length <= 32);
  assert.equal(MeetingTitle.isDefaultMeetingTitle('会议 12'), true);
  assert.equal(MeetingTitle.isDefaultMeetingTitle('项目评审'), false);
});

test('AI title retains keywords, bounds long input, and rejects empty output', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: requests.length === 1 ? '“搜索系统迁移与上线验证”' : '' }, finish_reason: 'stop' }] }) };
  });
  const settings = { provider: 'deepseek', apiKey: 'test', model: 'test' };
  assert.equal(await sendMeetingTitle('开头议题。' + '中间讨论。'.repeat(10000) + '最终上线验证。', settings), '搜索系统迁移与上线验证');
  const prompt = requests[0].messages;
  assert.match(prompt[0].content, /关键词/);
  assert.match(prompt[1].content, /开头议题/);
  assert.match(prompt[1].content, /最终上线验证/);
  assert.ok(prompt[1].content.length < 13000);
  await assert.rejects(sendMeetingTitle('搜索迁移方案', settings), /空/);
});

const context = vm.createContext({ MeetingTitle });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8'), context);
const prototype = vm.runInContext('ExpressionTrainer.prototype', context);
function trainer(api) {
  return Object.assign(Object.create(prototype), {
    session: { title: '会议 1', titleSource: 'default' },
    transcriptEditor: { value: '今天讨论搜索系统迁移方案。' }, transcriptRevision: 1,
    activeSessionGeneration: 1, api, workspace: { render() {} }
  });
}

test('automatic title is shared by concurrent requests and preserves manual edits', async () => {
  let finish, calls = 0;
  const value = trainer({ getMeetingTitle: async () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const first = value.ensureMeetingTitle();
  const second = value.ensureMeetingTitle();
  value.session.title = '手动名称'; value.session.titleSource = 'manual';
  finish({ success: true, title: '搜索系统迁移方案' });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(value.session.title, '手动名称');
});

test('title ignores stale transcripts and falls back when the provider fails', async () => {
  let finish;
  const value = trainer({ getMeetingTitle: () => new Promise(resolve => { finish = resolve; }) });
  const pending = value.ensureMeetingTitle();
  value.transcriptRevision++;
  finish({ success: true, title: '旧稿主题' });
  await pending;
  assert.equal(value.session.title, '会议 1');
  value.api.getMeetingTitle = async () => { throw new Error('offline'); };
  await value.ensureMeetingTitle();
  assert.equal(value.session.title, '搜索系统迁移方案');
  assert.equal(value.session.titleSource, 'auto');
});

test('saving waits for the title and archives the same name shown in the meeting tab', async () => {
  const value = trainer({ getMeetingTitle: async () => ({ success: true, title: '搜索迁移与上线验证' }),
    analyzeText: async () => null, saveMeetingTranscript: async snapshot => ({ success: true, title: snapshot.title }) });
  value.getSettings = async () => ({ meeting: {} });
  const snapshot = { title: '会议 1', transcript: value.transcriptEditor.value, transcriptRevision: 1 };
  const result = await value.persistTranscriptSnapshot(snapshot, { force: true });
  assert.equal(result.title, '搜索迁移与上线验证');
  assert.equal(snapshot.title, value.session.title);
});

test('save captures a title that finished while settings were loading', async () => {
  const value = trainer({ analyzeText: async () => null,
    saveMeetingTranscript: async snapshot => ({ success: true, title: snapshot.title }) });
  value.getSettings = async () => {
    value.session.title = '搜索迁移方案'; value.session.titleSource = 'auto';
    return { meeting: {} };
  };
  const result = await value.persistTranscriptSnapshot({ title: '会议 1', transcript: value.transcriptEditor.value, transcriptRevision: 1 }, { force: true });
  assert.equal(result.title, '搜索迁移方案');
});

test('manual titles skip provider calls even when the user chooses a default-looking name', async () => {
  const value = trainer({ getMeetingTitle: () => { throw new Error('should not be called'); } });
  value.session.titleSource = 'manual';
  await value.ensureMeetingTitle();
  assert.equal(value.session.title, '会议 1');
});

test('an uninformative provider title falls back to the transcript topic', async () => {
  const value = trainer({ getMeetingTitle: async () => ({ success: true, title: '会议 1' }) });
  await value.ensureMeetingTitle();
  assert.equal(value.session.title, '搜索系统迁移方案');
});

test('a revised transcript with identical text starts a fresh title task', async () => {
  const completions = [];
  const value = trainer({ getMeetingTitle: () => new Promise(resolve => completions.push(resolve)) });
  const first = value.ensureMeetingTitle();
  value.transcriptRevision++;
  const second = value.ensureMeetingTitle();
  assert.equal(completions.length, 2);
  completions[0]({ success: true, title: '过期名称' });
  completions[1]({ success: true, title: '当前名称' });
  await Promise.all([first, second]);
  assert.equal(value.session.title, '当前名称');
});
