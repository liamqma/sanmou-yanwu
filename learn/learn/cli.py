"""Unified CLI for the `learn` pipeline.

Subcommands:
    download    URL → audio file (provider-aware: bilibili, douyin, generic)
    transcribe  audio file → .txt + .srt + .json transcript siblings
    run         download then transcribe in one shot
    providers   print the registered provider list

Examples:
    learn download https://www.bilibili.com/video/BV.../ --playwright
    learn download https://www.douyin.com/video/... --playwright -o downloads
    learn transcribe downloads/foo.mp3 --lang zh --model large-v3-turbo
    learn run https://www.bilibili.com/video/BV.../ --playwright --lang zh
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .download import download_audio
from .providers import PROVIDERS
from .transcribe import transcribe, write_outputs


_AUDIO_FORMATS = ["mp3", "m4a", "wav", "opus", "flac", "aac", "vorbis"]


def _add_download_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("url", help="Video URL (Bilibili, Douyin, YouTube, ...)")
    p.add_argument(
        "-o",
        "--output-dir",
        default="downloads",
        type=Path,
        help="Output directory (default: ./downloads)",
    )
    p.add_argument(
        "-f",
        "--format",
        default="mp3",
        choices=_AUDIO_FORMATS,
        help="Audio format (default: mp3)",
    )
    p.add_argument(
        "-q",
        "--quality",
        default="0",
        help="Audio quality (0=best..9=worst, or bitrate string like '192')",
    )
    p.add_argument(
        "--playwright",
        action="store_true",
        help="Mint cookies via headless Playwright Chromium "
        "(recommended for Bilibili / Douyin to bypass WAF challenges).",
    )
    p.add_argument(
        "--cookies-from-browser",
        default=None,
        help="Pull cookies from a local browser profile "
        "(e.g. firefox, chrome, safari, edge, brave).",
    )
    p.add_argument(
        "--cookies-file",
        default=None,
        type=Path,
        help="Path to a Netscape-format cookies.txt (overrides provider/playwright).",
    )


def _add_transcribe_args(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--model",
        default="large-v3-turbo",
        help="faster-whisper model: tiny|base|small|medium|large-v3|large-v3-turbo "
        "(default: large-v3-turbo)",
    )
    p.add_argument("--lang", default=None, help="ISO-639-1 code (e.g. zh, en); default auto-detect")
    p.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    p.add_argument("--compute-type", default="auto", help="ctranslate2 compute type")
    p.add_argument("--beam-size", type=int, default=5)
    p.add_argument("--no-vad", action="store_true", help="Disable voice-activity-detection filtering.")


def _cmd_download(args: argparse.Namespace) -> int:
    result = download_audio(
        args.url,
        args.output_dir,
        audio_format=args.format,
        audio_quality=args.quality,
        use_playwright=args.playwright,
        cookies_from_browser=args.cookies_from_browser,
        cookies_file=args.cookies_file,
    )
    print("\nDownloaded files:")
    for f in result.files:
        print(f"  {f}")
    return 0 if result.files else 1


def _cmd_transcribe(args: argparse.Namespace) -> int:
    result = transcribe(
        args.audio,
        model_size=args.model,
        language=args.lang,
        device=args.device,
        compute_type=args.compute_type,
        beam_size=args.beam_size,
        vad_filter=not args.no_vad,
    )
    paths = write_outputs(result)
    print("\nWrote:")
    for fmt, p in paths.items():
        print(f"  {fmt:>4}: {p}")
    return 0


def _cmd_run(args: argparse.Namespace) -> int:
    dl = download_audio(
        args.url,
        args.output_dir,
        audio_format=args.format,
        audio_quality=args.quality,
        use_playwright=args.playwright,
        cookies_from_browser=args.cookies_from_browser,
        cookies_file=args.cookies_file,
    )
    if not dl.files:
        print("ERROR: download produced no files.", file=sys.stderr)
        return 1
    print("\nDownloaded:")
    for f in dl.files:
        print(f"  {f}")

    overall = 0
    for audio in dl.files:
        result = transcribe(
            audio,
            model_size=args.model,
            language=args.lang,
            device=args.device,
            compute_type=args.compute_type,
            beam_size=args.beam_size,
            vad_filter=not args.no_vad,
        )
        paths = write_outputs(result)
        print(f"\nTranscribed {audio.name}:")
        for fmt, p in paths.items():
            print(f"  {fmt:>4}: {p}")
    return overall


def _cmd_providers(_: argparse.Namespace) -> int:
    print("Registered providers (first match wins):")
    for p in PROVIDERS:
        print(f"  - {p.name}: {p.__class__.__module__}.{p.__class__.__name__}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="learn", description=__doc__.splitlines()[0])
    parser.add_argument("--version", action="version", version=f"learn {__version__}")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_dl = sub.add_parser("download", help="Download audio from a video URL.")
    _add_download_args(p_dl)
    p_dl.set_defaults(func=_cmd_download)

    p_tr = sub.add_parser("transcribe", help="Transcribe an audio file.")
    p_tr.add_argument("audio", type=Path, help="Path to audio file (mp3/m4a/wav/...)")
    _add_transcribe_args(p_tr)
    p_tr.set_defaults(func=_cmd_transcribe)

    p_run = sub.add_parser("run", help="Download + transcribe in one shot.")
    _add_download_args(p_run)
    _add_transcribe_args(p_run)
    p_run.set_defaults(func=_cmd_run)

    p_pr = sub.add_parser("providers", help="List registered providers.")
    p_pr.set_defaults(func=_cmd_providers)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
