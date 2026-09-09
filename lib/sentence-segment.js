/**
 * 识别结果断句补标点（本地规则）。
 *
 * 目标：对无标点/少标点的引擎转写做“句末补标点 + 一句一行”。
 * 约束：只补句末标点，不插句内标点；尊重已有标点（不重复加）；
 * 保留说话人行、空行与填充词；不改写任何词语。
 * 纯函数，无 IO。
 */

'use strict';

const CJK_PUNCT_END = /[。！？!?]/;
const CJK_RE = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
const LATIN_WORD_RE = /[A-Za-z]+/g;

const START_MARKERS = [
  '然后', '但是', '不过', '所以', '而且', '其实', '反正', '就是', '还有',
  '再说', '另外', '如果', '因为', '只是', '可是', '比如', '比如说', '于是',
  '接着', '后来', '那么', '这样', '现在', '接下来', '首先', '其次', '最后',
  '重点', '主要', '我觉得', '我感觉', '也就是说', '换句话说'
];
const END_PARTICLES = new Set(['吧', '吗', '呢', '啊', '呀', '哦', '噢', '嘛', '哈', '么']);
const QUESTION_RE = /(吗|呢|怎么|怎样|如何|为什么|哪些|什么|是不是|能不能|可不可以|why|what|how|whether)\s*$/i;

const DEFAULT_OPTS = { minChars: 14, maxChars: 40, maxWords: 16 };

function countCjk(text) {
  let n = 0;
  for (const ch of text) if (CJK_RE.test(ch)) n += 1;
  return n;
}

function countLatinWords(text) {
  const m = text.match(LATIN_WORD_RE);
  return m ? m.length : 0;
}

function isCjkDominant(text) {
  return countCjk(text) >= countLatinWords(text);
}

function terminalFor(text, isQuestion) {
  if (isQuestion) return isCjkDominant(text) ? '？' : '?';
  return isCjkDominant(text) ? '。' : '.';
}

function looksLikeQuestion(text) {
  return QUESTION_RE.test(text.trim());
}

/** 给若干无标点片段统一补句末标点（trim 后判定是否问句，空片段丢弃）。 */
function punctuate(pieces) {
  const out = [];
  for (const piece of pieces) {
    const trimmed = String(piece).trim();
    if (!trimmed) continue;
    const question = looksLikeQuestion(trimmed);
    out.push(trimmed + terminalFor(trimmed, question));
  }
  return out;
}

// 第 index 个字符是否为句末标点。ASCII .!? 仅在后跟空白或行尾、且前一字符
// 不是数字（3.14）也不是单个大写字母（U.S.）时才算句末。
function isEndPunct(text, index) {
  const ch = text[index];
  if (CJK_PUNCT_END.test(ch)) return true;
  if (ch !== '.' && ch !== '!' && ch !== '?') return false;
  if (index + 1 < text.length && !/\s/.test(text[index + 1])) return false;
  const prev = index > 0 ? text[index - 1] : '';
  return !/\d/.test(prev) && !(prev >= 'A' && prev <= 'Z');
}

/** 文本内是否存在受认可的句末标点（用于“已带标点”分支判定）。 */
function hasEndPunct(text) {
  for (let i = 0; i < text.length; i++) if (isEndPunct(text, i)) return true;
  return false;
}

