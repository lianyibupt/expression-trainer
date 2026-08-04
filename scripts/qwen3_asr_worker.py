#!/usr/bin/env python3
"""Run Qwen3-ASR final transcription for a local wav file.

This worker is intentionally isolated from the Electron/Node runtime. Install
the Python dependency in a separate environment with:

    pip install -U qwen-asr

Then point QWEN3_ASR_PYTHON to that environment's python executable if needed.
"""

import argparse
import json
import os
import sys


def parse_args():
    parser = argparse.ArgumentParser(description="Qwen3-ASR transcription worker")
    parser.add_argument("--model", required=True, help="Local model path or HuggingFace model id")
    parser.add_argument("--audio", required=True, help="Local wav file path")
    parser.add_argument("--language", default="Chinese", help="Language hint, or auto/none")
    parser.add_argument("--device-map", default=os.environ.get("QWEN3_ASR_DEVICE_MAP", "auto"))
    parser.add_argument("--max-new-tokens", type=int, default=int(os.environ.get("QWEN3_ASR_MAX_NEW_TOKENS", "4096")))
    parser.add_argument("--batch-size", type=int, default=int(os.environ.get("QWEN3_ASR_BATCH_SIZE", "1")))
    return parser.parse_args()


def main():
    args = parse_args()

    try:
        import torch
        from qwen_asr import Qwen3ASRModel
    except Exception as exc:  # pragma: no cover - exercised in user env
        print(
            "Missing Python dependency. Install it with: pip install -U qwen-asr\n"
            f"Original error: {exc}",
            file=sys.stderr,
        )
        return 2

    language = args.language
    if language.lower() in {"", "none", "null", "auto"}:
        language = None

    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32

    model = Qwen3ASRModel.from_pretrained(
        args.model,
        dtype=dtype,
        device_map=args.device_map,
        max_inference_batch_size=args.batch_size,
        max_new_tokens=args.max_new_tokens,
    )

    results = model.transcribe(audio=args.audio, language=language)
    first = results[0]
    print(json.dumps({
        "language": getattr(first, "language", None),
        "text": getattr(first, "text", ""),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
