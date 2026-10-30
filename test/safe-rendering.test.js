const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function trainer() {
  const context = vm.createContext({ clearTimeout });
  for (const name of ['markdown.js', 'expression-analysis.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', name), 'utf8'), context);
  }
  const value = Object.create(vm.runInContext('ExpressionTrainer.prototype', context));
  value.reportBody = { innerHTML: '' };
  value.btnCopyReport = { classList: { remove() {} } };
  value.root = { getElementById: () => ({ addEventListener() {} }) };
  return value;
}

test('subtitle highlighter treats HTML as text and keeps longest word categories', () => {
  const result = trainer().highlightText('<img src=x onerror="alert(1)">我觉得可能应该先检查，然后然后再讨论 & <script>x</script>');
  assert.doesNotMatch(result, /<img|<script/i);
  assert.match(result, /&lt;img/);
  assert.match(result, /<span class="hedge">我觉得可能应该<\/span>/);
  assert.match(result, /<span class="filler">然后然后<\/span>/);
  assert.match(result, /&amp;/);
});

test('ordinary verbs and functional then are not highlighted', () => {
  const result = trainer().highlightText('我想先看日志，然后做验证，可能存在缓存问题。');
  assert.doesNotMatch(result, /<span/);
});

test('local coaching cards escape context and offer source navigation without changing the transcript', () => {
  const value = trainer();
  Object.assign(value, { fullText: '<img src=x onerror="x">这个这个接口效果很好。', stats: { duration: 3 },
    localCoachingContent: { innerHTML: '', scrollTop: 0 }, localCoachingFilter: { value: '', innerHTML: '' },
    localCoachingSummary: {}, updateStatsDisplay() {} });
  value.refreshLocalCoaching();
  assert.doesNotMatch(value.localCoachingContent.innerHTML, /<img|onerror="x"/);
  assert.match(value.localCoachingContent.innerHTML, /&lt;img/);
  assert.match(value.localCoachingContent.innerHTML, /定位原文/);
  assert.match(value.localCoachingContent.innerHTML, /待核实/);
  assert.equal(value.fullText, '<img src=x onerror="x">这个这个接口效果很好。');
  assert.equal(value.stats.duration, 3);
  value.localCoachingFilter.value = 'repetition';
  value.renderLocalCoaching();
  assert.match(value.localCoachingContent.innerHTML, /重复与重启/);
  assert.doesNotMatch(value.localCoachingContent.innerHTML, /量化与证据/);
});

test('expression reports use safe block Markdown including tables', () => {
  const value = trainer();
  value.renderReport('# 表达报告\n\n<img src=x onerror="alert(1)">\n\n| 指标 | 结果 |\n| --- | --- |\n| 填充词 | **减少** |');
  assert.doesNotMatch(value.reportBody.innerHTML, /<img|<script|<a\s/i);
  assert.match(value.reportBody.innerHTML, /&lt;img/);
  assert.match(value.reportBody.innerHTML, /<table>/);
  assert.match(value.reportBody.innerHTML, /<strong>减少<\/strong>/);
});
