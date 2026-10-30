const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const coach = require('../src/expression-analysis');

test('functional connectors, demonstratives, technical verbs and calibrated uncertainty are preserved', () => {
  const text = '我们先定义接口，然后实现调用，最后验证结果。这个接口负责读取文件。根据当前样本，可能存在缓存失效，尚未验证。大概需要三天。请比较两个方案。我们做接口测试，看日志，说明问题。相当于一个队列。';
  const result = coach.analyze(text);
  assert.equal(result.findings.length, 0);
  assert.equal(result.hedges.length, 0);
  assert.equal(result.density, 100);
});

test('detects eight practical coaching dimensions with evidence and non-invented templates', () => {
  const text = '呃，嗯，我们先开始。这个这个接口需要改。我觉得可能应该调整。效果很好。这一块之后再说。后续我们尽快跟进一下。'
    + '我们先讨论背景然后讨论限制然后看看实现然后回到背景然后再考虑细节。这个做法对吧，后面再说对吧，大家理解对吧。';
  const result = coach.analyze(text);
  assert.equal(new Set(result.findings.map(item => item.category)).size, 8);
  for (const finding of result.findings) {
    assert.equal(text.slice(finding.start, finding.end), finding.evidence);
    assert.ok(finding.reason && finding.advice && finding.template);
    assert.ok(['high', 'medium', 'low'].includes(finding.confidence));
    assert.ok(finding.ruleId && finding.categoryLabel);
  }
});

test('explicit quantities and examples reduce vague evaluation warnings', () => {
  const result = coach.analyze('效果很好，错误率从8%降到2%。问题很多，例如请求超时和重复重试。对比之后，速度很快：耗时20毫秒。');
  assert.equal(result.findings.filter(item => item.category === 'evidence').length, 0);
  assert.ok(coach.analyze('优化后效果很好。').findings.some(item => item.category === 'evidence'));
  assert.equal(coach.analyze('很好，我们进入下一个议题。').findings.filter(item => item.category === 'evidence').length, 0);
});

test('action closure prompts distinguish future commitments, completed work and questions', () => {
  assert.ok(coach.analyze('后续我们尽快推进一下。').findings.some(item => item.category === 'action'));
  for (const text of ['后续由我负责，周五前提交检查清单供大家验收。', '后续我们怎么推进？', '之前我们已经跟进了。', '后面还有数据处理模块。', '回头看，这个接口已经优化了。']) {
    assert.equal(coach.analyze(text).findings.filter(item => item.category === 'action').length, 0, text);
  }
});

test('single hedges do not prescribe turning guesses into facts', () => {
  for (const text of ['我觉得应先验证再上线。', '可能导致超时，需要验证。', '我们不一定能复现。']) {
    assert.equal(coach.analyze(text).hedges.length, 0);
  }
  const result = coach.analyze('我觉得可能应该再检查。');
  assert.ok(result.hedges.length > 0);
  assert.match(result.findings.find(item => item.category === 'hedging').advice, /保留|不确定/);
});

test('repeated restarts are flagged for audio review without blaming ASR on the speaker', () => {
  const result = coach.analyze('我们我们可以先验证，这个这个接口还需要检查。');
  assert.ok(result.findings.some(item => item.category === 'repetition'));
  assert.match(result.findings.find(item => item.category === 'repetition').reason, /识别|ASR/);
  assert.equal(coach.analyze('对对对，这个判断成立。非常非常重要。').findings.length, 0);
});

test('speaker labels keep original offsets and do not combine different speakers into a pattern', () => {
  const text = '说话人 1：我觉得。\n说话人 2：可能需要验证。\n说话人 1：这个这个接口。';
  const result = coach.analyze(text);
  assert.equal(result.hedges.length, 0);
  assert.equal(result.findings[0].speaker, '说话人 1');
  assert.equal(text.slice(result.findings[0].start, result.findings[0].end), '这个这个');
  assert.ok(result.totalWords < text.replace(/\s/g, '').length);
});

test('speaker labels without inline text and timestamps retain attribution', () => {
  const result = coach.analyze('@说话人 2  03:13\n这个这个接口。\n@说话人 1  03:43\n后续我们尽快跟进一下。');
  assert.equal(result.findings.find(item => item.category === 'repetition').speaker, '说话人 2');
  assert.equal(result.findings.find(item => item.category === 'action').speaker, '说话人 1');
});

test('conciseness measures redundant characters rather than penalizing uncertainty', () => {
  const a = coach.analyze('可能存在超时。');
  const b = coach.analyze('呃，呃，这个这个接口。');
  assert.equal(a.density, 100);
  assert.ok(b.density < 100);
  assert.ok(b.density >= 0);
  assert.ok(b.redundantCharacters <= b.totalWords);
});

test('empty input, repeated calls and literal markup are deterministic and safe data', () => {
  assert.equal(coach.analyze('  '), null);
  const text = '<img src=x onerror="x">这个这个接口。';
  assert.deepEqual(coach.analyze(text), coach.analyze(text));
});

test('browser and backend use the same rule engine and preserve legacy response fields', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/expression-analysis.js'), 'utf8'), context);
  const text = '我觉得可能应该调整。这个这个接口效果很好。后续我们尽快跟进一下。';
  assert.deepEqual(JSON.parse(JSON.stringify(context.ExpressionAnalysis.analyze(text))), coach.analyze(text));
  const { analyzeText } = require('../lib/lexicon');
  const backend = analyzeText(text);
  assert.deepEqual(backend.findings, coach.analyze(text).findings);
  for (const key of ['fillers', 'hedges', 'vagueWords', 'emotionWords', 'suggestions']) assert.ok(Array.isArray(backend[key]));
});
