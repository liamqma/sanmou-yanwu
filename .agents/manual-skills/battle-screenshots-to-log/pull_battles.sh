#!/bin/bash
# Pull one mixed batch of Auto.js battle-detail screenshots over ADB.
#
# Usage:
#   bash pull_battles.sh DEST_DIR [--clean]
#
# DEST_DIR should be study-battle-report/battles/<batch-id>/images.
# --clean removes the remote files only after every pull succeeds and every
# local file is non-empty.

set -euo pipefail

SRC_DIR="/sdcard/Pictures/Screenshots"
GLOB="battle_detail_*.png"
DEST=""
CLEAN=0

for arg in "$@"; do
  case "$arg" in
    --clean)
      CLEAN=1
      ;;
    --*)
      echo "ERROR: unknown option: $arg" >&2
      exit 2
      ;;
    *)
      if [ -n "$DEST" ]; then
        echo "ERROR: expected one destination directory." >&2
        exit 2
      fi
      DEST="$arg"
      ;;
  esac
done

if [ -z "$DEST" ]; then
  echo "Usage: bash pull_battles.sh DEST_DIR [--clean]" >&2
  exit 2
fi

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

STATE="$("$ADB" get-state 2>/dev/null || true)"
if [ "$STATE" != "device" ]; then
  echo "ERROR: no authorized device (adb state: '${STATE:-none}')." >&2
  echo "Connect the phone, enable USB debugging, and accept its authorization prompt." >&2
  "$ADB" devices -l >&2 || true
  exit 1
fi

FILES="$("$ADB" shell ls "$SRC_DIR/$GLOB" 2>/dev/null | tr -d '\r' || true)"
if [ -z "$FILES" ]; then
  echo "ERROR: no $GLOB files found in $SRC_DIR." >&2
  exit 1
fi

COUNT=0
while IFS= read -r remote_path; do
  [ -z "$remote_path" ] && continue
  filename="${remote_path##*/}"
  case "$filename" in
    battle_detail_[0-9]*.png) ;;
    *)
      echo "ERROR: unexpected remote filename: $remote_path" >&2
      exit 1
      ;;
  esac
  timestamp="${filename#battle_detail_}"
  timestamp="${timestamp%.png}"
  case "$timestamp" in
    ''|*[!0-9]*)
      echo "ERROR: unexpected remote filename: $remote_path" >&2
      exit 1
      ;;
  esac
  COUNT=$((COUNT + 1))
done <<< "$FILES"

if [ "$COUNT" -eq 0 ]; then
  echo "ERROR: no valid battle-detail screenshots found." >&2
  exit 1
fi

mkdir -p "$DEST"

# Reusing a destination for the same remote batch is safe. Refuse to mix in
# screenshots left by a different batch, because that would create false OCR
# boundaries and misleading logs.
for local_path in "$DEST"/battle_detail_*.png; do
  [ -e "$local_path" ] || continue
  local_name="${local_path##*/}"
  FOUND=0
  while IFS= read -r remote_path; do
    if [ "${remote_path##*/}" = "$local_name" ]; then
      FOUND=1
      break
    fi
  done <<< "$FILES"
  if [ "$FOUND" -ne 1 ]; then
    echo "ERROR: destination contains a screenshot from another batch: $local_path" >&2
    echo "Choose a new batch destination instead of combining captures." >&2
    exit 1
  fi
done

PULLED=0
while IFS= read -r remote_path; do
  [ -z "$remote_path" ] && continue
  filename="${remote_path##*/}"
  local_path="$DEST/$filename"
  "$ADB" pull "$remote_path" "$local_path"
  if [ ! -s "$local_path" ]; then
    echo "ERROR: pulled file is empty: $local_path" >&2
    exit 1
  fi
  PULLED=$((PULLED + 1))
done <<< "$FILES"

if [ "$PULLED" -ne "$COUNT" ]; then
  echo "ERROR: expected $COUNT files but pulled $PULLED." >&2
  exit 1
fi

echo "Pulled $PULLED battle-detail screenshot(s) into: $DEST"

if [ "$CLEAN" -eq 1 ]; then
  while IFS= read -r remote_path; do
    [ -z "$remote_path" ] && continue
    "$ADB" shell rm "$remote_path"
  done <<< "$FILES"
  echo "Removed the $PULLED verified source screenshot(s) from the phone."
fi
