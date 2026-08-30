#!/usr/bin/env python3
"""Tiny repository-root server for the slides with browser caching disabled.

Usage:  python3 serve.py [port]   (default port 8850)
Then open the printed deck URL. No-cache headers mean edits show on plain refresh.
"""
from functools import partial
from pathlib import Path
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8850
    repository_root = Path(__file__).resolve().parents[3]
    deck_path = "/video/projects/recommendation/"
    handler = partial(NoCacheHandler, directory=repository_root)
    print(f"Serving slides (no-cache) at http://localhost:{port}{deck_path}")
    HTTPServer(("", port), handler).serve_forever()
