const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function trainer() {
  const context = vm.createContext({});
  for (const name of ['markdown.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', name), 'utf8'), context);
  }
  const value = Object.create(vm.runInContext('ExpressionTrainer.prototype', context));
  value.reportBody = { innerHTML: '' };
  value.btnCopyReport = { classList: { remove() {} } };
  value.root = { getElementById: () => ({ addEventListener() {} }) };
  return value;
}

test('subtitle highlighter treats HTML as text and keeps longest word categories', () => {
  const result = trainer().highlightText('<img src=x onerror="alert(1)">我觉得然后开心 & <script>x</script>');
  assert.doesNotMatch(result, /<img|<script/i);
  assert.match(result, /&lt;img/);
  assert.match(result, /<span class="hedge">我觉得<\/span>/);
  assert.match(result, /<span class="filler">然后<\/span>/);
  assert.match(result, /&amp;/);
});

test('expression reports use safe block Markdown including tables', () => {
  const value = trainer();
  value.renderReport('# 表达报告\n\n<img src=x onerror="alert(1)">\n\n| 指标 | 结果 |\n| --- | --- |\n| 填充词 | **减少** |');
  assert.doesNotMatch(value.reportBody.innerHTML, /<img|<script|<a\s/i);
  assert.match(value.reportBody.innerHTML, /&lt;img/);
  assert.match(value.reportBody.innerHTML, /<table>/);
  assert.match(value.reportBody.innerHTML, /<strong>减少<\/strong>/);
});