/** 切分已有句末标点：返回带标点的片段数组；末段可能无标点。 */
function splitAtExistingEnds(text) {
  const parts = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    if (isEndPunct(text, index)) {
      parts.push(text.slice(start, index + 1));
      start = index + 1;
    }
    index += 1;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

/**
 * 找 [from, to) 区间内所有候选句界（升序去重）：
 * 句末语气词之后（cut = i + 1）与下一句起始标记之前（cut = i）。
 * 候选可能落在纯连接词/语气词片段上，是否真的断句由调用方结合内容过滤；
 * 无候选则返回空数组。
 */
function allCutsInWindow(from, to, text, minChars) {
  const cuts = [];
  for (let i = Math.max(from + minChars - 1, from); i < to && i < text.length; i++) {
    if (END_PARTICLES.has(text[i])) cuts.push(i + 1);
  }
  for (let i = from + minChars; i < to && i < text.length; i++) {
    for (const marker of START_MARKERS) {
      if (text.startsWith(marker, i)) {
        cuts.push(i);
        break;
      }
    }
  }
  return [...new Set(cuts)].sort((a, b) => a - b);
}

/** 片段是否仅由话语连接词/句末语气词构成（无实质内容）——不应独立成句，应并入下一句。 */
function isConnectiveOnly(text) {
  let rest = String(text || '').trim();
  while (rest) {
    let consumed = false;
    for (const marker of START_MARKERS) {
      if (rest.startsWith(marker)) { rest = rest.slice(marker.length).trimStart(); consumed = true; break; }
    }
    if (!consumed && END_PARTICLES.has(rest[0])) { rest = rest.slice(1).trimStart(); consumed = true; }
    if (!consumed) break;
  }
  return rest === '';
}

/** 纯 ASCII/空格文本按词切句。 */
function segmentLatin(text, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [words.join(' ')];
  const out = [];
  let buffer = [];
  for (const word of words) {
    buffer.push(word);
    if (buffer.length >= maxWords) {
      out.push(buffer.join(' '));
      buffer = [];
    }
  }
  if (buffer.length) out.push(buffer.join(' '));
  return out;
}

/** 无句末标点行：按“语气词/起始标记 + 长度”断成若干句（不含标点）。 */
function segmentUnpunctuated(text, opts) {
  const minChars = opts.minChars;
  const maxChars = opts.maxChars;
  if (!isCjkDominant(text)) {
    return segmentLatin(text, opts.maxWords);
  }
  const pieces = [];
  let start = 0;
  while (start < text.length) {
    const windowEnd = Math.min(start + maxChars, text.length);
    if (windowEnd - start < minChars) {
      pieces.push(text.slice(start));
      break;
    }
    const cuts = allCutsInWindow(start, windowEnd, text, minChars);
    let prev = start;
    for (const cut of cuts) {
      const frag = text.slice(prev, cut);
      if (isConnectiveOnly(frag)) continue; // 纯连接词/语气词片段并入下一句
      pieces.push(frag);
      prev = cut;
    }
    if (prev === start) {
      // 窗口内全是连接词/语气词（或无候选切点）：整体输出并前进，避免死循环
      let end = windowEnd;
      if (end < text.length) {
        // 硬切点可能截断夹在中文里的英文单词：回溯到最近空白后再切（纯中文无空白则不动）
        for (let j = end; j > start; j--) {
          if (/\s/.test(text[j - 1])) { end = j; break; }
        }
      }
      pieces.push(text.slice(start, end));
      start = end;
      continue;
    }
    start = prev;
  }
  return pieces;
}

/** 断句：输入一行文本，返回若干句（每句含句末标点；已带标点的行尊重原标点）。 */
function segmentLine(line, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const text = String(line || '').trim();
  if (!text) return [];
  if (hasEndPunct(text)) {
    const parts = splitAtExistingEnds(text);
    const out = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (hasEndPunct(trimmed)) {
        out.push(trimmed);
      } else {
        out.push(...punctuate(segmentUnpunctuated(trimmed, o)));
      }
    }
    return out;
  }
  return punctuate(segmentUnpunctuated(text, o));
}

/**
 * 全文断句：按物理行处理，保留空行结构，不跨行合并；返回“一句一行”的文本。
 */
function segmentTranscript(text) {
  const source = String(text == null ? '' : text);
  const lines = source.split('\n');
  const out = [];
  for (const rawLine of lines) {
    const line = String(rawLine).trim();
    if (!line) {
      out.push('');
      continue;
    }
    const sentences = segmentLine(line);
    if (sentences.length) out.push(...sentences);
  }
  return out.join('\n');
}

module.exports = { segmentLine, segmentTranscript, DEFAULT_OPTS };
