---
name: ocr-battle-log
description: OCRs the scrolling battle-detail (战报详情) screenshots in study-battle-report/images into a single de-duplicated, side-tagged, database-corrected battle log at study-battle-report/battle_log.txt. Names are colour-tagged blue=我方 / red=敌方, and hero/skill/formation/bond names are snapped to canonical spellings from web/src/database.json. Triggered when the user asks to OCR / scan / extract / read the battle screenshots into text.
allowed-tools:
  - bash
  - open_files
  - create_file
  - find_and_replace_code
  - delete_file
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
5. **Database cross-reference + bracket repair.** Hero / skill / formation / bond
   names are fuzzy-matched (difflib) against `web/src/database.json` and snapped
   to the canonical spelling. Several bracket-OCR failures are repaired
   conservatively (only when the inner text matches a known hero):
     * missing closer:        `[袁绍的…`  → `[袁绍]的…`
     * missing opener:        `袁绍]的…`  → `[袁绍]的…`
     * spurious leading open:  `【[诸葛亮]…` / `[[袁绍]…` → strip the orphan opener
     * mismatched opener:     `【袁绍]…`  → `[袁绍]…` (opening `[` misread as `【`
       but the `]` closer survived; safe because real `【skill】` close with `】`)
     * fully lost brackets:    bare `诸葛亮…` → `[诸葛亮]…`
   These run in **two places** — per-frame (`repair_brackets`, on untagged text)
   and again post-stitch (`merge_fragments._fix_inline`, on already-tagged cached
   text) — so they also fix the output on a `--use-cache` re-stitch.
6. **Stitch + dedup.** A rolling fuzzy-window dedup merges the (typically 40–60)
   overlapping frames into one ordered log, robust to OCR line-split jitter while
   preserving genuinely repeated events from different rounds (each hero's
   `开始行动`).
7. **Fragment merge.** Rejoins OCR-wrapped entries (dangling connectors,
   reversed name/action order, multi-line 普通攻击 splits) and truncates any
   stragglers after the battle result line (平局/胜利/失败).
8. **Side-tag consensus normalisation** (`backfill_sides`). Per-frame colour
   detection is noisy — a hero's name can be mis-coloured or left untagged on
   individual rows (observed ~15-30% of a name's rows). Since a hero's side is
   constant for the whole battle, a final pass takes each name's **majority**
   side across the log and (a) back-fills bare `[name]` brackets and (b)
   corrects minority mis-tags to the consensus. A name is only resolved when its
   dominant side wins ≥ `SIDE_CONSENSUS_THRESHOLD` (0.65) of its occurrences, so
   a genuine mirror match (same hero on both teams, ~50/50) is left untouched.
   The same pass also does **side-only inference for OCR-garbled non-names**
   (e.g. `[失售]`, `[生信]`, `[不偈]` — all badly-mangled `朱儁`). It learns each
   skill's side from resolved owners (`[side:hero]发动战法【skill】`) and then,
   *only when deterministic*, tags a garbled name's side from skill context:
     * victim — `[?]由于…【skill】…(损失/伤害)` → **opposite** of the skill's side
       (the `由于` clause is checked first, since the `损失` tail often wraps to
       the next line, leaving only `由于【skill】`);
     * owner/beneficiary — `[?]的「skill」效果` / `[?]执行来自【skill】` → **same**
       side as the skill (only when there is no `由于` clause to invert it).
   It **never guesses the hero name** (the glyph is unrecoverable) — only the
   `[我方:…]`/`[敌方:…]` prefix is added. Names with no skill/cause clue stay bare.

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
- **The cache is keyed by image filename.** Freshly-pulled screenshots have new
  timestamps in their names, so a new pull is always a full re-OCR (the slow
  path) regardless of an existing cache. `--use-cache` only helps when re-running
  against the *same* image set you already OCR'd.
- **OCR is slow (~7 min for ~50 frames on Mac CPU)** and the script's per-frame
  `[idx/total]` progress prints are **block-buffered when stdout is redirected**,
  so they won't appear until the run finishes. Prefer launching it in the
  background and polling, e.g.:
  ```bash
  uv run python study-battle-report/ocr_battle_log.py > /tmp/ocr_run.log 2>&1 &
  ```
  To confirm it's actually working (not hung), check the **Python worker's** CPU
  — not the bash wrapper or the `uv` shim:
  ```bash
  pgrep -f ocr_battle_log.py | while read p; do ps -p $p -o pid,etime,%cpu,time; done
  ```
  A worker at ~100%+ CPU with growing CPU `time` is healthy. The run is done when
  `.ocr_cache.json`'s mtime updates and the log shows `Wrote N lines to ...`.

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
- `SIDE_CONSENSUS_THRESHOLD` — min dominant-side fraction (0.65) for a name to be
  side-normalised. Lower it if heroes are left split; raise it toward ~0.55 only
  if you expect genuine mirror matches you must keep un-normalised.
- Colour HSV ranges in `_color_masks` — blue (我方) vs red (敌方) text.

## Verifying output

1. `wc -l study-battle-report/battle_log.txt` and eyeball `head`/`tail` — it
   should start at `行动顺序判断完毕` and end at the result line (e.g. `平局!`).
2. Spot-check a couple of source screenshots with `open_files` against the
   corresponding section of the log.
3. Check there is no gross block duplication (the same 6-line window repeating
   within a few hundred lines is the failure signature).
4. **Scan for residual bracket artifacts** on name tokens:
   ```bash
   # Lines whose name bracket is malformed (stray/mismatched opener):
   grep -nE "^(【\[|\[\[|【[一-龥]{2,4}\])" study-battle-report/battle_log.txt
   ```
   This should return **nothing**. Any `【[name]` (spurious opener) or `【name]`
   (mismatched opener) hits mean the bracket-repair rules need attention. A few
   `^【skill】…` lines are fine — those are legitimate continuation fragments
   where a `[name]的` prefix wrapped to the previous line (skill brackets
   correctly close with `】`, not `]`).
5. **Check side-tag consistency.** After consensus normalisation each real hero
   should appear on exactly one side. Verify with:
   ```bash
   python3 -c "import re,collections,sys; \
   c={}; [c.setdefault(n,collections.Counter()).update([s]) \
   for l in open('study-battle-report/battle_log.txt',encoding='utf-8') \
   for s,n in re.findall(r'\[(我方|敌方):([^\[\]]+)\]',l)]; \
   [print(n,dict(v)) for n,v in sorted(c.items(),key=lambda x:-sum(x[1].values()))]"
   ```
   Real heroes (the ones with high counts) should each show a single side. A
   handful of single-count garbled names are OCR noise and can be ignored. A
   high-count name split across both sides means either a true mirror match
   (lower `SIDE_CONSENSUS_THRESHOLD`) or a colour-detection problem to inspect.
   The run also prints `inferred N garbled-name side(s) from skill context`;
   those are side-only tags on unrecoverable glyphs (e.g. `[敌方:不偈]`). If you
   want to confirm one, locate its source frame via the OCR cache and eyeball the
   name colour — the *side* should match even though the glyph stays garbled.

## Important

- Always OCR **only the cropped main area** — never the top/left/bottom nav.
- Colour = side: **blue is 我方 (our)**, **red is 敌方 (enemy)**. Do not invert.
- Keep corrections **conservative**: only snap a token to the database when the
  fuzzy match clears the threshold, so unknown text is never silently corrupted.
- Preserve legitimately repeated round events; only remove scroll-overlap dups.
- Clean up any temporary run logs with the **`delete_file`** tool, not `rm`
  (shell file-deletion is blocked in this environment).
