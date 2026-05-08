"""Build a Netscape-format `cookies.txt` file that yt-dlp can consume."""

from __future__ import annotations

import http.cookiejar as cookiejar
import tempfile
import time
from pathlib import Path
from typing import Iterable, Mapping


def _to_cookie(
    *,
    name: str,
    value: str,
    domain: str,
    path: str = "/",
    expires: int | None = None,
    secure: bool = False,
    http_only: bool = False,
) -> cookiejar.Cookie:
    if expires is None or expires < 0:
        expires = int(time.time()) + 60 * 60 * 24 * 365  # 1 year
    return cookiejar.Cookie(
        version=0,
        name=name,
        value=value,
        port=None,
        port_specified=False,
        domain=domain,
        domain_specified=True,
        domain_initial_dot=domain.startswith("."),
        path=path,
        path_specified=True,
        secure=secure,
        expires=int(expires),
        discard=False,
        comment=None,
        comment_url=None,
        rest={"HttpOnly": ""} if http_only else {},
        rfc2109=False,
    )


def write_cookies_file(
    cookies: Iterable[Mapping] | Mapping[str, str],
    *,
    domain: str | None = None,
    path: Path | None = None,
) -> Path:
    """Write a Netscape `cookies.txt`.

    Two input shapes are supported:

    1. A flat ``{name: value}`` mapping — `domain` must be supplied.
    2. An iterable of dicts with at least ``name``, ``value``, ``domain`` keys
       (Playwright's ``BrowserContext.cookies()`` shape).
    """
    if path is None:
        fd = tempfile.NamedTemporaryFile(prefix="cookies_", suffix=".txt", delete=False)
        path = Path(fd.name)
        fd.close()

    jar = cookiejar.MozillaCookieJar()

    if isinstance(cookies, Mapping):
        if not domain:
            raise ValueError("`domain` is required when passing a {name: value} mapping.")
        for name, value in cookies.items():
            jar.set_cookie(_to_cookie(name=name, value=value, domain=domain))
    else:
        for c in cookies:
            d = c.get("domain")
            if not d:
                continue
            jar.set_cookie(
                _to_cookie(
                    name=c["name"],
                    value=c.get("value", ""),
                    domain=d,
                    path=c.get("path", "/"),
                    expires=c.get("expires"),
                    secure=bool(c.get("secure", False)),
                    http_only=bool(c.get("httpOnly", False)),
                )
            )

    jar.save(str(path), ignore_discard=True, ignore_expires=True)
    return path
