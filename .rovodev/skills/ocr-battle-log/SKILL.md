---
name: ocr-battle-log
description: OCRs the scrolling battle-detail (战报详情) screenshots in study-battle-report/images into a single de-duplicated, side-tagged, database-corrected battle log at study-battle-report/battle_log.txt. Names are colour-tagged blue=我方 / red=敌方, and hero/skill/formation/bond names are snapped to canonical spellings from web/src/database.json. Triggered when the user asks to OCR / scan / extract / read the battle screenshots into text.
allowed-tools:
  - bash
  - open_files
  - create_file
  - find_and_replace_code
---

# OCR Battle Log

Use this skill when the user wants to turn the **scrolling battle-detail
screenshots** (the 战报详情 view, captured frame-by-frame while scrolling, one
per game battle) in `study-battle-report/images/battle_detail_*.png` into a
single readable text log.

The driver script is **`study-battle-report/ocr_battle_log.py`** and the output
is **`study-battle-report/battle_log.txt`**.

## What the pipeline does

1. **Crop the main area.** Drops the top `我方/敌方` tab, the left round-marker
   nav, and the bottom nav; OCRs only the log panel
   (`y∈[CROP_TOP,CROP_BOTTOM], x∈[CROP_LEFT,CROP_RIGHT]`, tuned for 1080×2340).
2. **Skip near-duplicate frames.** A 16×16 perceptual **dHash** of the cropped
   panel (Hamming distance ≤ `DHASH_DUP_THRESHOLD`) detects frames that are
   visually identical but byte-different (cursor blink / anti-alias jitter), so
   the slow PaddleOCR call is skipped and the prior frame's lines are reused.
3. **OCR with PaddleOCR** (`lang="ch"`), ordered top-to-bottom.
4. **Colour side-tagging.** Each `[name]` is tagged `[我方:…]` (blue) or
   `[敌方:…]` (red). PaddleOCR boxes for this font sit ~1 row above the glyphs,
   so colour is sampled from a downward-biased band over the left (name) region,
   picking the coloured segment nearest the true glyph row.
5. **Database cross-reference.** Hero / skill / formation / bond names are
   fuzzy-matched (difflib) against `web/src/database.json` and snapped to the
   canonical spelling. Dropped/half/mismatched brackets are repaired
   (`[袁绍的` → `[袁绍]的`, `【袁绍]` → `[袁绍]`, bare `诸葛亮` → `[诸葛亮]`).
6. **Stitch + dedup.** A rolling fuzzy-window dedup merges the 60 overlapping
   frames into one ordered log, robust to OCR line-split jitter while preserving
   genuinely repeated events from different rounds (each hero's `开始行动`).
7. **Fragment merge.** Rejoins OCR-wrapped entries (dangling connectors,
   reversed name/action order, multi-line 普通攻击 splits) and truncates any
   stragglers after the battle result line (平局/胜利/失败).

## Running

```bash
# Full run (does OCR; writes study-battle-report/battle_log.txt):
uv run python study-battle-report/ocr_battle_log.py

# Re-run stitching / fragment-merge tuning WITHOUT re-OCR (uses the cache):
uv run python study-battle-report/ocr_battle_log.py --use-cache
```

- The slow part is OCR. The script writes a per-image cache to
  `study-battle-report/.ocr_cache.json`; pass `--use-cache` to iterate on the
  pure-text post-processing (stitch / merge) in seconds.
- Both `.ocr_cache.json` and `battle_log.txt` are git-ignored (regenerable).

## Prerequisites

- Screenshots already pulled into `study-battle-report/images/` (see the
  `pull-battle-screenshots` skill).
- The `uv` venv with PaddleOCR + OpenCV (project default `.venv`). Verify with
  `uv run python -c "import paddleocr, cv2"` if OCR fails to import.

## Tuning knobs (top of ocr_battle_log.py)

- `CROP_TOP/BOTTOM/LEFT/RIGHT` — main-area crop; re-tune if the resolution or
  game UI layout changes (validate against a sample image).
- `DHASH_DUP_THRESHOLD` — higher = more aggressive near-dup skipping.
- `NAME_MATCH_THRESHOLD` — fuzzy threshold for snapping names to the database.
- Colour HSV ranges in `_color_masks` — blue (我方) vs red (敌方) text.

## Verifying output

1. `wc -l study-battle-report/battle_log.txt` and eyeball `head`/`tail` — it
   should start at `行动顺序判断完毕` and end at the result line (e.g. `平局!`).
2. Spot-check a couple of source screenshots with `open_files` against the
   corresponding section of the log.
3. Check there is no gross block duplication (the same 6-line window repeating
   within a few hundred lines is the failure signature).

## Important

- Always OCR **only the cropped main area** — never the top/left/bottom nav.
- Colour = side: **blue is 我方 (our)**, **red is 敌方 (enemy)**. Do not invert.
- Keep corrections **conservative**: only snap a token to the database when the
  fuzzy match clears the threshold, so unknown text is never silently corrupted.
- Preserve legitimately repeated round events; only remove scroll-overlap dups.
