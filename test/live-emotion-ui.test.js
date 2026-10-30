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
  app.liveEmotionDiagnostics = { textContent: '' };
  return app;
}

test('live feedback renders main and candidate categories and clears expired results on pause', () => {
  const app = trainer();
  app.renderLiveEmotion({ status: 'result', startSeconds: 3, endSeconds: 9,
    candidates: [{ label: '中性', score: 0.65 }, { label: '愉快', score: 0.25 }] });
  assert.match(app.liveEmotionCategories.innerHTML, /中性/);
  assert.match(app.liveEmotionCategories.innerHTML, /中性倾向/);
  assert.doesNotMatch(app.liveEmotionCategories.innerHTML, /%/);
  assert.match(app.liveEmotionCategories.innerHTML, /候选/);
  assert.match(app.liveEmotionDetail.textContent, /00:03/);
  app.renderLiveEmotion({ status: 'paused', message: '已暂停语气反馈' });
  assert.equal(app.liveEmotionCategories.innerHTML, '');
  assert.equal(app.liveEmotionStatus.textContent, '已暂停语气反馈');
});

test('saturated model scores never appear as 100 percent emotional certainty', () => {
  const app = trainer();
  app.audioSourceSelection = { microphone: true, system: true };
  app.renderLiveEmotion({ status: 'result', startSeconds: 0, endSeconds: 6,
    candidates: [{ key: 'neutral', label: '中性', score: 1 }],
    scoreDiagnostics: { saturated: true, topScore: 1, runnerUpScore: 0.000000001 },
    distribution: [{ key: 'neutral', label: '中性', score: 1 }, { key: 'happy', label: '愉快', score: 0.000000001 }],
    inputQuality: { rms: 0.03, peak: 0.3, activeRatio: 0.8, clippingRatio: 0 } });
  assert.match(app.liveEmotionCategories.innerHTML, /中性倾向/);
  assert.doesNotMatch(app.liveEmotionCategories.innerHTML, /100%/);
  assert.match(app.liveEmotionDetail.textContent, /饱和/);
  assert.match(app.liveEmotionDetail.textContent, /混合/);
  assert.match(app.liveEmotionDiagnostics.textContent, /未经校准/);
  assert.match(app.liveEmotionDiagnostics.textContent, /RMS/);
  app.renderLiveEmotion({ status: 'paused', message: '已暂停语气反馈' });
  assert.equal(app.liveEmotionDiagnostics.textContent, '');
});

test('meeting analysis speaker table no longer renders personal acoustic or emotion fields', () => {
  const html = trainer().renderInteractionSummary({ speakers: [{ speaker: 'A', turnCount: 1, participation: 1,
    wordsPerMinute: 60, fillers: 0, hedges: 0, acoustics: { toneSignal: 'SECRET OLD TONE' } }] }, {});
  assert.doesNotMatch(html, /个人声学|SECRET OLD TONE/);
  assert.match(html, /发言占比/);
});
