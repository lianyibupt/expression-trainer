# macOS DMG and downloadable resources implementation plan

> **For agentic workers:** Execute in order in the current session. User approved the application scope and icon on 2026-10-30. Do not publish releases or include personal settings or meeting data.

**Goal:** Build an Apple Silicon trial DMG named 智能会议和表达训练, preserving all capabilities and providing explicit in-app preparation of local runtimes and models.

**Architecture:** Keep Electron, the Swift system-audio helper, JS code, dictionaries and worker scripts in the application. Download a pinned portable CPython distribution, create separate app-managed ASR and emotion environments, and download models pinned to upstream revisions with integrity checks. Store resources outside the application in its userData directory. Preserve development environment fallbacks only when running from source.

**Tech Stack:** Electron 45.1.0, electron-builder 26, Node built-ins, portable CPython 3.13, Python pip and existing ASR/emotion workers, Swift ScreenCaptureKit. Release audit required upgrading the previous Electron 33 runtime; minimum packaged macOS version is 14 because the PyTorch wheels require it.

## 1. Resource paths and integrity

- [x] Add behavior tests for installed versus development paths, archive/path safety, checksums, interrupted downloads and installation status.
- [x] Run tests before implementation and confirm missing behavior fails.
- [x] Implement `lib/runtime-paths.js`, `lib/resource-download.js`, `lib/resource-manager.js`, and a pinned upstream resource catalog. Use HTTPS, bounded retries, cancellation, atomic downloads and explicit installation markers.
- [x] Keep Python execution outside ASAR and use actual worker files through extraResources.

## 2. Resource preparation UI and runtime integration

- [x] Add a resources window, main-menu/settings entry, IPC and progress events. Show first-run guidance, download sizes, readiness, retry and cancellation without initiating downloads during recording.
- [x] Wire app-managed model/Python/ffmpeg paths into ASR, emotion, openSMILE and audio import while preserving existing source-run behavior.
- [x] Verify installation by importing required packages and checking model contents before reporting ready.
- [x] Add download bootstrap for portable Python and isolated dependency environments; use upstream models and package indexes, never local credentials or meeting files.

## 3. Packaging

- [x] Install electron-builder as a project dev dependency, pin its stable major, and add arm64 build commands.
- [x] Apply approved name and icon; preserve existing user data across rename.
- [x] Add an explicit packaging allowlist, unpack Sherpa native binaries, build/copy the release helper and workers, and configure microphone/system-capture permission descriptions.
- [x] Build an ad-hoc signed trial application and DMG; no Developer ID certificate or notarization is currently available.
- [x] Inspect the archive for accidental settings, recordings, caches, models and venvs.

## 4. Verification and handoff

- [x] Run focused resource tests and the existing Node suite.
- [x] Exercise resource downloading with a clean, temporary app data directory; verify portable Python and native module loading from packaged paths.
- [x] Launch the packaged app, check resource/settings UI, clean defaults and name/icon metadata.
- [x] Document install/use steps, official download origins, license notices, measured artifact size and remaining real-device permission/inference checks.

**Release boundaries:** No GitHub publication, paid-account enrollment, certificate creation, or automatic updates. No real API keys, personal settings or meeting artifacts in the package. Resource download availability depends on access to GitHub, Hugging Face and PyPI; display network errors and allow retry.

## Verification evidence

- Node suite: 188 passed, 0 failed.
- Existing Electron workflow integration: passed with Electron 45.1.0 (real IPC, temporary archives, local model stub, restart/history, save/exit and renderer-crash handling).
- Packaged UI, empty keys, audio environment download, realtime model download and native recognizer start/feed/stop: passed on both the initial package and the final Electron 45.1.0 package.
- New standalone Python environments: ASR, emotion and audio probes passed; the full tested package sets are pinned in `lib/runtime-requirements.json`.
- Packaged Python workers: Qwen final transcription plus speaker clustering, openSMILE extraction and emotion inference completed on synthetic audio with the new environments. Existing Qwen/emotion model caches were copied into the temporary test directory and checked against upstream hashes; they were not all downloaded again.
- SenseVoice model downloaded and initialized successfully; synthetic audio feed and final recognition completed.
- Ad-hoc package signature, privacy exclusions and sidecar files verified.
- Remaining manual acceptance: real microphone/system-audio permissions and routing, sleep/wake, and a second Mac without a development setup. No external release was published.

Final DMG: `dist/MeetingExpressionTrainer-1.0.0-arm64.dmg`, 144,234,447 bytes. Disk image checksum and a read-only mount inspection passed; the image was detached. Mounted app signature and privacy exclusions passed. Packaged code/data match 43 current workspace files. Final audit: zero npm advisories. Temporary verification environments and copied weights were removed after checks.
