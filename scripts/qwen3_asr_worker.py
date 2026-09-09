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

import numpy as np


def parse_args():
    parser = argparse.ArgumentParser(description="Qwen3-ASR transcription worker")
    parser.add_argument("--model", required=True, help="Local model path or HuggingFace model id")
    parser.add_argument("--audio", help="Local wav file path")
    parser.add_argument("--language", default="auto", help="Language hint, or auto/none")
    parser.add_argument("--device-map", default=os.environ.get("QWEN3_ASR_DEVICE_MAP", "auto"))
    parser.add_argument("--max-new-tokens", type=int, default=int(os.environ.get("QWEN3_ASR_MAX_NEW_TOKENS", "4096")))
    parser.add_argument("--batch-size", type=int, default=int(os.environ.get("QWEN3_ASR_BATCH_SIZE", "1")))
    parser.add_argument("--chunk-seconds", type=float, default=float(os.environ.get("QWEN3_ASR_CHUNK_SECONDS", "45")), help="Maximum audio seconds per inference batch")
    parser.add_argument("--speaker-diarization", action="store_true", help="Cluster local voice features and transcribe each speaker turn")
    parser.add_argument("--check", action="store_true", help="Only check Python dependencies")
    return parser.parse_args()


def emit_progress(stage, processed_seconds, total_seconds, detail=""):
    print(json.dumps({
        "progress": True,
        "stage": stage,
        "processedSeconds": round(float(processed_seconds), 2),
        "totalSeconds": round(float(total_seconds), 2),
        "detail": detail,
    }, ensure_ascii=False), flush=True)


SAMPLE_RATE = 16000


def normalize_language(value):
    """Map worker language hints to qwen_asr accepted values.

    None -> auto detection (recommended for mixed zh/en speech).
    Single token -> that language string.
    Comma separated -> list of languages (requires a qwen-asr release that
    supports per-utterance language lists).
    """
    if value is None:
        return None
    raw = str(value).strip()
    if raw.lower() in {"", "none", "null", "auto"}:
        return None
    known = {"chinese": "Chinese", "english": "English"}
    tokens = [tok.strip() for tok in raw.split(",") if tok.strip()]
    if not tokens:
        return None
    if len(tokens) == 1:
        token = tokens[0]
        return known.get(token.lower(), token)
    return [known.get(tok.lower(), tok) for tok in tokens]


def read_wav(path):
    import wave

    with wave.open(path, "rb") as wav:
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())

    if sample_width == 2:
        samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    elif sample_width == 4:
        samples = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"Unsupported WAV sample width: {sample_width}")

    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    if rate != SAMPLE_RATE:
        raise ValueError(f"Expected {SAMPLE_RATE}Hz WAV, got {rate}Hz")
    return samples


def find_speech_segments(samples):
    """Return coarse speech turns from energy. Speaker clustering happens later."""
    frame_size = int(SAMPLE_RATE * 0.025)
    hop_size = int(SAMPLE_RATE * 0.010)
    if len(samples) < frame_size:
        return []

    frame_count = 1 + (len(samples) - frame_size) // hop_size
    frames = np.lib.stride_tricks.as_strided(
        samples,
        shape=(frame_count, frame_size),
        strides=(samples.strides[0] * hop_size, samples.strides[0]),
        writeable=False,
    )
    rms = np.sqrt(np.mean(frames * frames, axis=1) + 1e-10)
    db = 20 * np.log10(rms + 1e-7)

    noise_floor = float(np.percentile(db, 35))
    peak = float(np.percentile(db, 98))
    dynamic_range = peak - noise_floor
    threshold = max(peak - 38.0, -48.0)
    if dynamic_range >= 8.0:
        threshold = max(threshold, noise_floor + 7.0)
    active = db >= threshold

    # Fill short pauses so one sentence does not become many tiny turns.
    max_gap_frames = int(0.35 / 0.010)
    index = 0
    while index < len(active):
        if active[index]:
            index += 1
            continue
        end = index
        while end < len(active) and not active[end]:
            end += 1
        if index > 0 and end < len(active) and end - index <= max_gap_frames:
            active[index:end] = True
        index = end

    raw = []
    start = None
    for index, is_active in enumerate(active):
        if is_active and start is None:
            start = index
        if start is not None and (not is_active or index == len(active) - 1):
            end = index if not is_active else index + 1
            start_sec = start * 0.010
            end_sec = min(len(samples) / SAMPLE_RATE, (end * hop_size + frame_size) / SAMPLE_RATE)
            if end_sec - start_sec >= 0.65:
                raw.append([start_sec, end_sec])
            start = None

    # Keep clustering windows within a manageable duration and avoid huge text chunks.
    segments = []
    for start_sec, end_sec in raw:
        while end_sec - start_sec > 12.0:
            segments.append([start_sec, start_sec + 10.0])
            start_sec += 10.0
        if end_sec - start_sec >= 0.65:
            segments.append([start_sec, end_sec])
    return segments


