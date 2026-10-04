#!/usr/bin/env bash
# Keeps heavy, regenerable folders out of iCloud when the project lives in a synced folder (such as ~/Documents).
# iCloud skips any file or folder whose name ends in ".nosync", so each folder below becomes "<name>.nosync" with a
# symlink "<name>" pointing at it. Builds and tools see the usual path; iCloud never uploads or evicts the contents.
#
# Run it once after cloning, and again after any `npm ci` (which recreates node_modules as a real folder):
#     npm run setup:nosync
# Safe to repeat. Runtime data in .local is never discarded: if both .local and .local.nosync exist it stops and says so.
set -euo pipefail
cd "$(dirname "$0")/../.."

# path : policy   (regenerable folders are replaced, runtime data is kept)
FOLDERS=("node_modules:replace" ".next:replace" "backend/target:replace" ".local:keep")

for entry in "${FOLDERS[@]}"; do
  p="${entry%%:*}"; policy="${entry##*:}"; base="$(basename "$p")"
  if [[ -L "$p" ]]; then echo "nosync: $p already a link -> $(readlink "$p")"; continue; fi
  mkdir -p "$(dirname "$p")"
  if [[ -d "$p" ]]; then
    if [[ -e "$p.nosync" ]]; then
      if [[ "$policy" == "replace" ]]; then rm -rf "$p.nosync"; else echo "nosync: STOP: both $p and $p.nosync exist; merge them by hand" >&2; exit 1; fi
    fi
    mv "$p" "$p.nosync"
  else
    mkdir -p "$p.nosync"
  fi
  ln -s "$base.nosync" "$p"
  echo "nosync: $p -> $base.nosync"
done
