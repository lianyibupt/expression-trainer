# Third-party software and downloadable resources

This trial application is intended for personal, non-commercial use. Each dependency and model remains subject to its own license. The application's MIT license does not replace third-party terms. No AI service account or API key is included.

## Included in the application

- Electron / Chromium / Node.js: Electron's MIT license and Chromium/Node third-party notices are included with the Electron distribution. https://github.com/electron/electron
- sherpa-onnx: Apache-2.0; native libraries retain their upstream notices. https://github.com/k2-fsa/sherpa-onnx
- System audio helper: project code using Apple's ScreenCaptureKit, AVFoundation and CoreMedia frameworks. The frameworks are provided by macOS.

## Downloaded only when requested

- Portable CPython: Astral's Python Build Standalone, release 20261026, CPython 3.13.18, Apple Silicon. This is a portable CPython distribution with additional component licenses; retain the license files included in its archive. https://github.com/astral-sh/python-build-standalone
- Paraformer streaming bilingual ONNX model: https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en
- Qwen3-ASR-1.7B and qwen-asr: https://huggingface.co/Qwen/Qwen3-ASR-1.7B and https://github.com/QwenLM/Qwen3-ASR
- SenseVoice ONNX model: retain its downloaded LICENSE and README. https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17
- emotion2vec_plus_base: its model card declares `license: other` / `model-license` and references FunASR. No general commercial or redistribution permission is asserted here. The application downloads model files from the upstream repository at the pinned revision rather than redistributing a local modified copy. https://huggingface.co/emotion2vec/emotion2vec_plus_base
- FunASR: https://github.com/modelscope/FunASR
- PyTorch / torchaudio: retain installed wheel license and notice files. https://pytorch.org/
- scikit-learn: BSD-3-Clause. https://scikit-learn.org/
- openSMILE: audEERING research license; commercial product use requires separate permission/license. Do not assume that a free trial or a free-of-charge product grants commercial rights. https://github.com/audeering/opensmile/blob/master/doc/sphinx/about.rst
- imageio-ffmpeg: BSD-2-Clause Python wrapper. Its bundled FFmpeg executable has separate FFmpeg licensing and build configuration, retained in the installed wheel. https://github.com/imageio/imageio-ffmpeg and https://ffmpeg.org/legal.html
- Transitive Python packages retain the license/metadata files in their installed distributions.

The exact model revisions, file sizes and integrity hashes are recorded in `lib/resource-catalog.json`. The complete tested Python package versions are pinned in `lib/runtime-requirements.json`; the portable Python version is recorded in `lib/resource-manager.js`. Models and dependencies are downloaded from GitHub, Hugging Face and PyPI. Network availability is required for preparation; local inference does not initiate model downloads. Remote AI generation uses the provider explicitly configured by the user.
