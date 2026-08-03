#!/bin/bash
#
# pull_battles.sh — copy battle-report screenshots from a USB-connected Android
# phone directly to a local folder via ADB (no cloud round-trip).
#
# Usage:
#   bash pull_battles.sh [--pattern PATTERN] [DEST_DIR] [--clean]
#
#   --pattern PATTERN  Filename glob to pull. One of:
#                        battle_detail_*.png  (default) -> study-battle-report/battles/<id>/images
#                        screenshot_*.png               -> data/images
#   DEST_DIR           Destination directory. When omitted, defaults to the
#                      pattern's matching folder (see above). For battle_detail
#                      pulls you should normally pass an explicit per-battle dir,
#                      e.g.  study-battle-report/battles/<id>/images
#   --clean            Delete the pulled files from the phone after a successful pull.
#
set -euo pipefail

SRC_DIR="/sdcard/Pictures/Screenshots"

# --- Parse args (--pattern, DEST_DIR, --clean, in any order) ---
GLOB="battle_detail_*.png"
DEST=""
CLEAN=0
expect_pattern=0
for arg in "$@"; do
  if [ "$expect_pattern" -eq 1 ]; then
    GLOB="$arg"
    expect_pattern=0
    continue
  fi
  case "$arg" in
    --pattern) expect_pattern=1 ;;
    --clean)   CLEAN=1 ;;
    *)         DEST="$arg" ;;
  esac
done

# --- Default destination based on the pattern (if not explicitly given) ---
# For battle_detail_*.png the screenshots belong to ONE battle, so they live in
# a per-battle dir study-battle-report/battles/<id>/images. Since the id isn't
# known here, default to a clearly-named staging dir; the caller (or the
# ocr-battle-log skill) renames battles/_incoming -> battles/<id> afterwards.
if [ -z "$DEST" ]; then
  case "$GLOB" in
    battle_detail_*) DEST="study-battle-report/battles/_incoming/images" ;;
    screenshot_*)    DEST="data/images" ;;
    *)               DEST="data/images" ;;
  esac
fi

# --- Locate adb ---
if command -v adb >/dev/null 2>&1; then
  ADB="$(command -v adb)"
elif [ -x "$HOME/Library/Android/sdk/platform-tools/adb" ]; then
  ADB="$HOME/Library/Android/sdk/platform-tools/adb"
elif [ -x "$HOME/Android/Sdk/platform-tools/adb" ]; then
  ADB="$HOME/Android/Sdk/platform-tools/adb"
else
  echo "ERROR: adb not found. Install Android platform-tools." >&2
  echo "  macOS: brew install --cask android-platform-tools" >&2
  exit 1
fi

# --- Check device ---
STATE="$("$ADB" get-state 2>/dev/null || true)"
if [ "$STATE" != "device" ]; then
  echo "ERROR: no authorized device (adb state: '${STATE:-none}')." >&2
  echo "  - Plug in the phone and enable USB debugging." >&2
  echo "  - Tap 'Allow USB debugging' on the phone if prompted." >&2
  "$ADB" devices -l >&2 || true
  exit 1
fi

# --- Prepare destination ---
mkdir -p "$DEST"

# --- Gather file list from phone ---
FILES="$("$ADB" shell ls "$SRC_DIR/$GLOB" 2>/dev/null | tr -d '\r' || true)"
if [ -z "$FILES" ]; then
  echo "No $GLOB files found on the phone in $SRC_DIR."
  case "$GLOB" in
    battle_detail_*)
      echo "Has autojs/battle-detail.js been run yet?"
      echo "(Tip: native screenshots may exist as screenshot_*.png — try --pattern 'screenshot_*.png'.)"
      ;;
    *)
      echo "The screenshots may have been cleared already."
      ;;
  esac
  exit 0
fi

# --- Pull ---
COUNT=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  "$ADB" pull "$f" "$DEST/"
  COUNT=$((COUNT + 1))
done <<< "$FILES"

echo "Pulled $COUNT file(s) into: $DEST"

# --- Optional cleanup on the phone ---
if [ "$CLEAN" -eq 1 ]; then
  "$ADB" shell rm "$SRC_DIR/$GLOB"
  echo "Removed $GLOB from the phone."
fi
