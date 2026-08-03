# System Audio Helper POC

This is a stage-one macOS native helper proof of concept. It uses ScreenCaptureKit to capture system output audio and writes a short mono WAV file.

## Build

From the repository root:

```bash
npm run build:system-audio-helper
```

Or from this directory:

```bash
swift build
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

This helper is intentionally not wired into the Electron app yet. Once the WAV proof is successful on this machine, the next step is to stream PCM chunks from the helper to Electron and mix them with microphone audio for ASR.
