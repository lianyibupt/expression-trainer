const fs = require('fs');
const ExpressionAnalysis = require('../src/expression-analysis');

const SAMPLE_RATE = 16000;
const FRAME_SECONDS = 0.05;
const FRAME_SIZE = Math.round(SAMPLE_RATE * FRAME_SECONDS);

function readWav16kMono(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('只支持 PCM WAV 录音文件');
  }
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  const dataOffset = buffer.indexOf(Buffer.from('data'), 12);
  if (channels !== 1 || sampleRate !== SAMPLE_RATE || bitsPerSample !== 16 || dataOffset < 0) {
    throw new Error('音频格式不是 16kHz、单声道、16-bit PCM');
  }
  const dataSize = buffer.readUInt32LE(dataOffset + 4);
  const samples = new Float32Array(Math.floor(dataSize / 2));
  const start = dataOffset + 8;
  for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(start + i * 2) / 32768;
  return samples;
}

function analyzeAudioFile(filePath) {
  const samples = readWav16kMono(filePath);
  if (!samples.length) throw new Error('录音为空');

  const frames = [];
  for (let offset = 0; offset < samples.length; offset += FRAME_SIZE) {
    const end = Math.min(offset + FRAME_SIZE, samples.length);
    let energy = 0;
    let peak = 0;
    let crossings = 0;
    for (let i = offset; i < end; i++) {
      const value = samples[i];
      energy += value * value;
      peak = Math.max(peak, Math.abs(value));
      if (i > offset && Math.sign(value) !== Math.sign(samples[i - 1])) crossings++;
    }
    const rms = Math.sqrt(energy / Math.max(1, end - offset));
    frames.push({ rms, peak, crossings, duration: (end - offset) / SAMPLE_RATE });
  }

  // Use the quietest frames as the noise estimate; meetings can start while someone is already speaking.
  const sortedRms = frames.map(frame => frame.rms).sort((a, b) => a - b);
  const quietFrameCount = Math.max(1, Math.ceil(sortedRms.length * 0.2));
  const noiseFloor = sortedRms.slice(0, quietFrameCount).reduce((sum, rms) => sum + rms, 0) / quietFrameCount;
  const speechThreshold = Math.max(0.008, noiseFloor * 2.2);
  const speechFrames = frames.filter(frame => frame.rms >= speechThreshold);
  const silenceFrames = frames.length - speechFrames.length;
  const rmsMean = frames.reduce((sum, frame) => sum + frame.rms, 0) / frames.length;
  const rmsPeak = Math.max(...frames.map(frame => frame.peak));
  const activeSeconds = speechFrames.reduce((sum, frame) => sum + frame.duration, 0);
  const silenceSeconds = silenceFrames * FRAME_SECONDS;
  const energyChanges = frames.slice(1).filter((frame, index) => {
    const previous = frames[index].rms;
    return Math.abs(frame.rms - previous) > Math.max(0.015, rmsMean * 0.7);
  }).length;
  const timeline = [];
  const windowFrameCount = Math.max(1, Math.round(30 / FRAME_SECONDS));
  for (let offset = 0; offset < frames.length; offset += windowFrameCount) {
    const window = frames.slice(offset, offset + windowFrameCount);
    const active = window.filter(frame => frame.rms >= speechThreshold).length / window.length;
    const energy = window.reduce((sum, frame) => sum + frame.rms, 0) / window.length;
    const label = active < 0.45 ? '停顿较多' : energy > rmsMean * 1.35 ? '能量偏高' : energy < rmsMean * 0.65 ? '能量偏低' : '相对平稳';
    timeline.push({
      startSeconds: Number((offset * FRAME_SECONDS).toFixed(2)),
      endSeconds: Number(Math.min(samples.length / SAMPLE_RATE, (offset + window.length) * FRAME_SECONDS).toFixed(2)),
      label,
      speechRatio: Number(active.toFixed(3)),
      averageRms: Number(energy.toFixed(4))
    });
  }

  const speakingFrames = speechFrames.length;
  const framePitch = speechFrames
    .map(frame => (frame.crossings / Math.max(1, frame.duration)) / 2)
    .filter(value => value >= 70 && value <= 500);
  const averagePitch = framePitch.length
    ? framePitch.reduce((sum, value) => sum + value, 0) / framePitch.length
    : 0;
  const pitchVariation = framePitch.length > 1
    ? Math.sqrt(framePitch.reduce((sum, value) => sum + (value - averagePitch) ** 2, 0) / framePitch.length)
    : 0;

  const baseAnalysis = {
    version: 1,
    sampleRate: SAMPLE_RATE,
    durationSeconds: Number((samples.length / SAMPLE_RATE).toFixed(2)),
    activeSpeechSeconds: Number(activeSeconds.toFixed(2)),
    silenceSeconds: Number(Math.max(0, silenceSeconds).toFixed(2)),
    speechRatio: Number((activeSeconds / Math.max(0.01, samples.length / SAMPLE_RATE)).toFixed(3)),
    averageRms: Number(rmsMean.toFixed(4)),
    peakAmplitude: Number(rmsPeak.toFixed(4)),
    energyChangeCount: energyChanges,
    averagePitchHz: Number(averagePitch.toFixed(1)),
    pitchVariationHz: Number(pitchVariation.toFixed(1)),
    speechFrameCount: speakingFrames,
    timeline,
    speechThreshold: Number(speechThreshold.toFixed(4)),
    interpretation: {
      energy: rmsMean < 0.03 ? '低' : rmsMean > 0.12 ? '高' : '中等',
      pauseLoad: silenceSeconds / Math.max(0.01, samples.length / SAMPLE_RATE) > 0.45 ? '较高' : '常规',
      stability: energyChanges / Math.max(1, frames.length) > 0.25 ? '变化明显' : '相对稳定'
    },
    limitations: [
      '这是基于音量、音高和静音的本地基线分析，不等同于情绪或心理状态判断。',
      '麦克风距离、系统音频混入和环境噪声会影响结果。'
    ]
  };
  return baseAnalysis;
}

