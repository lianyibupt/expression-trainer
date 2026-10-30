# Recording Audio Sources Implementation Plan

> Execution: inline in this conversation, as authorized by the user's approval of the design.

**Goal:** Add independent microphone and system-output controls before and during recording.

**Architecture:** Extract a browser/Node-compatible RecordingAudioRouter in src/recording-audio.js. Route microphone and system streams to separate channels, mix only enabled sources, and use a silent constant source to keep callbacks running without a microphone. Reuse the router for recording and automatic meeting listening.

**Tech Stack:** Electron, Web Audio, browser JavaScript, node:test; existing native audio helper and IPC.

- [x] Add test/recording-audio.test.js with a controlled Web Audio graph and delayed device acquisition. Verify output-only capture, post-disable sample exclusion, track release, native queue flushing, failed enabling, and stop/acquisition races. Run `node --test test/recording-audio.test.js` and observe missing router failure.
- [x] Implement src/recording-audio.js: per-source serial device operations, immediate disable gates, stream cleanup, bounded native queues, actual channel mixing, silent callback driver, and idempotent close. Repeat the focused test until passing.
- [x] Update src/index.html and src/styles.css with two aria-pressed toggle buttons and a source status message. Load recording-audio.js before app.js.
- [x] Update src/app.js to initialize source choices, wire buttons, reuse the router for recording/listening, force explicit system-output requests regardless of default setting, and release in-flight device requests on stop. Update src/workspace.js to retain choices across meetings in the same window and disable controls during capture transitions.
- [x] Add fixed source-state entries to main.js terminal logging, and document source controls and capture boundaries in README.md.
- [x] Run `node --test test/*.test.js`, `node --check` on changed scripts, and `git diff --check`.
- [x] Run a temporary-profile Electron smoke test with synthetic microphone/system streams through the real Web Audio graph. Verify actual captured samples, UI controls during recording, output-only operation without microphone requests, live switching, track cleanup, and terminal logs. Keep real microphones, meeting content and remote AI out of this automated test.

Verification evidence: six focused routing tests and all 105 Node tests passed. Temporary-profile Electron smoke used real Web Audio graphs and synthetic sources; actual sample means across output-only/mixed/output-only/all-off/resumed-output stages were 0.2, 0.5, 0.2, 0, 0.2. Verified microphone track stop, pause gating, source inheritance and output-only listening. No real microphone, OS output permissions, meeting content, or remote AI was used.

Final verification: all 111 tests in the latest shared workspace passed (0 failures); the focused routing/recording/mixing/activity set passed 16/16. The final Electron smoke also checked that an unavailable system-output source leaves microphone capture off and keeps both source and startup errors visible. Concurrent emotion-recognition edits were preserved.
