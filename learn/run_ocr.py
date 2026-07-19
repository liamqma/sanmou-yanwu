"""Batched Tesseract OCR over every learn/frames/*.jpg.

After extracting frames with
``ffmpeg -i <video>.mp4 -vf "fps=1/60" learn/frames/frame_%04d.jpg``, run this
script to dump any spreadsheets / tier lists / UI text visible on screen.

Usage:
    cd learn
    uv run python run_ocr.py [frames_dir]

Frames whose OCR yields < MIN_CHARS characters of recognised text are
suppressed as near-blank.
"""
from __future__ import annotations

import glob
import os
import sys

from PIL import Image
import pytesseract

MIN_CHARS = 50
LANG = "chi_sim+eng"
PREVIEW = 400  # chars per frame in the dump


def main(frames_dir: str = "frames") -> int:
    images = sorted(glob.glob(os.path.join(frames_dir, "*.jpg")))
    if not images:
        print(f"No frames found in {frames_dir}/", file=sys.stderr)
        return 1

    print(f"Found {len(images)} frames in {frames_dir}/")
    for img_path in images:
        try:
            img = Image.open(img_path)
            text = pytesseract.image_to_string(img, lang=LANG)
        except Exception as e:  # pragma: no cover
            print(f"Error on {img_path}: {e}", file=sys.stderr)
            continue
        text = text.strip()
        if len(text) < MIN_CHARS:
            continue
        print(f"\n--- {img_path} ---")
        print(text[:PREVIEW])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "frames"))
