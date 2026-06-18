---
name: battle-screenshots-to-log
description: "End-to-end pipeline that turns battle-report screenshots on a USB-connected Android phone into a single de-duplicated, side-tagged, database-corrected battle log. Stage 1 pulls screenshots over ADB (no cloud round-trip): battle_detail_*.png (autojs/battle-detail.js) for ONE battle goes to study-battle-report/battles/<id>/images, and screenshot_*.png (native) goes to ./data/images. Stage 2 OCRs the scrolling 战报详情 frames for a battle into study-battle-report/battles/<id>/battle_log.txt, colour-tagging names blue=我方 / red=敌方 and snapping hero/skill/formation/bond names to web/src/database.json. Triggered when the user asks to pull/copy/import battle screenshots from the phone, and/or to OCR / scan / extract / read the battle screenshots into text."
allowed-tools:
  - bash
  - open_files
  - create_file
  - find_and_replace_code
  - delete_file
---

# Battle Screenshots → Battle Log

Use this skill to go from **battle-report screenshots on the phone** to a single
readable, side-tagged **battle log** text file. It has two stages that are
usually run back-to-back but can be invoked independently:

1. **Pull** the screenshots off a USB-connected Android phone via ADB (no cloud
   round-trip).
2. **OCR** the scrolling battle-detail (战报详情) frames for ONE battle into a
   stitched, de-duplicated, database-corrected `battle_log.txt`.

Pick the stage by intent:

- "pull / copy / import battle screenshots from the phone" → **Stage 1** only
  (then usually continue to Stage 2).
- "OCR / scan / extract / read the battle screenshots into text" → **Stage 2**
  (screenshots must already be pulled into `battles/<id>/images/`).

## Defaults — do NOT ask the user

Unless the user explicitly says otherwise in their request, apply these defaults
silently (no clarifying questions):

- **Battle id** = the **earliest screenshot timestamp** of the pulled set (e.g.
  `battles/1781783709822/`). Use this for both the per-battle pull dest and the
  Stage 2 id. Only use a friendly label (`win_vs_yuanshu`, …) when the user
  supplies one.
- **After a `battle_detail_*.png` pull, continue straight into Stage 2 (OCR)** to
  produce `battle_log.txt`. (OCR is slow, ~7 min for ~60 frames; launch it in the
  background and poll — see Stage 2 "Running".)
- **Keep screenshots on the phone** — never pass `--clean`. Only clear the phone
  when the user explicitly asks.

**Per-battle layout.** Each battle is self-contained under
`study-battle-report/battles/<id>/`:

```text
study-battle-report/battles/<id>/
    images/             # battle_detail_*.png screenshots for this battle
    battle_log.txt      # stitched, side-tagged log (Stage 2 output)
    .ocr_cache.json     # per-image OCR cache (regenerable)
```

`<id>` defaults to the **earliest screenshot timestamp** (see "Defaults" above);
use a friendly label (e.g. `win_vs_yuanshu`, `draw_vs_yuanshu`) only when the
user supplies one.

---

# Stage 1 — Pull Battle Screenshots from Phone

Copy battle-report screenshots from the Android phone directly onto the computer
over USB, **without** uploading to Huawei Cloud (or any cloud drive).

The phone stores both kinds of screenshot in the same folder:

```text
/sdcard/Pictures/Screenshots/battle_detail_<timestamp>.png   # saved by autojs/battle-detail.js
/sdcard/Pictures/Screenshots/screenshot_<timestamp>.png      # native phone screenshots
```

## Destination resolution

The destination depends on the **filename pattern** being pulled:

- **`battle_detail_*.png`** → a **per-battle** dir
  `study-battle-report/battles/<id>/images` (these are the autojs-captured
  battle-detail screenshots for ONE battle, ready for OCR). Since each pull is a
  distinct battle, **prefer passing an explicit per-battle dest**, e.g. a
  human-readable label like `study-battle-report/battles/win_vs_yuanshu/images`.
  If no dest is given, the script stages into
  `study-battle-report/battles/_incoming/images`, which you should then rename to
  `battles/<id>/images` (id = a friendly label, or the earliest screenshot
  timestamp). Stage 2 auto-detects the battle when only one exists, or takes the
  id explicitly.
- **`screenshot_*.png`** → `./data/images` (native phone screenshots, relative to
  the current working directory; this is where `make extract` reads from).
- If the user gives an explicit destination path, use that path verbatim
  (it overrides the pattern-based default).

When the user doesn't say which pattern they want, check the phone for both and
pull whichever is present, sending each to its matching destination. If both are
present, ask the user which set they want (or pull both to their respective
folders).

