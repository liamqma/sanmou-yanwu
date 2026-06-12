#!/bin/bash
#
# pull_battles.sh — copy battle-report screenshots from a USB-connected Android
# phone directly to a local folder via ADB (no cloud round-trip).
#
# Usage:
#   bash pull_battles.sh [DEST_DIR] [--clean]
#
#   DEST_DIR   Destination directory (default: ./images).
#              Pass study-battle-report/images (or any path) to override.
#   --clean    Delete battle_detail_*.png from the phone after a successful pull.
#
set -euo pipefail

SRC_DIR="/sdcard/Pictures/Screenshots"
GLOB="battle_detail_*.png"

# --- Parse args (DEST_DIR and/or --clean, in any order) ---
DEST="images"
CLEAN=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    *)       DEST="$arg" ;;
  esac
done

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
  echo "Has autojs/battle-detail.js been run yet?"
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
