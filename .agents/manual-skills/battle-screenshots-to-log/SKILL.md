---
name: battle-screenshots-to-log
description: "Pull one mixed batch of battle_detail screenshots from a USB-connected Android phone, then OCR and split it into one clean, team-named TXT file per battle report. Use when the user asks to pull battle-report screenshots and turn them into battle logs."
allowed-tools:
  - bash
  - open_files
  - create_file
  - find_and_replace_code
  - delete_file
---

# Battle screenshots to logs

Run this workflow end to end. One phone capture batch may contain any number of
battle reports. Keep all frames together during the pull; the OCR script detects
battle boundaries from their content and writes one text file per battle.

The default batch layout is:

```text
study-battle-report/battles/<batch-id>/
    images/                 # original battle_detail_*.png files
    battle_logs/
        <our team> vs <enemy team> - <outcome> - <YYYY-MM-DD>.txt
        .manifest.json
    .ocr_cache.json         # regenerable, content-addressed OCR cache
```

Keep committed TXT fixtures in the stable `study-battle-report/battle_logs/`
directory. Do not place long-term fixtures under the timestamped batch
directory; that directory is for source images, OCR cache, and regenerable
per-batch output.

Use the earliest screenshot timestamp as `<batch-id>`, unless the user supplies
a label. A team filename resembles
`孟获+祝融+吕蒙 vs 周瑜+徐盛+夏侯惇 - 我方胜 - 2026-09-19.txt`. The outcome is `我方胜`,
`敌方胜`, or `平局`. Each side must contain exactly three canonical heroes.
Repeated matchups with the same outcome receive a numeric suffix. Stop without
publishing any logs if a roster or outcome cannot be recovered safely; capture
timestamps identify and order the source batch and supply the UTC calendar date
in each output filename.

## Defaults

- Perform both the pull and OCR stages unless the user explicitly requests only
  one stage.
- Pull only `battle_detail_*.png` from
  `/sdcard/Pictures/Screenshots/`. These are the frames produced by
  `autojs/battle-detail.js`.
- Keep screenshots on the phone. Pass `--clean` only when the user explicitly
  asks to remove them after a successful pull.
- Use a fresh OCR run for newly pulled images. Use `--use-cache` for a retry of
  an unchanged batch or when checking text-processing changes.
- Never upload screenshots to a cloud drive.

## 1. Pull the batch

Locate ADB in this order:

1. `adb` on `PATH`.
2. `~/Library/Android/sdk/platform-tools/adb`.
3. `~/Android/Sdk/platform-tools/adb`.

Run `adb devices -l`. Continue only when exactly one intended device is in the
`device` state. If it is `unauthorized`, ask the user to accept the USB-debugging
prompt. If none is connected, ask them to connect the phone and enable USB
debugging.

List the remote `battle_detail_*.png` files before choosing the destination.
Reject an empty list and any filename that does not match
`battle_detail_<digits>.png`. Derive the default batch id from the smallest
timestamp and set:

```bash
DEST="study-battle-report/battles/<batch-id>/images"
bash .agents/manual-skills/battle-screenshots-to-log/pull_battles.sh "$DEST"
```

The helper preserves filenames and fails when no files match or a pulled file is
empty. It accepts `--clean` after the destination only under the explicit rule
above. An explicit user label changes `<batch-id>`, while the destination must
remain `study-battle-report/battles/<batch-id>/images` because the OCR driver
uses that layout.

After pulling, count the local PNG files and verify they are readable images.
For example, use OpenCV `imread` from the project environment for every matching
file. Stop before OCR if the count is zero, a file is empty, or an image cannot
be decoded. Do not silently continue with a partial batch.

## 2. OCR and split the batch

Run the repository driver with the batch id:

```bash
uv run python study-battle-report/ocr_battle_log.py <batch-id>
```

For an unchanged retry:

```bash
uv run python study-battle-report/ocr_battle_log.py <batch-id> --use-cache
```

The driver crops the battle-log panel, runs the explicit Chinese PP-OCRv6
detector and recognizer, tags blue names as `我方` and red names as `敌方`,
normalizes known game names against `web/public/game-data/database.json`, and
stitches overlapping frames. It starts a new battle when a fresh opening block
appears after a completed result. Capture timestamps only order the images; they
do not determine battle boundaries. The driver writes raw OCR results
incrementally to a versioned cache keyed by image content and OCR configuration.

Each detected battle is written atomically to `battle_logs/` and recorded in
`.manifest.json` with its source-image range, image count, line count, opening
status, result status, outcome, and explicit `OCR不确定` line count. A successful
run publishes a complete replacement set. The driver removes the previous TXT
files and manifest before processing, so a failed rerun leaves no stale logs
that could be mistaken for current output.

## 3. Verify quality before reporting success

Verification is part of this workflow, not a final optional spot check. Treat
the generated text as unverified until all checks below pass. If a check fails,
inspect the relevant source frames and fix the OCR or stitching logic, rerun the
batch, and repeat the checks.

1. Require a successful OCR exit and a valid
   `battle_logs/.manifest.json` containing at least one battle.
2. Require the manifest entry count to equal the number of `*.txt` files, and
   confirm each named file exists and has a positive line count.
3. Require every entry to have `has_opening: true` and `has_result: true`.
   Missing either usually means an incorrect split or an incomplete capture.
4. Require each filename to contain exactly three heroes on both sides and an
   outcome of `我方胜`, `敌方胜`, or `平局`.
5. Check that every log starts with its opening/setup section and ends at its
   battle result. Inspect the head and tail of every TXT file.
6. Check for malformed square, skill, effect, and numeric brackets, broken
   parentheses, obvious repeated blocks, and clipped line fragments. Legitimate
   repeated combat actions across rounds must remain.
7. Compare representative opening, middle, boundary, and ending text against
   the corresponding screenshots. Include at least one source check on each
   side of every detected battle boundary.
8. Confirm roster-derived filenames agree with the opening team blocks. If a
   roster name is unreadable, repair the extraction only when the screenshots or
   game database support the correction; do not guess. Confirm `我方胜`, `敌方胜`,
   or `平局` agrees with the final zero-troop events and terminal result line.
9. Rerun with `--use-cache` and confirm the manifest and TXT bytes are stable.

Report the batch folder, source-image count, detected battle count, every output
TXT path, and any text that remains uncertain. Do not claim the logs are clean
when a structural or screenshot comparison check is unresolved.

## Safety and failure handling

- Preserve original filenames so chronological ordering remains reliable.
- Never combine a newly pulled set with an unrelated existing batch. If the
  chosen destination already contains different screenshots, choose a new batch
  id or stop and explain the conflict.
- Never delete phone files after a failed or partial pull.
- Do not commit screenshots, OCR caches, manifests, or generated logs unless the
  user invokes a workflow that explicitly authorizes publishing those artifacts.
