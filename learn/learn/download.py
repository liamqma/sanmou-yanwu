"""Provider-agnostic audio downloader built on yt-dlp.

The high-level entry point is :func:`download_audio`. URL → provider lookup →
yt-dlp options assembly → download → optional ffmpeg post-processing.
"""

from __future__ import annotations

import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

from yt_dlp import YoutubeDL

from .providers import get_provider_for


@dataclass
class DownloadResult:
    files: list[Path] = field(default_factory=list)
    provider_name: str = ""
    cookies_file: Path | None = None


def _detect_ffmpeg() -> str | None:
    p = shutil.which("ffmpeg")
    if p is None:
        print(
            "WARNING: ffmpeg not found on PATH. Audio extraction/conversion will fail.\n"
            "Install via: brew install ffmpeg",
            file=sys.stderr,
        )
    return p


def download_audio(
    url: str,
    output_dir: Path,
    *,
    audio_format: str = "mp3",
    audio_quality: str = "0",  # 0 = best
    use_playwright: bool = False,
    cookies_from_browser: str | None = None,
    cookies_file: Path | None = None,
    keep_provider_cookies: bool = False,
) -> DownloadResult:
    """Download audio-only from `url` into `output_dir`.

    Cookie precedence (highest first): explicit ``cookies_file``, browser
    cookies via ``cookies_from_browser``, provider-prepared cookies (anonymous
    bootstrap or Playwright if ``use_playwright`` is set).
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    ffmpeg_path = _detect_ffmpeg()

    provider = get_provider_for(url)
    print(f"Provider: {provider.name}", file=sys.stderr)

    # Provider only runs its own cookie bootstrap when the caller hasn't
    # supplied stronger cookies. This keeps explicit user input authoritative.
    explicit_cookies = cookies_file is not None or cookies_from_browser is not None
    hints = provider.prepare(url, use_playwright=use_playwright and not explicit_cookies)

    written: list[Path] = []

    def _hook(d: dict) -> None:
        if d.get("status") == "finished":
            fp = d.get("filename")
            if fp:
                written.append(Path(fp))

    out_template = str(output_dir / "%(title)s [%(id)s].%(ext)s")

    ydl_opts: dict = {
        "format": "bestaudio/best",
        "outtmpl": out_template,
        "noplaylist": False,
        "quiet": False,
        "no_warnings": False,
        "progress_hooks": [_hook],
        "http_headers": hints.headers,
        "retries": 5,
        "fragment_retries": 5,
        "extractor_retries": 3,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": audio_format,
                "preferredquality": audio_quality,
            }
        ],
    }
    if hints.referer:
        ydl_opts["referer"] = hints.referer
    if ffmpeg_path:
        ydl_opts["ffmpeg_location"] = ffmpeg_path
    if cookies_from_browser:
        # yt-dlp expects a tuple (browser, profile|None, keyring|None, container|None)
        ydl_opts["cookiesfrombrowser"] = (cookies_from_browser,)
    elif cookies_file:
        ydl_opts["cookiefile"] = str(cookies_file)
    elif hints.cookies_file:
        ydl_opts["cookiefile"] = str(hints.cookies_file)

    if hints.extra_ydl_opts:
        ydl_opts.update(hints.extra_ydl_opts)

    try:
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    finally:
        # Tidy up provider-bootstrapped cookies unless caller wants to keep them.
        if (
            hints.cookies_file
            and hints.cookies_file != cookies_file
            and not keep_provider_cookies
            and hints.cookies_file.exists()
        ):
            try:
                hints.cookies_file.unlink()
            except OSError:
                pass

    # Map raw downloads to their post-processed extension if it exists.
    final: list[Path] = []
    for p in written:
        candidate = p.with_suffix(f".{audio_format}")
        final.append(candidate if candidate.exists() else p)

    return DownloadResult(
        files=final,
        provider_name=provider.name,
        cookies_file=hints.cookies_file if keep_provider_cookies else None,
    )