Always `mkdir -p` the destination before pulling.

## Pre-flight checks

1. **Locate `adb`.** It may not be on PATH. Prefer, in order:
   - `adb` if on PATH (`command -v adb`)
   - `~/Library/Android/sdk/platform-tools/adb` (macOS Android SDK default)
   - `~/Android/Sdk/platform-tools/adb` (Linux default)
   If none exist, tell the user to install platform-tools
   (`brew install --cask android-platform-tools` on macOS) and stop.

2. **Check the device is connected and authorized.** Run `adb devices -l`:
   - `device` → good, proceed.
   - `unauthorized` → ask the user to tap **"Allow USB debugging"** on the
     phone (check "Always allow from this computer"), then re-check.
   - no devices → ask the user to plug in the phone, enable USB debugging
     (Settings → Developer Options), and set USB mode to File Transfer (MTP).

## Pulling

Run the helper script (preferred), which encapsulates adb discovery, the
pull loop, and an optional cleanup step:

```bash
bash .rovodev/skills/battle-screenshots-to-log/pull_battles.sh [--pattern PATTERN] [DEST_DIR] [--clean]
```

- `--pattern PATTERN` — optional; the filename glob to pull. One of
  `battle_detail_*.png` or `screenshot_*.png`. Defaults to `battle_detail_*.png`.
- `DEST_DIR` — optional; the destination directory. When omitted, it defaults to
  the pattern's matching folder (`study-battle-report/battles/_incoming/images`
  for `battle_detail_*.png`, `./data/images` for `screenshot_*.png`). For
  `battle_detail_*.png` prefer passing an explicit per-battle dir, e.g.
  `study-battle-report/battles/<id>/images`.
- `--clean` — optional; deletes the pulled files from the phone **after** a
  successful pull. Only pass this when the user explicitly asks to clear the
  phone afterward; otherwise leave the phone untouched.

If you prefer to inline the commands instead of the script, the equivalent is:

```bash
ADB="$(command -v adb || echo ~/Library/Android/sdk/platform-tools/adb)"
# Choose pattern + matching destination:
#   battle_detail_*.png -> study-battle-report/battles/<id>/images
#                          (or staging: study-battle-report/battles/_incoming/images)
#   screenshot_*.png    -> data/images
GLOB="screenshot_*.png"
DEST="data/images"
mkdir -p "$DEST"
for f in $("$ADB" shell ls /sdcard/Pictures/Screenshots/$GLOB 2>/dev/null | tr -d '\r'); do
  "$ADB" pull "$f" "$DEST/"
done
```

## After pulling

1. List the destination directory (`ls -l "$DEST"`) and report how many files
   were copied and where.
2. If no files matching the chosen pattern were found on the phone, say so:
   - For `battle_detail_*.png` — most likely the autojs script hasn't run yet,
     or the screenshots were already cleared. Consider checking for
     `screenshot_*.png` as well.
   - For `screenshot_*.png` — the screenshots may have been cleared already.
3. For a `battle_detail_*.png` pull, prefer pulling directly into
   `battles/<earliest-timestamp>/images` (the default id). If you staged into
   `battles/_incoming/`, rename it to `battles/<id>/` now. Then continue straight
   to **Stage 2** without asking (see "Defaults").

## Stage 1 — Important

- Never upload to or read from any cloud drive; this stage's whole point is the
  direct USB path.
- Do not delete files from the phone unless the user explicitly asks (`--clean`).
- Preserve the original `<pattern>_<timestamp>.png` filenames so the timestamps
  stay meaningful and ordering is preserved.

---

# Stage 2 — OCR Battle Log

Turn the **scrolling battle-detail screenshots** (the 战报详情 view, captured
frame-by-frame while scrolling, one set per game battle) into a single readable
text log.

The driver script is **`study-battle-report/ocr_battle_log.py`**; it auto-detects
the battle when only one exists, otherwise takes the id as a positional arg. List
battles with `--list`.

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
   stragglers after the battle result line. The result line is matched by its
   exclaimed outcome token at the *end* of the line (`平局/胜利/失败/战斗结束` +
   `!`/`！`), so both the bare form (`平局！`) and the longer phrasing
   (`攻方全部武将兵力为0，无法再战，守方胜利！`) are recognised.
