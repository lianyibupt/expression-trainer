#!/usr/bin/env python3
"""Persistent, local-only emotion2vec+ inference. stdout is NDJSON."""
import argparse
import base64
import contextlib
import json
import os
from pathlib import Path
import sys


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    args = parser.parse_args()
    model_path = Path(args.model).resolve()
    if not (model_path / 'config.yaml').is_file():
        raise RuntimeError('本地 emotion2vec+ 模型不完整，请运行 scripts/setup_emotion.py')
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        import torch
        from funasr import AutoModel
        torch.set_num_threads(2)
        model = AutoModel(model=str(model_path), device='cpu', disable_update=True, disable_pbar=True)
    emit({'ready': True})
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            samples = np.frombuffer(base64.b64decode(request['pcm'], validate=True), dtype='<f4').copy()
            if len(samples) != 96000 or not np.isfinite(samples).all():
                raise ValueError('需要 6 秒 16 kHz 有限数值 PCM')
            with contextlib.redirect_stdout(sys.stderr):
                result = model.generate(input=samples, granularity='utterance', extract_embedding=False)[0]
            emit({'id': request['id'], 'labels': result['labels'], 'scores': [float(x) for x in result['scores']]})
        except Exception as error:
            emit({'id': request.get('id'), 'error': str(error)})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit({'error': str(error)})
        sys.exit(1)
