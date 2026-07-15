#!/usr/bin/env python3
"""Generate short Mandarin voice auditions with Qwen3-TTS on Apple Silicon."""

from __future__ import annotations

import argparse
import os
import subprocess
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16"
DEFAULT_TEXT = (
    "我们来介绍一下七月十五日更新对这四个战法强度的影响。"
    "先说以静制动。改版前，这个战法的评级是T三。"
    "大数据一共记录了二百零三场，胜率百分之四十六点八，这个表现其实不算差。"
)
DEFAULT_INSTRUCT = (
    "自然、有判断感的游戏攻略解说，像资深玩家在和观众聊天。"
    "语速稍快，停顿清楚，重音克制，不要播音腔，不要广告腔，不要夸张。"
)
DEFAULT_VOICES = ("Dylan", "Vivian", "Serena")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--text", default=DEFAULT_TEXT)
    parser.add_argument("--instruct", default=DEFAULT_INSTRUCT)
    parser.add_argument("--voices", nargs="+", default=list(DEFAULT_VOICES))
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_DIR / "out" / "voice-auditions",
    )
    parser.add_argument("--seed", type=int, default=20260715)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault(
        "HF_HOME", str(PROJECT_DIR / ".cache" / "huggingface")
    )
    # Xet transfers can stall behind corporate proxies; standard HTTP supports
    # resuming the partially downloaded weight shards reliably.
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

    import mlx.core as mx
    import numpy as np
    from mlx_audio.audio_io import write as audio_write
    from mlx_audio.tts.utils import load_model

    print(f"Loading {args.model} ...", flush=True)
    model = load_model(args.model)

    for index, voice in enumerate(args.voices):
        print(f"Generating {voice} ...", flush=True)
        mx.random.seed(args.seed + index)
        result = next(
            model.generate_custom_voice(
                text=args.text,
                speaker=voice,
                language="Chinese",
                instruct=args.instruct,
                temperature=0.8,
                top_k=40,
                top_p=0.95,
                repetition_penalty=1.08,
                max_tokens=2048,
            )
        )

        stem = f"qwen3-{voice.lower()}"
        wav_path = args.output_dir / f"{stem}.wav"
        mp3_path = args.output_dir / f"{stem}.mp3"
        audio = np.asarray(result.audio, dtype=np.float32).squeeze()
        audio_write(str(wav_path), audio, result.sample_rate, format="wav")

        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(wav_path),
                "-af",
                "loudnorm=I=-16:TP=-1.5:LRA=7",
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "192k",
                str(mp3_path),
            ],
            check=True,
        )
        print(
            f"Created {mp3_path.name} ({result.audio_duration}, "
            f"{result.processing_time_seconds:.1f}s generation)",
            flush=True,
        )


if __name__ == "__main__":
    main()
