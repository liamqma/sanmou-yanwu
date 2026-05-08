"""Transcribe audio with `faster-whisper` and write txt/srt/json siblings."""

from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from faster_whisper import WhisperModel


def _format_timestamp(seconds: float) -> str:
    """Convert seconds → SRT-style HH:MM:SS,mmm timestamp."""
    if seconds < 0:
        seconds = 0
    ms_total = int(round(seconds * 1000))
    h, ms_total = divmod(ms_total, 3600 * 1000)
    m, ms_total = divmod(ms_total, 60 * 1000)
    s, ms = divmod(ms_total, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


@dataclass
class TranscribeResult:
    audio: Path
    language: str
    language_probability: float
    duration: float
    segments: list[dict]

    def as_dict(self) -> dict:
        return {
            "audio": str(self.audio),
            "language": self.language,
            "language_probability": self.language_probability,
            "duration": self.duration,
            "segments": self.segments,
        }


def transcribe(
    audio_path: Path,
    *,
    model_size: str = "large-v3-turbo",
    language: str | None = None,
    device: str = "auto",
    compute_type: str = "auto",
    beam_size: int = 5,
    vad_filter: bool = True,
) -> TranscribeResult:
    if not audio_path.exists():
        raise FileNotFoundError(audio_path)

    print(
        f"Loading model '{model_size}' (device={device}, compute_type={compute_type})...",
        file=sys.stderr,
    )
    model = WhisperModel(model_size, device=device, compute_type=compute_type)

    print(f"Transcribing {audio_path.name} ...", file=sys.stderr)
    started = time.monotonic()
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language,
        beam_size=beam_size,
        vad_filter=vad_filter,
        vad_parameters={"min_silence_duration_ms": 500} if vad_filter else None,
    )

    segments: list[dict] = []
    last_log = 0.0
    for seg in segments_iter:
        segments.append(
            {
                "id": seg.id,
                "start": seg.start,
                "end": seg.end,
                "text": seg.text.strip(),
            }
        )
        # Heartbeat every ~30s of audio processed.
        if seg.end - last_log >= 30:
            print(f"  [{_format_timestamp(seg.end)}] processed", file=sys.stderr, flush=True)
            last_log = seg.end

    elapsed = time.monotonic() - started
    audio_dur = info.duration or 0.0
    rtf = (elapsed / audio_dur) if audio_dur else float("nan")
    print(
        f"Done in {elapsed:.1f}s for {audio_dur:.1f}s of audio "
        f"(RTF={rtf:.2f}x). Detected language: {info.language} "
        f"(prob={info.language_probability:.2f})",
        file=sys.stderr,
    )

    return TranscribeResult(
        audio=audio_path,
        language=info.language,
        language_probability=float(info.language_probability),
        duration=float(info.duration or 0.0),
        segments=segments,
    )


def write_outputs(result: TranscribeResult) -> dict[str, Path]:
    """Write txt, srt, and json sibling files; return a mapping of format → path."""
    stem_dir = result.audio.parent
    stem = result.audio.stem
    paths = {
        "txt": stem_dir / f"{stem}.txt",
        "srt": stem_dir / f"{stem}.srt",
        "json": stem_dir / f"{stem}.json",
    }

    paths["txt"].write_text(
        "\n".join(s["text"] for s in result.segments if s["text"]) + "\n",
        encoding="utf-8",
    )

    srt_lines: list[str] = []
    for i, s in enumerate(result.segments, start=1):
        srt_lines.append(str(i))
        srt_lines.append(f"{_format_timestamp(s['start'])} --> {_format_timestamp(s['end'])}")
        srt_lines.append(s["text"])
        srt_lines.append("")
    paths["srt"].write_text("\n".join(srt_lines), encoding="utf-8")

    paths["json"].write_text(
        json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return paths
