# learn — video → audio → transcript

Provider-agnostic pipeline that takes any supported video URL and produces a
transcript. Designed to handle hostile WAFs (Bilibili / Douyin) out of the box.

```
URL ──▶ provider lookup ──▶ yt-dlp + ffmpeg ──▶ audio file
                                                     │
                                                     ▼
                                          faster-whisper
                                                     │
                                                     ▼
                                  .txt + .srt + .json transcript
```

## Setup

```bash
cd learn
uv sync             # installs deps + registers the `learn` entry point
brew install ffmpeg # required for audio extraction
```

First run automatically installs the headless Chromium browser used by the
Playwright cookie minter (~150 MB, cached under `~/Library/Caches/ms-playwright`).

## Usage

The CLI exposes four subcommands:

| Command | Purpose |
| --- | --- |
| `learn download <url>` | URL → audio file in `downloads/` |
| `learn transcribe <audio>` | Audio file → `.txt` + `.srt` + `.json` siblings |
| `learn run <url>` | Download **and** transcribe in one shot |
| `learn providers` | List registered providers |

### Download

```bash
# Generic (YouTube, etc.) — no special handling needed
uv run learn download "https://www.youtube.com/watch?v=..."

# Bilibili — anonymous WAF cookie bootstrap is automatic
uv run learn download "https://www.bilibili.com/video/BV1oHRtBVECn/"

# Bilibili with stronger WAF (HTTP 412 even after bootstrap):
# spin up headless Chromium to mint real cookies
uv run learn download "https://www.bilibili.com/video/BV.../" --playwright

# Douyin / TikTok — Playwright is essentially required
uv run learn download "https://www.douyin.com/video/<id>" --playwright

# Use cookies from a logged-in browser (Firefox = no keychain prompt)
uv run learn download <url> --cookies-from-browser firefox

# Or use an exported cookies.txt (Chrome/Firefox extensions can produce one)
uv run learn download <url> --cookies-file ~/Downloads/cookies.txt
```

Common flags:

- `-o downloads/sub` — output directory
- `-f m4a|mp3|wav|opus|...` — audio format
- `-q 192` — bitrate or quality (`0` best, `9` worst)

### Transcribe

```bash
# Auto-detect language (default model: large-v3-turbo, ~1.5GB download first run)
uv run learn transcribe "downloads/foo.mp3"

# Force language + specific model
uv run learn transcribe downloads/foo.mp3 --lang zh --model large-v3

# Quick low-quality preview
uv run learn transcribe downloads/foo.mp3 --model small --beam-size 1
```

Each run writes three siblings next to the audio:

- `<stem>.txt` — plain text, one segment per line
- `<stem>.srt` — SubRip subtitle file with timestamps
- `<stem>.json` — full per-segment data (`id`, `start`, `end`, `text`)

### End-to-end

```bash
uv run learn run "https://www.bilibili.com/video/BV1oHRtBVECn/" --playwright --lang zh
```

## Adding a new provider

A `Provider` only needs:

1. A `name` attribute and a `matches(url) -> bool` predicate.
2. A `prepare(url, *, use_playwright: bool) -> ProviderHints` method that
   returns headers, an optional `Referer`, and an optional cookies-file path.

Drop the new module into `learn/providers/` and register it in
`learn/providers/__init__.py` (before `GenericProvider`).

```python
# learn/providers/myhost.py
from .base import ProviderHints

class MyHostProvider:
    name = "myhost"

    def matches(self, url: str) -> bool:
        return "myhost.tv" in url

    def prepare(self, url, *, use_playwright=False) -> ProviderHints:
        return ProviderHints(
            headers={"User-Agent": "...", "Referer": "https://myhost.tv/"},
            referer="https://myhost.tv/",
        )
```

## Updating yt-dlp

Video sites (Bilibili especially) change frequently. When downloads start
failing, bump yt-dlp:

```bash
uv lock --upgrade-package yt-dlp
uv sync
```
