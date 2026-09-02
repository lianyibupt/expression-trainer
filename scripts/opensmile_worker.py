#!/usr/bin/env python3
"""Extract eGeMAPS functionals for diarized speaker segments."""

import argparse
import json
import wave

import numpy as np


def read_wav(path):
    with wave.open(path, "rb") as wav:
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        rate = wav.getframerate()
        raw = wav.readframes(wav.getnframes())
    if width != 2:
        raise ValueError("openSMILE worker expects 16-bit PCM WAV")
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples, rate


def pick(row, names):
    for name in names:
        if name in row and np.isfinite(float(row[name])):
            return float(row[name])
    return None


def extract(smile, samples, rate):
    if len(samples) < int(rate * 0.1):
        samples = np.pad(samples, (0, int(rate * 0.1) - len(samples)))
    row = smile.process_signal(samples, rate).iloc[0].to_dict()
    return {
        "pitchMeanSemitone": pick(row, ["F0semitoneFrom27.5Hz_sma3nz_amean"]),
        "pitchVariation": pick(row, ["F0semitoneFrom27.5Hz_sma3nz_stddevNorm"]),
        "loudnessMean": pick(row, ["loudness_sma3_amean"]),
        "loudnessVariation": pick(row, ["loudness_sma3_stddevNorm"]),
        "jitterLocal": pick(row, ["jitterLocal_sma3nz_amean"]),
        "shimmerLocal": pick(row, ["shimmerLocal_sma3nz_amean"]),
        "spectralSlope": pick(row, ["spectralFlux_sma3_amean"]),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--segments", required=True, help="JSON array of diarized segments")
    args = parser.parse_args()

    try:
        import opensmile
    except Exception as exc:
        raise RuntimeError(f"Python opensmile 未安装：{exc}") from exc

    samples, rate = read_wav(args.audio)
    if rate != 16000:
        raise ValueError(f"Expected 16000Hz WAV, got {rate}Hz")
    smile = opensmile.Smile(
        feature_set=opensmile.FeatureSet.eGeMAPSv02,
        feature_level=opensmile.FeatureLevel.Functionals,
    )
    segments = json.loads(args.segments)
    if not segments:
        print(json.dumps({"meeting": extract(smile, samples, rate), "speakers": [], "segmentDetails": []}, ensure_ascii=False))
        return
    details = []
    for segment in segments:
        start = max(0, int(float(segment.get("start", 0)) * rate))
        end = min(len(samples), int(float(segment.get("end", 0)) * rate))
        if end <= start:
            continue
        details.append({
            "speaker": segment.get("speaker", "未知说话人"),
            "startSeconds": float(segment.get("start", 0)),
            "endSeconds": float(segment.get("end", 0)),
            "features": extract(smile, samples[start:end], rate),
        })

    grouped = {}
    for item in details:
        grouped.setdefault(item["speaker"], []).append(item["features"])
    speaker_features = []
    for speaker, items in grouped.items():
        merged = {"speaker": speaker}
        for key in items[0]:
            values = [float(item[key]) for item in items if item.get(key) is not None]
            if values:
                merged[key] = round(float(np.mean(values)), 5)
        speaker_features.append(merged)
    print(json.dumps({"speakers": speaker_features, "segmentDetails": details}, ensure_ascii=False))


if __name__ == "__main__":
    main()
