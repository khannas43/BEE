#!/usr/bin/env bash
# npm run local:health — one line per component; exit 1 if any is down.
BEE_RUN_LOCK=skip source "$(dirname "$0")/lib.sh"

fails=0
report() { printf '%-9s %-4s %s\n' "$1" "$2" "$3"; [[ "$2" == "UP" ]] || fails=$((fails + 1)); }

while IFS='|' read -r name status detail; do
  report "$name" "$status" "$detail"
done < <(runtime_health_rows)

exit $(( fails > 0 ))
