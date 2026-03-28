#!/usr/bin/env python3
"""
OCR Validation Script for Battle Detail/Log Screen

Crops a fixed region from 1.jpg and 2.jpg, runs PaddleOCR, and prints
extracted text with confidence scores for manual validation.

Usage:
    cd battle_details_extraction
    ../venv/bin/python3 validate_ocr.py
"""

import os
import sys
import cv2
import numpy as np
from paddleocr import PaddleOCR

# ── Configuration ────────────────────────────────────────────────────────────

IMAGES = [
    os.path.join(os.path.dirname(__file__), "images", "1.jpg"),
    os.path.join(os.path.dirname(__file__), "images", "2.jpg"),
]

# x, y, width, height  (top-left origin)
REGION = (180, 268, 870, 1815)

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "ocr_validation")

# ── OCR Setup ────────────────────────────────────────────────────────────────

def build_ocr() -> PaddleOCR:
    """Initialise PaddleOCR with settings tuned for small Chinese text."""
    return PaddleOCR(
        lang="ch",
        use_textline_orientation=True,
        text_det_limit_side_len=32,
    )


# ── Image helpers ────────────────────────────────────────────────────────────

def crop_region(image: np.ndarray, region: tuple) -> np.ndarray:
    """Crop (x, y, w, h) from image."""
    x, y, w, h = region
    return image[y : y + h, x : x + w]


def save_crop(crop: np.ndarray, image_path: str, output_dir: str) -> str:
    """Save cropped image and return the saved path."""
    os.makedirs(output_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(image_path))[0]
    out_path = os.path.join(output_dir, f"{base}_crop.jpg")
    cv2.imwrite(out_path, crop)
    return out_path


# ── OCR runner ───────────────────────────────────────────────────────────────

def run_ocr(ocr: PaddleOCR, crop: np.ndarray) -> list:
    """
    Run OCR on a crop and return a list of (text, confidence) tuples.
    Returns [] if nothing is detected.
    """
    result = ocr.predict(crop)
    lines = []
    if not result:
        return lines

    # PaddleOCR 3.x returns a list of dicts per image
    for item in result:
        if isinstance(item, dict):
            rec_texts = item.get("rec_texts", [])
            rec_scores = item.get("rec_scores", [])
            for text, score in zip(rec_texts, rec_scores):
                text = text.strip()
                if text:
                    lines.append((text, float(score)))
        elif isinstance(item, list):
            # Legacy format: [[box, (text, conf)], ...]
            for entry in item:
                if entry and len(entry) >= 2:
                    text_conf = entry[1]
                    if isinstance(text_conf, (list, tuple)) and len(text_conf) >= 2:
                        text, score = text_conf[0], text_conf[1]
                        text = text.strip()
                        if text:
                            lines.append((text, float(score)))
    return lines


# ── Pretty printer ───────────────────────────────────────────────────────────

def print_results(image_path: str, crop_path: str, lines: list):
    sep = "─" * 60
    print(f"\n{'═' * 60}")
    print(f"  Image : {image_path}")
    print(f"  Region: x=180, y=268, w=870, h=1815")
    print(f"  Crop  : {crop_path}")
    print(f"{'═' * 60}")
    if not lines:
        print("  ⚠  No text detected.")
    else:
        print(f"  {'#':<4}  {'Confidence':>10}  Text")
        print(f"  {sep}")
        for i, (text, conf) in enumerate(lines, 1):
            bar = "█" * int(conf * 10) + "░" * (10 - int(conf * 10))
            print(f"  {i:<4}  {conf:>8.1%}  [{bar}]  {text}")
    print()


def save_text(image_path: str, lines: list, output_dir: str) -> str:
    """Save extracted text (one line per entry) to a .txt file."""
    os.makedirs(output_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(image_path))[0]
    txt_path = os.path.join(output_dir, f"{base}.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        for text, _ in lines:
            f.write(text + "\n")
    return txt_path


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("Initialising PaddleOCR (Chinese, small-text mode)…")
    ocr = build_ocr()
    print("Ready.\n")

    for image_path in IMAGES:
        if not os.path.exists(image_path):
            print(f"⚠  Image not found, skipping: {image_path}")
            continue

        image = cv2.imread(image_path)
        if image is None:
            print(f"⚠  Could not read image: {image_path}")
            continue

        h_img, w_img = image.shape[:2]
        x, y, w, h = REGION
        # Clamp to image bounds
        x2 = min(x + w, w_img)
        y2 = min(y + h, h_img)
        actual_region = (x, y, x2 - x, y2 - y)

        crop = crop_region(image, actual_region)
        crop_path = save_crop(crop, image_path, OUTPUT_DIR)

        lines = run_ocr(ocr, crop)
        print_results(image_path, crop_path, lines)
        txt_path = save_text(image_path, lines, OUTPUT_DIR)
        print(f"  Text saved to: {txt_path}\n")

    print("Done. Output saved to:", OUTPUT_DIR)


if __name__ == "__main__":
    main()
