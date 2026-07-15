#!/usr/bin/env python3
"""Zero-shot voice clone with Qwen3-TTS on Apple Silicon.

Two modes share the same model + reference loading path:

Single-text mode (unchanged, backward compatible)
    Given a short reference recording of your own voice (``--ref-audio``) plus the
    exact transcript of that recording (``--ref-text`` / ``--ref-text-file``),
    synthesize ``--text`` in your cloned timbre.

        HF_HUB_OFFLINE=1 .venv/bin/python scripts/clone-voice.py \
            --ref-audio ./voice-clone/voice.m4a \
            --ref-text-file ./voice-clone/ref.txt \
            --text "台词"

Batch/content mode (for the Node narration pipeline)
    Load the Base BF16 model and prepared reference once, then synthesize one MP3
    per scene of a content JSON file (``content/video.json``). Each scene's
    ``id`` is used as the output file stem.

        HF_HUB_OFFLINE=1 .venv/bin/python scripts/clone-voice.py \
            --ref-audio ./voice-clone/voice.m4a \
            --ref-text-file ./voice-clone/ref.txt \
            --content-file ./content/video.json \
            --output-dir ./public/audio --mp3-only

Voice cloning (zero-shot ICL from ref_audio + ref_text) is only supported by the
*Base* checkpoint. The CustomVoice / VoiceDesign variants reject ref_audio.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"
DEFAULT_TEXT = "四个战法同时改版，谁真正起飞？结合旧版战报和伤害公式，这是一版保守评级。"

# Scene ids become file stems; keep them to a safe, path-traversal-proof charset.
SCENE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--text", default=DEFAULT_TEXT, help="Text to speak (single-text mode).")
    parser.add_argument(
        "--content-file",
        type=Path,
        help=(
            "Content JSON with a 'scenes' array. Enables batch mode: one MP3 per "
            "scene, named by the scene 'id'."
        ),
    )
    parser.add_argument(
        "--ref-audio",
        type=Path,
        required=True,
        help="Reference recording of your voice (any ffmpeg-readable format).",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--ref-text", help="Exact transcript of the reference recording.")
    group.add_argument(
        "--ref-text-file",
        type=Path,
        help="File containing the exact transcript of the reference recording.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_DIR / "out" / "voice-clone",
    )
    parser.add_argument("--stem", default="clone-test", help="Output file stem (single-text mode).")
    parser.add_argument("--seed", type=int, default=20260715)
    parser.add_argument("--temperature", type=float, default=0.8)
    parser.add_argument("--top-k", type=int, default=40)
    parser.add_argument("--top-p", type=float, default=0.95)
    parser.add_argument("--repetition-penalty", type=float, default=1.08)
    parser.add_argument("--max-tokens", type=int, default=2048)
    parser.add_argument(
        "--no-prep",
        action="store_true",
        help="Use the reference audio as-is instead of converting to 24kHz mono WAV.",
    )
    parser.add_argument(
        "--mp3-only",
        action="store_true",
        help="Delete the intermediate per-scene WAV after producing the MP3.",
    )
    return parser.parse_args()


def prepare_reference(src: Path, output_dir: Path) -> Path:
    """Convert the reference clip to the clean 24kHz mono WAV clones prefer."""
    prepped = output_dir / f"{src.stem}.ref.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(src),
            "-ac",
            "1",
            "-ar",
            "24000",
            "-af",
            "highpass=f=70,lowpass=f=12000",
            str(prepped),
        ],
        check=True,
    )
    return prepped


def load_scenes(content_file: Path) -> list[dict]:
    data = json.loads(content_file.read_text(encoding="utf-8"))
    scenes = data.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise SystemExit(f"No scenes found in {content_file}")

    validated: list[dict] = []
    seen: set[str] = set()
    for index, scene in enumerate(scenes):
        scene_id = scene.get("id")
        if not isinstance(scene_id, str) or not SCENE_ID_RE.match(scene_id):
            raise SystemExit(
                f"Scene #{index} has an invalid id {scene_id!r}; "
                "ids must match [A-Za-z0-9_-]+ to be safe file stems."
            )
        if scene_id in seen:
            raise SystemExit(f"Duplicate scene id {scene_id!r} in {content_file}")
        narration = scene.get("narration")
        if not isinstance(narration, str) or not narration.strip():
            raise SystemExit(f"Scene {scene_id!r} has an empty narration.")
        seen.add(scene_id)
        validated.append({"id": scene_id, "narration": narration.strip()})
    return validated


def synthesize(
    model,
    *,
    mx,
    np,
    audio_write,
    text: str,
    ref_audio: str,
    ref_text: str,
    output_dir: Path,
    stem: str,
    seed: int,
    args: argparse.Namespace,
) -> Path:
    """Generate a single normalized MP3 and return its path."""
    mx.random.seed(seed)
    result = next(
        model.generate(
            text=text,
            ref_audio=ref_audio,
            ref_text=ref_text,
            temperature=args.temperature,
            top_k=args.top_k,
            top_p=args.top_p,
            repetition_penalty=args.repetition_penalty,
            max_tokens=args.max_tokens,
        )
    )

    wav_path = output_dir / f"{stem}.wav"
    mp3_path = output_dir / f"{stem}.mp3"
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
    if args.mp3_only and wav_path.exists():
        wav_path.unlink()
    print(
        f"Created {mp3_path} ({result.audio_duration}, "
        f"{result.processing_time_seconds:.1f}s generation)",
        flush=True,
    )
    return mp3_path


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    ref_text = (
        args.ref_text
        if args.ref_text is not None
        else Path(args.ref_text_file).read_text(encoding="utf-8").strip()
    )
    if not ref_text:
        raise SystemExit("Reference transcript is empty.")

    scenes = load_scenes(args.content_file) if args.content_file else None

    os.environ.setdefault("HF_HOME", str(PROJECT_DIR / ".cache" / "huggingface"))
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

    import mlx.core as mx
    import numpy as np
    from mlx_audio.audio_io import write as audio_write
    from mlx_audio.tts.utils import load_model

    ref_audio = (
        args.ref_audio if args.no_prep else prepare_reference(args.ref_audio, args.output_dir)
    )
    print(f"Reference audio: {ref_audio}", flush=True)

    print(f"Loading {args.model} ...", flush=True)
    model = load_model(args.model)

    common = {
        "model": model,
        "mx": mx,
        "np": np,
        "audio_write": audio_write,
        "ref_audio": str(ref_audio),
        "ref_text": ref_text,
        "output_dir": args.output_dir,
        "args": args,
    }

    if scenes is None:
        print("Cloning voice (single text) ...", flush=True)
        synthesize(text=args.text, stem=args.stem, seed=args.seed, **common)
        return

    print(f"Cloning voice for {len(scenes)} scene(s) ...", flush=True)
    for index, scene in enumerate(scenes):
        print(f"[{index + 1}/{len(scenes)}] {scene['id']}", flush=True)
        synthesize(
            text=scene["narration"],
            stem=scene["id"],
            seed=args.seed + index,
            **common,
        )


if __name__ == "__main__":
    main()
