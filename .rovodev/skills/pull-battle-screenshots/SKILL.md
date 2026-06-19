---
name: pull-battle-screenshots
description: "Copies battle-report screenshots from a USB-connected Android phone (in /sdcard/Pictures/Screenshots/) directly to a local folder via ADB, with no cloud round-trip. Two filename patterns are supported - battle_detail_*.png (saved by autojs/battle-detail.js) goes to a per-battle dir study-battle-report/battles/<id>/images (default staging: battles/_incoming/images), and screenshot_*.png (native phone screenshots) goes to ./data/images. Triggered when the user asks to pull/copy/import battle screenshots from the phone."
allowed-tools:
  - bash
  - open_files
---

# Pull Battle Screenshots from Phone

Use this skill when the user wants to copy battle-report screenshots from their
Android phone directly onto the computer over USB, **without** uploading to
Huawei Cloud (or any cloud drive).

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
  timestamp). The OCR step auto-detects the battle when only one exists, or takes
  the id explicitly.
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
bash .rovodev/skills/pull-battle-screenshots/pull_battles.sh [--pattern PATTERN] [DEST_DIR] [--clean]
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

## Important

- Never upload to or read from any cloud drive; this skill's whole point is the
  direct USB path.
- Do not delete files from the phone unless the user explicitly asks (`--clean`).
- Preserve the original `<pattern>_<timestamp>.png` filenames so the timestamps
  stay meaningful and ordering is preserved.
