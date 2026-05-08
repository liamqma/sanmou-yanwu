"""Catch-all provider — sends only a sane desktop User-Agent."""

from __future__ import annotations

from .base import ProviderHints

_DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


class GenericProvider:
    name = "generic"

    def matches(self, url: str) -> bool:
        return True  # fallback

    def prepare(self, url: str, *, use_playwright: bool = False) -> ProviderHints:
        return ProviderHints(
            headers={
                "User-Agent": _DEFAULT_UA,
                "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
            },
        )