const EMOTION_TERMS = {
  agreement: ['同意', '赞同', '可以', '支持', '没问题', '认可', '确实', '对的', '很好'],
  concern: ['担心', '风险', '问题', '不确定', '疑问', '顾虑', '可能不行', '来不及'],
  frustration: ['不行', '不能', '不对', '不合理', '太慢', '反复', '已经说过', '没法'],
  excitement: ['机会', '突破', '增长', '很棒', '特别好', '兴奋', '成功', '亮点'],
  sarcasmRisk: ['呵呵', '随便', '都可以', '你说了算', '行吧', '无所谓']
};

function countTerms(text, terms) {
  return terms.reduce((count, term) => count + (String(text || '').split(term).length - 1), 0);
}

function wordCount(text) {
  return String(text || '').replace(/\s/g, '').length;
}

function buildSpeakerStats(segments) {
  const speakers = new Map();
  const sorted = [...segments].sort((a, b) => Number(a.start || 0) - Number(b.start || 0));
  let interruptions = 0;
  let overlapSeconds = 0;
  let responseDelays = [];

  sorted.forEach((segment, index) => {
    const speaker = segment.speaker || `说话人 ${Number(segment.speakerIndex || 0) + 1}`;
    const start = Number(segment.start || 0);
    const end = Number(segment.end || start);
    const duration = Math.max(0, end - start);
    const current = speakers.get(speaker) || {
      speaker, turnCount: 0, speakingSeconds: 0, words: 0, fillers: 0, hedges: 0
    };
    const text = String(segment.text || '');
    current.turnCount += 1;
    current.speakingSeconds += duration;
    current.words += wordCount(text);
    const local = ExpressionAnalysis.analyze(text);
    current.fillers += local?.fillers.length || 0;
    current.hedges += local?.hedges.length || 0;
    speakers.set(speaker, current);

    if (index > 0) {
      const previous = sorted[index - 1];
      const previousEnd = Number(previous.end || 0);
      const gap = start - previousEnd;
      if (gap < 0) {
        overlapSeconds += Math.abs(gap);
        if (previous.speaker !== speaker) interruptions += 1;
      } else if (previous.speaker !== speaker && gap <= 4) {
        responseDelays.push(gap);
      }
    }
  });

  const totalSeconds = [...speakers.values()].reduce((sum, item) => sum + item.speakingSeconds, 0);
  const result = [...speakers.values()].map(item => ({
    ...item,
    speakingSeconds: Number(item.speakingSeconds.toFixed(2)),
    participation: Number((item.speakingSeconds / Math.max(0.01, totalSeconds)).toFixed(3)),
    wordsPerMinute: Number((item.words / Math.max(0.01, item.speakingSeconds) * 60).toFixed(1))
  }));
  const shares = result.map(item => item.participation).filter(Boolean);
  const participationBalance = shares.length > 1
    ? Number((1 - Math.sqrt(shares.reduce((sum, share) => sum + (share - 1 / shares.length) ** 2, 0) / shares.length) * 2).toFixed(3))
    : 1;
  return {
    speakerCount: result.length,
    speakers: result,
    turnCount: sorted.length,
    interruptions,
    overlapSeconds: Number(overlapSeconds.toFixed(2)),
    averageResponseDelaySeconds: responseDelays.length
      ? Number((responseDelays.reduce((sum, value) => sum + value, 0) / responseDelays.length).toFixed(2))
      : null,
    participationBalance
  };
}

