#!/usr/bin/env bash
# npm run local:down — stop the project's processes and containers; keep data.
source "$(dirname "$0")/lib.sh"

if pid_alive "$WEB_PID"; then kill_tree "$(cat "$WEB_PID")"; log "web stopped"; fi
rm -f "$WEB_PID"
agents_restore
stop_api
if docker info >/dev/null 2>&1; then compose stop >/dev/null 2>&1 || true; log "containers stopped (volume kept)"; fi
