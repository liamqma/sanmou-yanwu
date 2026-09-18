#!/usr/bin/env python3
"""Local GLM + RapidOCR battle logs with source-pixel side evidence.

    uv run --project study-battle-report python study-battle-report/ocr_battle_log.py <id>

Use --all for every battle, --use-cache for offline re-tagging only, and
--output-dir extracted_results/hybrid-validation to preserve existing reports.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
from typing import Any

import cv2
import numpy as np

from backends import LocalModels, configuration
from hybrid import SIDE_POLICY, stitch_frames, tag_transcript
from localization import character_score_alignment

HERE = Path(__file__).resolve().parent
BATTLES_DIR = HERE / "battles"
DATABASE_PATH = HERE.parent / "web/public/game-data/database.json"
CACHE_SCHEMA = 3
CROP = (195, 275, 1060, 2120)


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                         prefix=f".{path.name}.", suffix=".tmp", delete=False) as stream:
            temp = Path(stream.name)
            stream.write(text)
        os.replace(temp, path)
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)


def write_json(path: Path, value: Any) -> None:
    atomic_write(path, json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")


def load_names(path: Path = DATABASE_PATH) -> set[str]:
    import re
    database = json.loads(path.read_text(encoding="utf-8"))
    names = {re.sub(r"\d+$", "", name) for name in database["heroes"]}
    # In-game display name; the catalog calls this hero 祝融. Keep the visible
    # spelling, because recognition alignment must refer to actual glyphs.
    if "祝融" in names:
        names.add("祝融夫人")
    return names


def validate_raw(raw: Any) -> None:
    """A cache is reusable evidence only when its complete contract is valid."""
    if not isinstance(raw, dict) or not isinstance(raw.get("glm_text"), str) or not raw["glm_text"].strip():
        raise ValueError("Missing/non-text GLM transcript")
    rows = raw.get("localization")
    if not isinstance(rows, list) or not rows:
        raise ValueError("Missing character localization")
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("text"), str):
            raise ValueError("Invalid localization row")
        glyphs = row.get("glyphs")
        if not isinstance(glyphs, list) or not glyphs:
            raise ValueError("Missing localized characters")
        for glyph in glyphs:
            if not isinstance(glyph, dict) or not isinstance(glyph.get("text"), str) or not glyph["text"]:
                raise ValueError("Invalid localized character")
            score = glyph.get("score")
            if isinstance(score, bool) or not isinstance(score, (float, int)) or not math.isfinite(score) or not 0 <= score <= 1:
                raise ValueError("Invalid localization confidence")
            box = np.asarray(glyph.get("box"), dtype=float)
            if box.shape != (4, 2) or not np.isfinite(box).all():
                raise ValueError("Invalid character geometry")
        if character_score_alignment(row) == "text_glyph_mismatch":
            glyph_text = "".join(glyph["text"] for glyph in glyphs)
            raise ValueError(f"Localization text/glyph mismatch: row_text={row['text']!r} glyph_text={glyph_text!r}")


def _cache(path: Path, config: dict, cache_only: bool, refresh: bool) -> dict:
    empty = {"schema_version": CACHE_SCHEMA, "ocr_config": config, "frames": {}}
    if refresh or not path.exists():
        if cache_only:
            raise ValueError(f"No hybrid cache: {path}. Run without --use-cache first.")
        return empty
    try:
        cache = json.loads(path.read_text(encoding="utf-8"))
        if (not isinstance(cache, dict) or cache.get("schema_version") != CACHE_SCHEMA
                or cache.get("ocr_config") != config or not isinstance(cache.get("frames"), dict)):
            raise ValueError("Legacy Paddle cache or incompatible hybrid model/configuration")
        return cache
    except (ValueError, OSError) as exc:
        if cache_only:
            raise ValueError(f"Cannot reuse {path}: {exc}. Run without --use-cache to rebuild.") from exc
        return empty


def process_battle(battle: Path, output: Path, config: dict, names: set[str], models: Any,
                   *, cache_only: bool = False, refresh: bool = False) -> dict:
    images = sorted((battle / "images").glob("battle_detail_*.png"))
    if not images:
        raise ValueError(f"No battle screenshots: {battle / 'images'}")
    cache_path = output / ".ocr_cache.json"
    cache = _cache(cache_path, config, cache_only, refresh)
    frames, review_frames = [], []
    reused = 0
    for index, path in enumerate(images):
        # Decode and hash the same byte snapshot, even if a capture process
        # replaces the PNG while this run is in flight.
        image_bytes = path.read_bytes()
        try:
            image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR) if image_bytes else None
        except cv2.error as exc:
            raise ValueError(f"Unreadable screenshot: {path}") from exc
        if image is None or image.shape[:2] != (2340, 1080):
            raise ValueError(f"Expected a readable 1080×2340 screenshot: {path}")
        x0, y0, x1, y1 = CROP
        crop = image[y0:y1, x0:x1]
        source_hash = hashlib.sha256(image_bytes).hexdigest()
        raw = cache["frames"].get(path.name)
        valid = False
        if isinstance(raw, dict) and raw.get("image_sha256") == source_hash:
            try:
                validate_raw(raw)
                valid = True
            except (ValueError, TypeError) as exc:
                if cache_only:
                    raise ValueError(f"Invalid cached evidence for {path.name}: {exc}; refusing live OCR under --use-cache") from exc
        if valid:
            reused += 1
        else:
            if cache_only:
                raise ValueError(f"Missing, stale, or invalid cached evidence for {path.name}; refusing live OCR under --use-cache")
            localization = models.localize(crop)
            text = models.transcribe(crop)
            raw = {"image_sha256": source_hash, "glm_text": text, "localization": localization}
            validate_raw(raw)
            cache["frames"][path.name] = raw
            # Resume safely after interruption. A failed run never replaces the
            # previous published log; only complete per-frame raw evidence is cached.
            write_json(cache_path, cache)
        tagged = tag_transcript(raw["glm_text"], raw["localization"], crop, names)
        frames.append([line["text"] for line in tagged])
        review_frames.append({"image": path.name, "image_sha256": source_hash,
                              "crop_xyxy": list(CROP), "lines": tagged})
        print(f"  {battle.name} [{index + 1}/{len(images)}] {path.name}: {len(tagged)} lines" +
              (" (cached)" if valid else ""), flush=True)
    log_lines, boundaries = stitch_frames(frames)
    tokens = [t for frame in review_frames for line in frame["lines"] for t in line["tokens"]]
    unresolved = sum(token["side"] is None for token in tokens)
    unparsed = sum(len(line["unparsed_names"]) for frame in review_frames for line in frame["lines"])
    log_text = "\n".join(log_lines) + "\n"
    review = {
        "schema_version": 1, "battle": battle.name, "side_policy": SIDE_POLICY,
        "status": "needs_review" if unresolved or unparsed or boundaries else "complete",
        "ocr_config": config, "frames": review_frames,
        "counts": {"frames": len(images), "cached_frames": reused, "lines": len(log_lines),
                   "name_tokens": len(tokens), "unresolved_name_tokens": unresolved,
                   "unparsed_name_mentions": unparsed},
        "unverified_boundaries": boundaries,
        "log_sha256": hashlib.sha256(log_text.encode()).hexdigest(),
        "note": "No name-wide side consensus, inferred ownership, fuzzy numeric deduplication, or synthesized event text. Inspect pending tags and unverified overlap boundaries.",
    }
    write_json(output / "battle_log.review.json", review)
    atomic_write(output / "battle_log.txt", log_text)
    print(f"Wrote {output / 'battle_log.txt'}: {unresolved}/{len(tokens)} pending tags; "
          f"{len(boundaries)} unverified boundaries", flush=True)
    return review


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("battle", nargs="?", help="Battle directory name")
    parser.add_argument("--all", action="store_true", help="Process every local battle")
    parser.add_argument("--list", action="store_true", help="List battle directories and exit")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--use-cache", action="store_true", help="Re-tag valid hybrid evidence only; never run/download models")
    mode.add_argument("--refresh", action="store_true", help="Recompute all frames instead of resuming compatible cached evidence")
    parser.add_argument("--output-dir", type=Path, help="Write <output-dir>/<battle>/ instead of beside the screenshots")
    parser.add_argument("--model-dir", type=Path, help="Local GLM model override (all model/processor bytes are fingerprinted)")
    args = parser.parse_args(argv)
    battles = sorted(p for p in BATTLES_DIR.iterdir() if p.is_dir() and list((p / "images").glob("battle_detail_*.png"))) if BATTLES_DIR.exists() else []
    if args.list:
        for battle in battles:
            print(f"{battle.name}: {len(list((battle / 'images').glob('battle_detail_*.png')))} frames")
        return 0
    if args.all and args.battle:
        parser.error("Choose --all or a battle ID, not both")
    if args.battle:
        battles = [p for p in battles if p.name == args.battle]
    if not battles:
        parser.error("No matching battle screenshots found")
    if not args.all and len(battles) != 1:
        parser.error("Choose a battle ID or --all; use --list to inspect available fixtures")
    try:
        config = configuration(args.model_dir)
        names = load_names()
        models = LocalModels(args.model_dir)
        for battle in battles:
            output = args.output_dir / battle.name if args.output_dir else battle
            process_battle(battle, output, config, names, models,
                           cache_only=args.use_cache, refresh=args.refresh)
    except (OSError, ValueError, RuntimeError, ImportError) as exc:
        parser.exit(1, f"OCR failed: {exc}\nRun with: uv run --project study-battle-report python study-battle-report/ocr_battle_log.py ...\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