function buildConversationAnalysis(audioAnalysis, transcription) {
  const segments = Array.isArray(transcription?.speaker_segments) ? transcription.speaker_segments : [];
  const text = transcription?.text || segments.map(segment => segment.text).join('');
  const interaction = buildSpeakerStats(segments);
  const sentiment = Object.fromEntries(Object.keys(EMOTION_TERMS).map(key => [key, countTerms(text, EMOTION_TERMS[key])]));
  const sentences = String(text).split(/[。！？!?\n]+/).map(item => item.trim()).filter(Boolean);
  const longSentences = sentences.filter(item => wordCount(item) > 55).length;
  const questions = (String(text).match(/[？?]/g) || []).length;
  const conclusions = (String(text).match(/(结论|所以|总之|最终|决定|下一步|我们要|建议)/g) || []).length;
  const local = ExpressionAnalysis.analyze(text);
  const fillers = local?.fillers.length || 0;
  const hedges = local?.hedges.length || 0;
  const clarity = {
    sentenceCount: sentences.length,
    longSentenceCount: longSentences,
    questionCount: questions,
    conclusionSignalCount: conclusions,
    fillerCount: fillers,
    hedgeCount: hedges,
    informationDensity: (local?.density ?? 100) / 100,
    analysisVersion: 2
  };
  const nonVerbal = {
    laughterCount: (String(text).match(/(哈哈|呵呵|笑了|笑声)/g) || []).length,
    sighCount: (String(text).match(/(叹气|唉|哎|呼气)/g) || []).length,
    hesitationCount: (String(text).match(/(嗯|呃|额|这个那个)/g) || []).length
  };
  const signalTotal = Object.values(sentiment).reduce((sum, value) => sum + value, 0);
  const atmosphere = sentiment.frustration > sentiment.agreement && sentiment.frustration > 1
    ? '分歧风险'
    : sentiment.concern > sentiment.excitement && sentiment.concern > 1
      ? '谨慎担忧'
      : sentiment.excitement > sentiment.concern && sentiment.excitement > 1
        ? '积极投入'
        : '相对平稳';
  const tone = audioAnalysis.pitchVariationHz > 70 || audioAnalysis.energyChangeCount > audioAnalysis.speechFrameCount * 0.18
    ? '变化明显'
    : audioAnalysis.speechRatio < 0.35 ? '低能量/谨慎' : '相对稳定';
  return {
    version: 2,
    audio: audioAnalysis,
    atmosphere: { label: atmosphere, tone, sentiment, nonVerbal, signalCount: signalTotal },
    interaction,
    clarity,
    limitations: [
      '会后文本线索来自关键词计数，不等同于语音情绪识别或真实内心状态。',
      '实时语气分类请在会议进行中的语气反馈面板查看。'
    ]
  };
}

module.exports = { analyzeAudioFile, buildConversationAnalysis, buildSpeakerStats, readWav16kMono };
