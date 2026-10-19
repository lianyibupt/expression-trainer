const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

// Exercise the same renderer and script order used by the page, without starting recording.
const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
const context = vm.createContext({});
for (const [, filename] of html.matchAll(/<script src="([^"]+)"/g)) {
  if (filename === 'workspace.js') continue;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', filename), 'utf8'), context);
}
const render = markdown => vm.runInContext('ExpressionTrainer.prototype.renderMarkdown', context)(markdown);

test('minutes render headings, paragraphs and nested ordered/unordered lists as blocks', () => {
  const result = render('# 会议纪要\n\n## 核心结论\n\n简述。\n\n- **结论**：保留现状\n  - 条件：完成验证\n- 第二条\n\n1. 验证\n2. 复盘');
  assert.match(result, /<h1>会议纪要<\/h1>/);
  assert.match(result, /<p>简述。<\/p>/);
  assert.match(result, /<ul>[\s\S]*<li><strong>结论<\/strong>：保留现状[\s\S]*<ul>[\s\S]*<li>条件：完成验证<\/li>/);
  assert.match(result, /<ol[ >][\s\S]*<li>验证<\/li>[\s\S]*<li>复盘<\/li>/);
  assert.doesNotMatch(result, /<\/h[12]><br>/);
});

test('minutes render decision tables with escaped pipes and inline code', () => {
  const result = render('## 决策事项\n\n| 决策 | 依据 | 影响 |\n| --- | :--- | ---: |\n| **暂缓** | `a|b` 与 A\\|B | 未明确 |');
  assert.match(result, /<table>/);
  assert.match(result, /<thead><tr><th[^>]*>决策<\/th>/);
  assert.match(result, /<td[^>]*><code>a\|b<\/code> 与 A\|B<\/td>/);
  assert.match(result, /<tbody>/);
  assert.doesNotMatch(result, />---</);
});

test('model HTML and unsafe links remain inert text', () => {
  const result = render('<img src=x onerror="alert(1)">\n<script>alert(2)</script>\n\n[x](javascript:alert(3))\n\n`<b>code</b>`');
  assert.doesNotMatch(result, /<img|<script|<a\s/i);
  assert.match(result, /&lt;img/);
  assert.match(result, /<code>&lt;b&gt;code&lt;\/b&gt;<\/code>/);
});

test('quotes, emphasis and fenced code keep their structure', () => {
  const result = render('> 需要*确认*\n> 第二行\n\n```js\nconst a = "<tag>";\n## 不应变标题\n```\n\n---');
  assert.match(result, /<blockquote>[\s\S]*<em>确认<\/em>/);
  assert.match(result, /<pre><code>const a = &quot;&lt;tag&gt;&quot;;\n## 不应变标题<\/code><\/pre>/);
  assert.match(result, /<hr>/);
});

test('an entire response wrapped in a markdown fence is still readable as minutes', () => {
  const result = render('```markdown\n# 会议纪要\n\n- 确认验证范围\n```');
  assert.match(result, /<h1>会议纪要<\/h1>/);
  assert.match(result, /<li>确认验证范围<\/li>/);
});

test('failed regeneration preserves the previous rendered minutes and Markdown source', async () => {
  const trainer = Object.create(vm.runInContext('ExpressionTrainer.prototype', context));
  const button = () => ({ classList: { remove() {}, add() {} } });
  Object.assign(trainer, {
    session: { id: 'preview', title: '评审', createdAt: '2026-10-19T10:00:00Z' },
    transcriptEditor: { value: '待整理的原文' }, stats: {}, speakerSegments: [],
    activeSessionGeneration: 0, lastMinutes: '# 上次纪要\n\n- 暂缓发布',
    minutesStatus: { textContent: '' }, minutesBody: { innerHTML: '' },
    btnGenerateMinutes: button(), btnCopyMinutes: button(), btnSaveMinutes: button(),
    api: { getMeetingMinutes: async () => ({ success: false, error: '服务暂时不可用' }) },
    switchStage() {}, setSessionStatus() {}
  });
  await trainer.generateMinutes();
  assert.equal(trainer.lastMinutes, '# 上次纪要\n\n- 暂缓发布');
  assert.match(trainer.minutesBody.innerHTML, /<li>暂缓发布<\/li>/);
  assert.match(trainer.minutesStatus.textContent, /已保留上一次纪要/);
  assert.equal(trainer.btnGenerateMinutes.disabled, false);
});
