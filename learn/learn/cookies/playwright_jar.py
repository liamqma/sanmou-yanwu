"""Mint cookies for any URL using a headless Playwright Chromium.

Some video providers (notably Bilibili) reject plain HTTP requests with WAF
challenges (HTTP 412) but happily serve a real browser. We open the URL in
headless Chromium, let the JS settle, and dump the cookies into a Netscape
`cookies.txt` file that yt-dlp can read.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

from .jar import write_cookies_file


_DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def _ensure_chromium_installed() -> None:
    """Install the headless Chromium build if it isn't present yet."""
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            _ = p.chromium.executable_path
            return
    except Exception:
        pass

    print("Installing Playwright Chromium (one-time, ~150MB)...", file=sys.stderr)
    subprocess.run(
        [sys.executable, "-m", "playwright", "install", "chromium"],
        check=True,
    )


def mint_cookies(
    url: str,
    *,
    wait_ms: int = 4000,
    headless: bool = True,
    user_agent: str | None = _DEFAULT_UA,
    warmup_origin: bool = True,
) -> list[dict]:
    """Open `url` in headless Chromium and return its cookies as a list of dicts.

    Each dict includes at minimum ``name``, ``value``, ``domain``, ``path``,
    ``expires``, ``secure`` (Playwright's standard shape).
    """
    from playwright.sync_api import sync_playwright

    _ensure_chromium_installed()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        try:
            context = (
                browser.new_context(user_agent=user_agent)
                if user_agent
                else browser.new_context()
            )
            page = context.new_page()

            if warmup_origin:
                parsed = urlparse(url)
                origin = f"{parsed.scheme}://{parsed.netloc}/"
                try:
                    page.goto(origin, wait_until="domcontentloaded", timeout=20_000)
                    page.wait_for_timeout(1000)
                except Exception as exc:  # noqa: BLE001
                    print(f"NOTE: warmup nav to {origin} failed: {exc}", file=sys.stderr)

            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            page.wait_for_timeout(wait_ms)

            return context.cookies()
        finally:
            browser.close()


def mint_cookies_file(url: str, **kwargs) -> Path:
    """Mint cookies and write them to a temp `cookies.txt`. Return the path."""
    cookies = mint_cookies(url, **kwargs)
    return write_cookies_file(cookies)
