#!/usr/bin/env bash
# iCloud sync-conflict copies ("name 2.ext", "folder 2") appear in this repo because it lives under ~/Documents (BL-034, BL-094).
# They break the build (Maven sees two classes, Flyway two versions) and pollute `git status`.
# Default: list them. With --move: move them (not delete) into .local/icloud-dupes/<timestamp>/, keeping their paths,
# and say how many differ from the file they shadow. Skips node_modules, .git and the *.nosync folders.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
MOVE=0; [[ "${1:-}" == "--move" ]] && MOVE=1
DEST=".local/icloud-dupes/$(date +%Y%m%d-%H%M%S)"
found=0
while IFS= read -r -d '' p; do
  p="${p#./}"
  found=$((found + 1))
  original="$(sed -E 's/ [0-9]+(\.[^./ ]+)?$/\1/' <<<"$p")"
  if [[ -e "$original" && -f "$p" ]]; then
    if cmp -s "$p" "$original"; then note="identical to $original"; else note="DIFFERS from $original"; fi
  elif [[ -d "$p" ]]; then note="folder"
  else note="no original at $original"
  fi
  echo "$p  [$note]"
  if ((MOVE)); then mkdir -p "$DEST/$(dirname "$p")"; mv "$p" "$DEST/$p"; fi
done < <(find . \( -path ./node_modules -o -path ./.git -o -path './*.nosync' -o -path './backend/target.nosync' -o -path ./.local \) -prune -o \
  -name '* [0-9]' -print0 -o -name '* [0-9].*' -print0 2>/dev/null)
if ((found == 0)); then echo "no iCloud duplicates"; elif ((MOVE)); then echo "moved $found to $DEST"; else echo "$found found; run with --move to set them aside"; fi
