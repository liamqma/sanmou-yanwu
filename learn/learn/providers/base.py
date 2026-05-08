"""Provider abstraction.

A `Provider` describes how to fetch audio for a particular video host. Each
provider can:

* match against a URL (`matches`)
* contribute HTTP headers, a `Referer`, and (optionally) a cookies file to
  feed yt-dlp via `prepare(url) -> ProviderHints`

Providers are registered in `providers/__init__.py`. Lookup is first-match-wins
in registration order, with `GenericProvider` as the catch-all fallback.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol


@dataclass
class ProviderHints:
    """yt-dlp-friendly extras a provider can attach to a download request."""

    headers: dict[str, str] = field(default_factory=dict)
    referer: str | None = None
    cookies_file: Path | None = None
    # Free-form extra options merged into ydl_opts (e.g. `extractor_args`).
    extra_ydl_opts: dict = field(default_factory=dict)


class Provider(Protocol):
    name: str

    def matches(self, url: str) -> bool: ...

    def prepare(self, url: str, *, use_playwright: bool = False) -> ProviderHints: ...
