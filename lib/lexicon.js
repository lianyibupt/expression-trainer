/** Local, context-aware meeting coaching plus optional emotion metadata. */
const fs = require('fs');
const path = require('path');
const ExpressionAnalysis = require('../src/expression-analysis');
let lexiconData = { emotions: {} };
let emotionTerms = [];

function loadLexicon() {
  const file = path.join(__dirname, '..', 'data', 'emotion-lexicon.json');
  lexiconData = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { emotions: {} };
  emotionTerms = Object.keys(lexiconData.emotions || {}).sort((a, b) => b.length - a.length);
  console.log(`[词库] 工作会议规则已加载；情绪元数据 ${emotionTerms.length} 词（不生成同义词替换）`);
}

function analyzeText(text) {
  const analysis = ExpressionAnalysis.analyze(text);
  if (!analysis) return null;
  const emotionWords = [];
  const source = String(text);
  for (let index = 0; index < source.length; index++) {
    const term = emotionTerms.find(word => source.startsWith(word, index));
    if (!term) continue;
    emotionWords.push({ word: term, position: index, ...lexiconData.emotions[term] });
    index += term.length - 1;
  }
  return { ...analysis, emotionWords };
}

// Compatibility exports; ordinary verbs and emotions intentionally have no substitution table.
module.exports = { loadLexicon, analyzeText, VAGUE_TO_PRECISE: {},
  FILLER_WORDS: ExpressionAnalysis.fillerTerms, HEDGE_WORDS: ExpressionAnalysis.hedgeTerms };
