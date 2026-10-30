const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(require.resolve('../src/app.js'), 'utf8') + '\nthis.Trainer = ExpressionTrainer;', context);

function trainer() {
  const app = Object.create(context.Trainer.prototype);
  app.liveEmotionStatus = { textContent: '', dataset: {} };
  app.liveEmotionCategories = { innerHTML: '' };
  app.liveEmotionDetail = { textContent: '' };
  return app;
}

test('live feedback renders main and candidate categories and clears expired results on pause', () => {
  const app = trainer();
  app.renderLiveEmotion({ status: 'result', startSeconds: 3, endSeconds: 9,
    candidates: [{ label: '中性', score: 0.65 }, { label: '愉快', score: 0.25 }] });
  assert.match(app.liveEmotionCategories.innerHTML, /中性/);
  assert.match(app.liveEmotionCategories.innerHTML, /65%/);
  assert.match(app.liveEmotionCategories.innerHTML, /候选/);
  assert.match(app.liveEmotionDetail.textContent, /00:03/);
  app.renderLiveEmotion({ status: 'paused', message: '已暂停语气反馈' });
  assert.equal(app.liveEmotionCategories.innerHTML, '');
  assert.equal(app.liveEmotionStatus.textContent, '已暂停语气反馈');
});

test('meeting analysis speaker table no longer renders personal acoustic or emotion fields', () => {
  const html = trainer().renderInteractionSummary({ speakers: [{ speaker: 'A', turnCount: 1, participation: 1,
    wordsPerMinute: 60, fillers: 0, hedges: 0, acoustics: { toneSignal: 'SECRET OLD TONE' } }] }, {});
  assert.doesNotMatch(html, /个人声学|SECRET OLD TONE/);
  assert.match(html, /发言占比/);
});
