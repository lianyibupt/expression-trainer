// Shared, deterministic meeting coaching rules. No network, transcript storage or automatic rewriting.
(function (root) {
  const categories = [
    { id: 'filler', label: '口头赘余' },
    { id: 'repetition', label: '重复与重启' },
    { id: 'hedging', label: '限定语堆叠' },
    { id: 'evidence', label: '量化与证据' },
    { id: 'reference', label: '指代清晰度' },
    { id: 'action', label: '行动闭环' },
    { id: 'structure', label: '结论与结构' },
    { id: 'interaction', label: '反复求确认' }
  ];
  const labels = Object.fromEntries(categories.map(item => [item.id, item.label]));
  const hedgeTerms = ['我觉得', '我感觉', '感觉', '好像', '似乎', '可能', '也许', '大概', '应该', '或许', '不一定'];
  const fillerTerms = ['嗯', '呃', '额', '怎么说呢', '就是说', '那个', '这个', '就是', '然后', '其实'];
  const vagueTerms = ['非常多', '比较多', '很多', '很少', '不少', '很大', '很小', '很快', '很好', '不好', '不错', '比较好', '比较差', '比较大', '比较小', '有点多', '有点慢'];
  const metricContext = /效果|性能|耗时|速度|成本|质量|覆盖|收益|影响|进展|风险|规模|数量|效率|体验|稳定性|差距|提升|改善|资源|用户|问题/;
  const hasEvidence = /[0-9０-９]+\s*(?:[%％]|毫秒|秒|分钟|小时|天|个|条|次|倍|人|元|万|亿)|[一二三四五六七八九十百千万两]+(?:个|条|次|倍|天|人)|比如|例如|分别|具体是|包括/;
  const actionPattern = /跟进(?:一下)?|推进(?:一下)?|优化(?:一下)?|看一下|处理一下|研究一下|对齐一下|梳理一下|整理一下/g;
  const futurePattern = /后续|后面|之后|回头|到时候|有空|尽快|稍后|接下来/;
  const deadlinePattern = /(?:周[一二三四五六日天]|星期[一二三四五六日天]|今天|明天|后天|本周|下周|月底|月末|今晚|本月|下月|\d{1,2}[月日号点时]|[0-9一二三四五六七八九十两]+天(?:内|后)|截止|截至|之前|前完成|前提交)/;

  function units(source) {
    const result = [];
    let speaker = '';
    for (const line of source.matchAll(/[^\n]+/g)) {
      const label = line[0].match(/^\s*@?\s*((?:说话人|Speaker|SPEAKER)[ _-]*\d+)\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2})?\s*[:：]?\s*/i);
      const skipped = label ? label[0].length : 0;
      if (label) speaker = `说话人 ${label[1].match(/\d+/)[0]}`;
      const body = line[0].slice(skipped);
      for (const sentence of body.matchAll(/[^。！？!?；;]+[。！？!?；;]*/g)) {
        if (!sentence[0].trim()) continue;
        result.push({ text: sentence[0], start: line.index + skipped + sentence.index, speaker });
      }
    }
    return result;
  }

  function analyze(input) {
    const source = String(input ?? '');
    if (!source.trim()) return null;
    const sentences = units(source);
    const findings = [];
    const redundant = new Set();
    const seen = new Set();
    const add = (unit, start, end, info, redundantStart) => {
      const absoluteStart = unit.start + start;
      const absoluteEnd = unit.start + end;
      const key = `${info.ruleId}:${absoluteStart}:${absoluteEnd}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push({ ...info, categoryLabel: labels[info.category], start: absoluteStart, end: absoluteEnd,
        evidence: source.slice(absoluteStart, absoluteEnd), speaker: unit.speaker,
        context: unit.text.slice(Math.max(0, start - 36), Math.min(unit.text.length, end + 60)).trim() });
      if (redundantStart !== undefined) {
        for (let i = unit.start + redundantStart; i < absoluteEnd; i++) {
          if (/[\p{L}\p{N}]/u.test(source[i])) redundant.add(i);
        }
      }
    };

    for (const unit of sentences) {
      const text = unit.text;
      // Lexical repeats can be actual restarts OR ASR duplication; never diagnose their cause.
      const repeats = [];
      for (const match of text.matchAll(/(这个|那个|就是|然后|其实|我们|我|你|它|有一些|所有|这种|因为|所以|可以|需要|可能|一个|这里|这边)(?:[，,、\s]*\1)+/g)) {
        repeats.push([match.index, match.index + match[0].length]);
        add(unit, match.index, match.index + match[0].length, {
          ruleId: 'repeated-restart', category: 'repetition', priority: 2, confidence: 'medium',
          reason: '检测到相邻重复，可能是口头重启，也可能是 ASR 识别重复。',
          advice: '先对照录音；确为重复时保留一次，停顿后接完整句，不把识别错误归因于说话人。',
          template: `${match[1]}【直接接要表达的内容】`
        }, match.index + match[1].length);
      }

      const sounds = [...text.matchAll(/嗯+|呃+|(?<![\p{L}\p{N}])额+(?![\p{L}\p{N}])|(?<!\p{L})啊+(?=[，,、\s]|$)|怎么说呢/g)];
      for (const match of sounds) {
        // A single conversational response is useful; clustered hesitation is worth reviewing.
        if (sounds.length < 2 && !/^(?:嗯|呃|额|啊){2,}$/.test(match[0]) && match[0] !== '怎么说呢') continue;
        add(unit, match.index, match.index + match[0].length, {
          ruleId: 'hesitation-cluster', category: 'filler', priority: 3, confidence: 'medium',
          reason: '同句出现多次找词停顿，可能打断信息推进；单次语气词不一律算错。',
          advice: '如果确实在找词，用短暂停顿代替连续语气词，先说当前已经确定的结论。',
          template: '【停顿】我的判断是【结论】，依据是【证据】。'
        }, match.index);
      }

      for (const term of ['就是', '其实', '就是说']) {
        const matches = [...text.matchAll(new RegExp(term, 'g'))];
        if (matches.length < 3) continue;
        for (const match of matches.slice(1)) {
          if (repeats.some(([a, b]) => match.index >= a && match.index < b)) continue;
          add(unit, match.index, match.index + term.length, {
            ruleId: 'discourse-overuse', category: 'filler', priority: 3, confidence: 'medium',
            reason: '同句多次使用同一引导词，可能造成层层铺垫；普通解释和转折用途保留。',
            advice: '检查每一处是否引入新信息，删除没有承接作用的重复引导词。',
            template: '【结论】。原因有两点：【原因一】；【原因二】。'
          }, match.index);
        }
      }

      const hedgePattern = new RegExp(`(${hedgeTerms.join('|')})(?:[，,\\s]*(?:(?:这个|就是|还|会|是|也|都|就)[，,\\s]*)?(?:${hedgeTerms.join('|')}))+`, 'g');
      for (const match of text.matchAll(hedgePattern)) {
        add(unit, match.index, match.index + match[0].length, {
          ruleId: 'stacked-hedges', category: 'hedging', priority: 2, confidence: 'medium',
          reason: '多个限定语紧邻叠加，听者难以分辨是在提出判断还是等待验证。',
          advice: '保留必要的不确定性，删去重复限定，补充判断依据和验证条件；不要把推测改成已确认事实。',
          template: '目前推测【判断】，依据是【证据】；【待确认项】将在【验证条件】下核实。'
        });
      }

      for (const match of text.matchAll(new RegExp(vagueTerms.join('|'), 'g'))) {
        const nearby = text.slice(Math.max(0, match.index - 30), match.index + match[0].length + 55);
        if (hasEvidence.test(nearby) || /^\s*(?:很好|不错)[，,！!]/.test(text) || /很好的(?:问题|建议|分享|观点)/.test(text)) continue;
        if (!metricContext.test(nearby) && !/很多|很少|不少|非常多|比较多/.test(match[0])) continue;
        add(unit, match.index, match.index + match[0].length, {
          ruleId: 'unqualified-evaluation', category: 'evidence', priority: 2, confidence: 'low',
          reason: '这段附近未发现数量、对照或例子；依据也可能已经在前文给出，需核实语境。',
          advice: '补充指标口径、比较对象或一个具体例子；把“很多”换成“大量”不会增加信息。',
          template: '在【范围/时间窗口】内，【指标】从【基线】变为【结果】；例如【具体案例】。'
        });
      }

      for (const match of text.matchAll(/这个东西|那个东西|一些东西|这种东西|这一块|这块|这方面/g)) {
        const after = text.slice(match.index + match[0].length);
        // “这块缓存/这方面能力” has an explicit following noun, so leave it alone.
        if (!/东西$/.test(match[0]) && !/^(?:[，,。！？!?\s]|$|的话|的(?:话|事情|问题)|之后|后面|后续|先|再|要|需要|我们|我)/.test(after)) continue;
        add(unit, match.index, match.index + match[0].length, {
          ruleId: 'unclear-reference', category: 'reference', priority: 3, confidence: 'low',
          reason: '泛指词后没有直接说明对象；是否含糊需要结合前文，而非仅凭这个词判断。',
          advice: '跨议题或分配任务时，复述具体模块、问题或交付物；上下文明确时可以保留指代。',
          template: '这里指【模块/对象名称】，具体要解决【问题】，范围包括【边界】。'
        });
      }

      if (futurePattern.test(text) && !/怎么|如何|为什么|吗|[？?]/.test(text)
        && !/已经|之前|过去|上周|上次|当时|做过|完成了|推进了|优化了|处理了|跟进了|回头看/.test(text)) {
        const action = [...text.matchAll(actionPattern)][0];
        if (action && !deadlinePattern.test(text)) {
          add(unit, action.index, action.index + action[0].length, {
            ruleId: 'open-action', category: 'action', priority: 1, confidence: 'low',
            reason: '检测到未来行动表达，但这句话没有明确时间；负责人和验收方式可能在其他发言中。',
            advice: '核实这是否是实际承诺；若是，确认负责人、时间、交付物和验收标准，不自动补全这些事实。',
            template: '由【负责人】在【时间】前提交【交付物】，按【验收标准】检查；阻塞时通知【对象】。'
          });
        }
      }

      const connectors = [...text.matchAll(/然后/g)];
      if (connectors.length >= 3 && !/结论|建议是|判断是|核心是|目标是|第一|首先/.test(text)) {
        const first = connectors[0];
        add(unit, first.index, first.index + first[0].length, {
          ruleId: 'chained-explanation', category: 'structure', priority: 2, confidence: 'low',
          reason: '同句连续多次使用“然后”，可能混合了步骤、原因和补充；真实操作顺序可以保留。',
          advice: '先判断是否在描述步骤；若在汇报判断，先给结论，再把内容分成理由、证据和下一步。',
          template: '我的结论是【判断】。依据有【理由一】和【理由二】；下一步是【行动】。'
        });
      }

      const confirmations = [...text.matchAll(/对吧|是吧|是不是/g)];
      if (confirmations.length >= 3) {
        const match = confirmations[0];
        add(unit, match.index, match.index + match[0].length, {
          ruleId: 'repeated-confirmation', category: 'interaction', priority: 3, confidence: 'low',
          reason: '同句多次求确认，可能没有明确要对方确认哪一件事；单次澄清提问不提示。',
          advice: '把重复确认集中为一个具体问题，说明希望对方确认事实、假设还是决策。',
          template: '我需要确认的是【具体事实/决策】：【明确问题】？如有不同意见，请指出【分歧点】。'
        });
      }
    }

    findings.sort((a, b) => a.priority - b.priority || a.start - b.start || a.end - b.end);
    const legacy = item => ({ word: item.evidence, position: item.start, start: item.start, end: item.end,
      ruleId: item.ruleId, alternatives: [item.advice], category: item.category });
    const totalWords = sentences.reduce((sum, item) => sum + (item.text.match(/[\p{L}\p{N}]/gu) || []).length, 0);
    const result = {
      version: 2, totalWords, redundantCharacters: redundant.size,
      density: totalWords ? Math.round((1 - redundant.size / totalWords) * 100) : 100,
      fillers: findings.filter(item => ['filler', 'repetition'].includes(item.category)).map(legacy),
      hedges: findings.filter(item => item.category === 'hedging').map(legacy),
      vagueWords: findings.filter(item => ['evidence', 'reference'].includes(item.category)).map(legacy),
      findings,
      categories: categories.map(category => ({ ...category, count: findings.filter(item => item.category === category.id).length })),
      suggestions: findings.map(item => ({ type: item.category, original: item.evidence, alternatives: [item.advice],
        message: `${item.categoryLabel}：${item.advice}`, ruleId: item.ruleId }))
    };
    return result;
  }

  function highlightSpans(analysis) {
    const spans = [];
    const candidates = [...(analysis?.findings || [])].sort((a, b) => a.start - b.start || b.end - a.end);
    for (const item of candidates) {
      if (spans.length && item.start < spans[spans.length - 1].end) continue;
      const type = ['filler', 'repetition'].includes(item.category) ? 'filler' : item.category === 'hedging' ? 'hedge' : 'vague';
      spans.push({ start: item.start, end: item.end, type });
    }
    return spans;
  }

  const api = { analyze, highlightSpans, categories, fillerTerms, hedgeTerms, vagueTerms };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ExpressionAnalysis = api;
})(globalThis);
