#!/usr/bin/env python3
"""Install the isolated SER runtime and model; never sends meeting audio."""
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / '.venv-emotion' / 'bin' / 'python'


def main():
    if Path(sys.prefix).resolve() != (ROOT / '.venv-emotion').resolve():
        if not PYTHON.exists():
            asr_python = ROOT / '.venv-qwen3-asr' / 'bin' / 'python'
            bootstrap = str(asr_python) if asr_python.exists() else sys.executable
            subprocess.run([bootstrap, '-m', 'venv', str(ROOT / '.venv-emotion')], check=True)
        subprocess.run([str(PYTHON), str(Path(__file__).resolve())], check=True)
        return
    subprocess.run([str(PYTHON), '-m', 'pip', 'install', '--cache-dir', str(ROOT / '.pip-cache'),
                    '-r', str(ROOT / 'scripts' / 'requirements-emotion.txt')], check=True)
    os.environ.pop('HF_HUB_OFFLINE', None)
    os.environ['HF_HUB_DISABLE_XET'] = '1'
    from huggingface_hub import snapshot_download
    snapshot_download('emotion2vec/emotion2vec_plus_base', local_dir=str(ROOT / 'models' / 'emotion2vec_plus_base'),
                      cache_dir=str(ROOT / '.pip-cache' / 'huggingface'))
    print('本地语气模型已安装。重新开始录音即可启用。')


if __name__ == '__main__':
    main()
