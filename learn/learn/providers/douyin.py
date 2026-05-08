"""Douyin (douyin.com / iesdouyin.com) and TikTok provider.

Douyin enforces a more aggressive bot challenge than Bilibili — most
non-browser requests fail without realistic cookies. Anonymous bootstrapping
isn't reliable, so we prefer to mint real cookies via Playwright.

Behavior:
* Always sends a desktop Chrome UA + ``Referer: https://www.douyin.com/``.
* If ``use_playwright=True``, opens the URL in headless Chromium and dumps
  the resulting cookies (recommended for Douyin).
"""

from __future__ import annotations

import sys

from ..cookies import mint_cookies_file
from .base import ProviderHints

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def _is_douyin(url: str) -> bool:
    return any(host in url for host in ("douyin.com", "iesdouyin.com", "tiktok.com"))


def _referer_for(url: str) -> str:
    if "tiktok.com" in url:
        return "https://www.tiktok.com/"
    return "https://www.douyin.com/"


class DouyinProvider:
    name = "douyin"

    def matches(self, url: str) -> bool:
        return _is_douyin(url)

    def prepare(self, url: str, *, use_playwright: bool = False) -> ProviderHints:
        referer = _referer_for(url)
        hints = ProviderHints(
            headers={
                "User-Agent": _UA,
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Referer": referer,
            },
            referer=referer,
        )
        if use_playwright:
            print(
                f"Douyin/TikTok: minting cookies via headless Playwright Chromium...",
                file=sys.stderr,
            )
            # Wait a bit longer — Douyin runs more JS before cookies settle.
            hints.cookies_file = mint_cookies_file(url, wait_ms=6000)
        else:
            print(
                "Douyin/TikTok: no cookie bootstrap available — pass --playwright "
                "or --cookies-from-browser if the download fails.",
                file=sys.stderr,
            )
        return hints