def mel_filterbank(sample_rate, n_fft, n_mels=32, low_hz=80, high_hz=7600):
    def hz_to_mel(hz):
        return 2595 * np.log10(1 + hz / 700)

    def mel_to_hz(mel):
        return 700 * (10 ** (mel / 2595) - 1)

    mel_points = np.linspace(hz_to_mel(low_hz), hz_to_mel(high_hz), n_mels + 2)
    bins = np.floor((n_fft + 1) * mel_to_hz(mel_points) / sample_rate).astype(int)
    bank = np.zeros((n_mels, n_fft // 2 + 1), dtype=np.float32)
    for index in range(1, n_mels + 1):
        left, center, right = bins[index - 1:index + 2]
        if center <= left or right <= center:
            continue
        bank[index - 1, left:center] = np.linspace(0, 1, center - left, endpoint=False)
        bank[index - 1, center:right] = np.linspace(1, 0, right - center, endpoint=False)
    return bank


def voice_embedding(samples, bank):
    """A compact timbre descriptor; this is intentionally model-free and local."""
    frame_size = 512
    hop_size = int(SAMPLE_RATE * 0.010)
    if len(samples) < frame_size:
        samples = np.pad(samples, (0, frame_size - len(samples)))
    frame_count = max(1, 1 + (len(samples) - frame_size) // hop_size)
    frames = np.lib.stride_tricks.as_strided(
        samples,
        shape=(frame_count, frame_size),
        strides=(samples.strides[0] * hop_size, samples.strides[0]),
        writeable=False,
    ).copy()
    window = np.hanning(frame_size).astype(np.float32)
    spectrum = np.abs(np.fft.rfft(frames * window, axis=1)) ** 2
    mel = np.log(np.maximum(spectrum @ bank.T, 1e-8))
    mel_mean = mel.mean(axis=0)
    mel_std = mel.std(axis=0)

    freqs = np.linspace(0, SAMPLE_RATE / 2, spectrum.shape[1])
    spectrum_sum = spectrum.sum(axis=1) + 1e-8
    centroid = (spectrum * freqs).sum(axis=1) / spectrum_sum
    rolloff_index = np.argmax(np.cumsum(spectrum, axis=1) >= spectrum_sum[:, None] * 0.85, axis=1)
    rolloff = freqs[rolloff_index]
    zcr = np.mean(np.abs(np.diff(np.signbit(frames), axis=1)), axis=1)
    extras = np.array([
        centroid.mean(), centroid.std(),
        rolloff.mean(), rolloff.std(),
        zcr.mean(), zcr.std(),
    ], dtype=np.float32)
    vector = np.concatenate([mel_mean, mel_std, extras]).astype(np.float32)
    vector -= vector.mean()
    norm = np.linalg.norm(vector) + 1e-8
    return vector / norm


def assign_speakers(samples, segments):
    if len(segments) <= 1:
        return [0] * len(segments), 1

    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score

    bank = mel_filterbank(SAMPLE_RATE, 512)
    embeddings = []
    for start_sec, end_sec in segments:
        start = int(start_sec * SAMPLE_RATE)
        end = int(end_sec * SAMPLE_RATE)
        embeddings.append(voice_embedding(samples[start:end], bank))
    matrix = np.vstack(embeddings)

    if len(segments) == 2:
        similarity = float(np.dot(matrix[0], matrix[1]))
        if similarity < 0.9:
            return [0, 1], 2
        return [0, 0], 1

    max_speakers = min(4, len(segments))
    best = (None, -1.0)
    for speaker_count in range(2, max_speakers + 1):
        if speaker_count >= len(segments):
            continue
        labels = KMeans(n_clusters=speaker_count, random_state=7, n_init=10).fit_predict(matrix)
        if len(set(labels)) < 2:
            continue
        score = float(silhouette_score(matrix, labels, metric="cosine"))
        if score > best[1]:
            best = (labels, score)

    if best[0] is None or best[1] < 0.12:
        return [0] * len(segments), 1

    # Normalize labels by first appearance so users see stable Speaker 1, Speaker 2...
    remap = {}
    normalized = []
    for label in best[0]:
        if label not in remap:
            remap[label] = len(remap)
        normalized.append(remap[label])
    return normalized, len(remap)


def split_audio_chunks(samples, chunk_seconds):
    chunk_size = max(10, int(chunk_seconds * SAMPLE_RATE))
    return [samples[start:start + chunk_size] for start in range(0, len(samples), chunk_size) if len(samples[start:start + chunk_size]) > 0]


def transcribe_audio_chunks(model, chunks, language, chunk_seconds, total_seconds=0.0):
    """Transcribe bounded batches while keeping one model instance alive."""
    texts = []
    current = []
    current_seconds = 0.0
    processed_seconds = 0.0

    def flush():
        nonlocal current, current_seconds, processed_seconds
        if not current:
            return
        try:
            results = model.transcribe(
                audio=[(chunk, SAMPLE_RATE) for chunk in current],
                language=language,
            )
        except TypeError:
            if not isinstance(language, list):
                raise
            # 旧版 qwen-asr 不支持按语言列表混说：降级为自动语种识别
            results = model.transcribe(
                audio=[(chunk, SAMPLE_RATE) for chunk in current],
                language=None,
            )
        texts.extend(str(getattr(result, "text", "") or "").strip() for result in results)
        processed_seconds += current_seconds
        emit_progress("transcribing", processed_seconds, total_seconds, "转写音频片段中")
        current = []
        current_seconds = 0.0

    emit_progress("chunking", 0, total_seconds, "音频切片中")
    for chunk in chunks:
        duration = len(chunk) / SAMPLE_RATE
        if current and current_seconds + duration > chunk_seconds:
            flush()
        current.append(chunk)
        current_seconds += duration
    flush()
    return texts


def transcribe_plain_audio(samples, model, language, chunk_seconds):
    chunks = split_audio_chunks(samples, chunk_seconds)
    texts = transcribe_audio_chunks(model, chunks, language, chunk_seconds, len(samples) / SAMPLE_RATE)
    return "".join(text for text in texts if text)


def diarize_and_transcribe(samples, model, language, chunk_seconds):
    emit_progress("diarization", 0, len(samples) / SAMPLE_RATE, "说话人分离中")
    segments = find_speech_segments(samples)
    if not segments:
        return {"text": "", "speaker_segments": [], "speaker_count": 0}

    labels, speaker_count = assign_speakers(samples, segments)
    audio_items = []
    for start_sec, end_sec in segments:
        start = int(start_sec * SAMPLE_RATE)
        end = int(end_sec * SAMPLE_RATE)
        audio_items.append(samples[start:end])

    texts = transcribe_audio_chunks(model, audio_items, language, chunk_seconds, len(samples) / SAMPLE_RATE)
    speaker_segments = []
    for (start_sec, end_sec), label, text in zip(segments, labels, texts):
        text = str(text or "").strip()
        if not text:
            continue
        speaker_segments.append({
            "speaker": f"说话人 {label + 1}",
            "speakerIndex": int(label),
            "start": round(start_sec, 2),
            "end": round(end_sec, 2),
            "text": text,
        })

    merged = []
    for item in speaker_segments:
        if merged and merged[-1]["speakerIndex"] == item["speakerIndex"] and item["start"] - merged[-1]["end"] <= 0.5:
            merged[-1]["end"] = item["end"]
            merged[-1]["text"] += item["text"]
        else:
            merged.append(item)

    lines = [f"{item['speaker']}：{item['text']}" for item in merged]
    return {
        "text": "\n".join(lines),
        "speaker_segments": merged,
        "speaker_count": speaker_count,
    }


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

    if args.check:
        print(json.dumps({
            "ok": True,
            "torch": getattr(torch, "__version__", "unknown"),
            "cuda": bool(torch.cuda.is_available()),
            "speakerDiarization": True,
        }, ensure_ascii=False))
        return 0

    if not args.audio:
        print("--audio is required unless --check is used", file=sys.stderr)
        return 2

    language = normalize_language(args.language)

    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32

    try:
        model = Qwen3ASRModel.from_pretrained(
            args.model,
            dtype=dtype,
            device_map=args.device_map,
            max_inference_batch_size=args.batch_size,
            max_new_tokens=args.max_new_tokens,
        )
    except Exception as exc:
        offline = os.environ.get("HF_HUB_OFFLINE") == "1" or os.environ.get("TRANSFORMERS_OFFLINE") == "1"
        hint = "请先下载完整模型，或在设置中选择本地模型目录。" if offline else "请检查模型目录或网络连接。"
        print(f"Qwen3-ASR 模型加载失败：{exc}\n{hint}", file=sys.stderr)
        return 2

    samples = read_wav(args.audio)
    if args.speaker_diarization:
        try:
            result = diarize_and_transcribe(samples, model, language, args.chunk_seconds)
        except Exception as exc:
            # Speaker clustering is an enhancement; never lose the normal final transcript.
            result = {
                "text": transcribe_plain_audio(samples, model, language, args.chunk_seconds),
                "speaker_segments": [],
                "speaker_count": 0,
                "speaker_error": str(exc),
            }
        result["language"] = language
        print(json.dumps(result, ensure_ascii=False))
    else:
        text = transcribe_plain_audio(samples, model, language, args.chunk_seconds)
        print(json.dumps({
            "language": language,
            "text": text,
        }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
