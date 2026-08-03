# System Audio Helper

This is the macOS native system-audio helper for Expression Trainer. It uses ScreenCaptureKit to capture system output audio. The Electron app starts it in JSON streaming mode and mixes the returned 16 kHz mono PCM samples with microphone audio before sending audio to ASR.

The helper can also run as a standalone probe that writes a short mono WAV file for permission and capture validation.

## Build

From the repository root:

```bash
npm run build:system-audio-helper
```

Or from this directory:

```bash
CLANG_MODULE_CACHE_PATH=.build/clang-module-cache swift build --cache-path .build/swiftpm-cache
```

## Run Probe

Play some system audio first, then run:

```bash
npm run probe:system-audio
```

The default output is:

```text
/tmp/system-audio-probe.wav
```

To customize duration/output:

```bash
cd native/system-audio-helper
.build/debug/system-audio-probe --duration 10 --out /tmp/system-audio-probe.wav
```

## Run Stream Mode

Electron uses this mode internally:

```bash
cd native/system-audio-helper
.build/debug/system-audio-probe --stream-json
```

Expected stdout events include:

```json
{"event":"started","out":"/tmp/system-audio-probe.wav","streamJson":true}
{"event":"samples","sampleRate":16000,"samples":"<base64 float32 little-endian>"}
```

Stop stream mode with `Ctrl+C` when running manually.

## Permission

If you see:

```json
{"event":"permission_required"}
```

grant Screen Recording / Screen & System Audio Recording permission to the app that launched the command. In development that is usually Terminal, iTerm, or Codex, not this helper binary itself.

Then fully quit and restart that app, rebuild if needed, and run the probe again.

## Success Criteria

The probe succeeds when:

- It prints `started` and `audio` RMS events.
- It prints `finished` with a non-zero sample count.
- `/tmp/system-audio-probe.wav` contains the system audio you played, even if your microphone was silent.

In the main app, enable “录制系统输出声音”. The capture order is Native helper first, then configured virtual input device, then Electron loopback fallback.
