"""Bilibili provider.

Bilibili's WAF rejects naive HTTP clients with `HTTP 412 Precondition Failed`.
We layer two strategies, picking the best one for the situation:

1. Anonymous cookie bootstrap via the public spi endpoint + a homepage warmup.
2. (Recommended) Headless Playwright Chromium minting of real WAF cookies —
   `use_playwright=True` in `prepare()`.

Either strategy produces a Netscape `cookies.txt` that yt-dlp can consume.
"""

from __future__ import annotations

import sys
import time

import requests

from ..cookies import mint_cookies_file, write_cookies_file
from .base import ProviderHints

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)
_REFERER = "https://www.bilibili.com/"


def _headers() -> dict[str, str]:
    return {
        "User-Agent": _UA,
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
        "Referer": _REFERER,
    }


def _bootstrap_anon_cookies() -> dict[str, str]:
    """Mint anonymous Bilibili cookies via spi + homepage warmup."""
    sess = requests.Session()
    sess.headers.update(_headers())
    cookies: dict[str, str] = {}

    try:
        r = sess.get("https://api.bilibili.com/x/frontend/finger/spi", timeout=10)
        data = r.json().get("data", {}) if r.ok else {}
        if data.get("b_3"):
            cookies["buvid3"] = data["b_3"]
        if data.get("b_4"):
            cookies["buvid4"] = data["b_4"]
    except Exception as exc:  # noqa: BLE001
        print(f"NOTE: bilibili spi bootstrap failed ({exc}); continuing.", file=sys.stderr)

    try:
        sess.cookies.update(cookies)
        sess.get("https://www.bilibili.com/", timeout=10)
        for c in sess.cookies:
            if c.domain.endswith("bilibili.com") and c.value:
                cookies[c.name] = c.value
    except Exception as exc:  # noqa: BLE001
        print(f"NOTE: bilibili homepage warmup failed ({exc}); continuing.", file=sys.stderr)

    cookies.setdefault("b_nut", str(int(time.time())))
    return cookies


class BilibiliProvider:
    name = "bilibili"

    def matches(self, url: str) -> bool:
        return "bilibili.com" in url or "b23.tv" in url

    def prepare(self, url: str, *, use_playwright: bool = False) -> ProviderHints:
        hints = ProviderHints(headers=_headers(), referer=_REFERER)
        if use_playwright:
            print("Bilibili: minting cookies via headless Playwright Chromium...", file=sys.stderr)
            hints.cookies_file = mint_cookies_file(url)
        else:
            cookies = _bootstrap_anon_cookies()
            if cookies:
                hints.cookies_file = write_cookies_file(cookies, domain=".bilibili.com")
                print(
                    f"Bilibili: bootstrapped {len(cookies)} anonymous cookie(s) "
                    f"(buvid3 present: {'buvid3' in cookies}).",
                    file=sys.stderr,
                )
        return hints