8. **Side-tag consensus normalisation** (`backfill_sides`). Per-frame colour
   detection is noisy — a hero's name can be mis-coloured or left untagged on
   individual rows (observed ~15-30% of a name's rows). Since a hero's side is
   constant for the whole battle, a final pass takes each name's **majority**
   side across the log and (a) back-fills bare `[name]` brackets and (b)
   corrects minority mis-tags to the consensus. A name is only resolved when its
   dominant side wins ≥ `SIDE_CONSENSUS_THRESHOLD` (0.65) of its occurrences, so
   a genuine mirror match (same hero on both teams, ~50/50) is left untouched.
   When consensus is *ambiguous* (below threshold), an **opening-block side
   anchor** breaks the tie: the per-team补给/阵型/属性 buffs in the opening
   【判断结果】 block render in clean, unambiguous colour, so each name's first
   tagged occurrence there is a high-trust side signal used to resolve names
   whose mid-battle colour is noisy. The anchor is mirror-safe — in a genuine
   same-hero-both-sides match the name's first appearances disagree, so no anchor
   is recorded.
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
# List known battles:
uv run python study-battle-report/ocr_battle_log.py --list

# Full run for a specific battle (writes battles/<id>/battle_log.txt):
uv run python study-battle-report/ocr_battle_log.py <id>

# If only ONE battle exists, the id can be omitted (auto-detected):
uv run python study-battle-report/ocr_battle_log.py

# Re-run stitching / fragment-merge tuning WITHOUT re-OCR (uses that battle's cache):
uv run python study-battle-report/ocr_battle_log.py <id> --use-cache
```

- The slow part is OCR. The script writes a per-image cache to
  `study-battle-report/battles/<id>/.ocr_cache.json`; pass `--use-cache` to
  iterate on the pure-text post-processing (stitch / merge) in seconds.
- Per battle, both `.ocr_cache.json` and `battle_log.txt` are git-ignored
  (regenerable), as are the `images/`.
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
  the battle's `.ocr_cache.json` mtime updates and the log shows
  `Wrote N lines to .../battles/<id>/battle_log.txt`.

## Prerequisites

- Screenshots already pulled into `study-battle-report/battles/<id>/images/`
  (see **Stage 1** above, which stages into `battles/_incoming/images` — rename
  it to a friendly `battles/<id>` first).
- The `uv` venv with PaddleOCR + OpenCV (project default `.venv`). Verify with
  `uv run python -c "import paddleocr, cv2"` if OCR fails to import.

## Tuning knobs (top of ocr_battle_log.py)

- `CROP_TOP/BOTTOM/LEFT/RIGHT` — main-area crop; re-tune if the resolution or
  game UI layout changes (validate against a sample image).
- `DHASH_DUP_THRESHOLD` — higher = more aggressive near-dup skipping.
- `NAME_MATCH_THRESHOLD` — fuzzy threshold for snapping names to the database.
- `SIDE_CONSENSUS_THRESHOLD` — min dominant-side fraction (0.65) for a name to be
  side-normalised. Lower it if heroes are left split; raise it toward ~0.55 only
  if you expect genuine mirror matches you must keep un-normalised. (Names below
  this threshold are still resolved by the opening-block side anchor when that is
  unambiguous.)
- Colour HSV ranges in `_color_masks` — blue (我方) vs red (敌方) text.

## Verifying output

(Replace `<id>` below with your battle id, e.g. `battles/draw_vs_yuanshu`.)

1. `wc -l study-battle-report/battles/<id>/battle_log.txt` and eyeball
   `head`/`tail` — it should start at `行动顺序判断完毕` and end at the result
   line (e.g. `平局!`).
2. Spot-check a couple of source screenshots with `open_files` against the
   corresponding section of the log.
3. Check there is no gross block duplication (the same 6-line window repeating
   within a few hundred lines is the failure signature).
4. **Scan for residual bracket artifacts** on name tokens:
   ```bash
   # Lines whose name bracket is malformed (stray/mismatched opener):
   grep -nE "^(【\[|\[\[|【[一-龥]{2,4}\])" study-battle-report/battles/<id>/battle_log.txt
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
   for l in open('study-battle-report/battles/<id>/battle_log.txt',encoding='utf-8') \
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

## Stage 2 — Important

- Always OCR **only the cropped main area** — never the top/left/bottom nav.
- Colour = side: **blue is 我方 (our)**, **red is 敌方 (enemy)**. Do not invert.
- Keep corrections **conservative**: only snap a token to the database when the
  fuzzy match clears the threshold, so unknown text is never silently corrupted.
- Preserve legitimately repeated round events; only remove scroll-overlap dups.
- Clean up any temporary run logs with the **`delete_file`** tool, not `rm`
  (shell file-deletion is blocked in this environment).
