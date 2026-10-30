module.exports = {
  appId: 'io.github.lianyibupt.expressiontrainer',
  productName: '智能会议和表达训练',
  artifactName: 'MeetingExpressionTrainer-${version}-${arch}.${ext}',
  directories: { output: 'dist', buildResources: 'build' },
  asar: true,
  files: [
    'main.js', 'preload.js', 'package.json', 'lib/**/*.js', 'lib/resource-catalog.json', 'lib/runtime-requirements.json',
    'src/**', 'data/**', 'LICENSE', 'THIRD_PARTY_NOTICES.md'
  ],
  asarUnpack: ['node_modules/sherpa-onnx-*/**'],
  extraResources: [
    { from: 'native/system-audio-helper/.build/release/system-audio-probe', to: 'bin/system-audio-probe' },
    { from: 'scripts/qwen3_asr_worker.py', to: 'workers/qwen3_asr_worker.py' },
    { from: 'scripts/opensmile_worker.py', to: 'workers/opensmile_worker.py' },
    { from: 'scripts/emotion_worker.py', to: 'workers/emotion_worker.py' }
  ],
  npmRebuild: false,
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }],
    icon: 'build/icons/app-icon-v1.icns',
    category: 'public.app-category.productivity',
    minimumSystemVersion: '14.0',
    identity: '-',
    hardenedRuntime: false,
    notarize: false,
    extendInfo: {
      NSMicrophoneUsageDescription: '用于记录你的发言，生成本地会议逐字稿并提供表达训练反馈。',
      NSScreenCaptureUsageDescription: '用于采集会议或其他应用播放的系统声音，生成本地会议记录。',
      NSAudioCaptureUsageDescription: '用于采集会议播放的系统音频。',
      NSHighResolutionCapable: true
    }
  },
  dmg: {
    title: '智能会议和表达训练',
    sign: false,
    contents: [{ x: 140, y: 150 }, { x: 420, y: 150, type: 'link', path: '/Applications' }, { x: 280, y: 270, type: 'file', path: 'build/安装说明.txt' }],
    window: { width: 560, height: 360 }
  }
};
