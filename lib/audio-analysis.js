const fs = require('fs');

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

  return {
    version: 1,
    sampleRate: SAMPLE_RATE,
    durationSeconds: Number((samples.length / SAMPLE_RATE).toFixed(2)),
    activeSpeechSeconds: Number(activeSeconds.toFixed(2)),
    silenceSeconds: Number(Math.max(0, silenceSeconds).toFixed(2)),
    speechRatio: Number((activeSeconds / Math.max(0.01, samples.length / SAMPLE_RATE)).toFixed(3)),
    averageRms: Number(rmsMean.toFixed(4)),
    peakAmplitude: Number(rmsPeak.toFixed(4)),
    energyChangeCount: energyChanges,
    timeline,
    speechThreshold: Number(speechThreshold.toFixed(4)),
    interpretation: {
      energy: rmsMean < 0.03 ? '低' : rmsMean > 0.12 ? '高' : '中等',
      pauseLoad: silenceSeconds / Math.max(0.01, samples.length / SAMPLE_RATE) > 0.45 ? '较高' : '常规',
      stability: energyChanges / Math.max(1, frames.length) > 0.25 ? '变化明显' : '相对稳定'
    },
    limitations: [
      '这是基于音量和静音的本地基线分析，不等同于情绪或心理状态判断。',
      '混合录音无法可靠区分每位说话人的音高、音量和语速。',
      '麦克风距离、系统音频混入和环境噪声会影响结果。'
    ]
  };
}

module.exports = { analyzeAudioFile, readWav16kMono };
