#!/usr/bin/env python3
"""Tiny static server for the slides that disables browser caching.

Usage:  python3 serve.py [port]   (default port 8850)
Then open the printed URL. No-cache headers mean edits show on plain refresh.
"""
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
    print(f"Serving slides (no-cache) at http://localhost:{port}/")
    HTTPServer(("", port), NoCacheHandler).serve_forever()
