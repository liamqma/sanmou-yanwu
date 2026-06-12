---
name: pull-battle-screenshots
description: Copies battle-report screenshots from a USB-connected Android phone (saved by autojs/battle-detail.js to /sdcard/Pictures/Screenshots/battle_detail_*.png) directly to a local folder via ADB, with no cloud round-trip. Destination defaults to ./images, or study-battle-report/images when the user asks for it. Triggered when the user asks to pull/copy/import battle screenshots from the phone.
allowed-tools:
  - bash
  - open_files
---

# Pull Battle Screenshots from Phone

Use this skill when the user wants to copy the battle-report screenshots that
`autojs/battle-detail.js` saved on their Android phone directly onto the
computer over USB, **without** uploading to Huawei Cloud (or any cloud drive).

The phone saves screenshots to:

```text
/sdcard/Pictures/Screenshots/battle_detail_<timestamp>.png
```

## Destination resolution

Pick the destination directory based on the user's request:

- **Default**: `./images` (relative to the current working directory).
- **`study-battle-report/images`**: when the user explicitly mentions
  `study-battle-report` (or "the study folder", "battle report folder", etc.).
- If the user gives an explicit path, use that path verbatim.

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
bash .rovodev/skills/pull-battle-screenshots/pull_battles.sh [DEST_DIR] [--clean]
```

- `DEST_DIR` — optional; defaults to `./images`. Pass
  `study-battle-report/images` (or any path) when requested.
- `--clean` — optional; deletes the `battle_detail_*.png` files from the phone
  **after** a successful pull. Only pass this when the user explicitly asks to
  clear the phone afterward; otherwise leave the phone untouched.

If you prefer to inline the commands instead of the script, the equivalent is:

```bash
ADB="$(command -v adb || echo ~/Library/Android/sdk/platform-tools/adb)"
DEST="images"   # or study-battle-report/images
mkdir -p "$DEST"
for f in $("$ADB" shell ls /sdcard/Pictures/Screenshots/battle_detail_*.png 2>/dev/null | tr -d '\r'); do
  "$ADB" pull "$f" "$DEST/"
done
```

## After pulling

1. List the destination directory (`ls -l "$DEST"`) and report how many files
   were copied and where.
2. If no `battle_detail_*.png` files were found on the phone, say so — most
   likely the autojs script hasn't run yet, or the screenshots were already
   cleared.

## Important

- Never upload to or read from any cloud drive; this skill's whole point is the
  direct USB path.
- Do not delete files from the phone unless the user explicitly asks (`--clean`).
- Preserve the original `battle_detail_<timestamp>.png` filenames so the
  timestamps stay meaningful and ordering is preserved.
