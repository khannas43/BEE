#!/usr/bin/env bash
# Point an existing ngrok tunnel at the local portal and restart Next.js with BEE_WEB_ORIGIN
# set to the public HTTPS URL (demo sign-in and same-origin BFF only; Keycloak PKCE still needs localhost).
#
# Usage (from repo root, portal already up on BEE_WEB_PORT):
#   export BEE_DEMO_LOGIN=1 BEE_MFA_REQUIRED=false   # recommended for remote viewers
#   npm run demo:ngrok
#
# Requires: ngrok on PATH, local web answering /api/runtime/health.
source "$(dirname "$0")/lib.sh"

export BEE_RUN_LOCK=skip

NGROK_API="http://127.0.0.1:4040"
NGROK_PID_FILE="$RUN_DIR/ngrok.pid"
NGROK_URL_FILE="$RUN_DIR/ngrok.url"
WEB_PORT="${BEE_WEB_PORT}"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

tunnel_https_url() {
  curl -sf "$NGROK_API/api/tunnels" | node -e "
    const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const t = (d.tunnels || []).find((x) => x.public_url && x.public_url.startsWith('https://'));
    if (!t) process.exit(1);
    process.stdout.write(t.public_url.replace(/\/$/, ''));
  "
}

wait_for_ngrok_api() {
  local i
  for i in $(seq 1 30); do
    curl -sf "$NGROK_API/api/tunnels" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  return 1
}

wait_http "http://127.0.0.1:${WEB_PORT}/api/runtime/health" 15 200 || die "portal is not up on 127.0.0.1:${WEB_PORT}; run npm run local:up first"

if ! curl -sf "$NGROK_API/api/tunnels" >/dev/null 2>&1; then
  command -v ngrok >/dev/null || die "ngrok is not installed (brew install ngrok)"
  log "starting ngrok http ${WEB_PORT}"
  rm -f "$NGROK_PID_FILE"
  detach "$NGROK_PID_FILE" ngrok http "$WEB_PORT" --log="$LOG_DIR/ngrok.log"
  wait_for_ngrok_api || die "ngrok agent did not start (see $LOG_DIR/ngrok.log)"
fi

PUBLIC="$(tunnel_https_url)" || die "no HTTPS ngrok tunnel found (start: ngrok http ${WEB_PORT})"
printf '%s\n' "$PUBLIC" >"$NGROK_URL_FILE"

export BEE_WEB_ORIGIN="$PUBLIC"
export BEE_TRUST_PROXY="${BEE_TRUST_PROXY:-1}"
export BEE_API_URL="http://127.0.0.1:${BEE_API_PORT}"
export NEXT_TELEMETRY_DISABLED=1

if pid_alive "$WEB_PID"; then
  kill_tree "$(cat "$WEB_PID")"
  log "web stopped for ngrok origin restart"
fi
rm -f "$WEB_PID"
agents_snapshot
detach "$WEB_PID" env BEE_WEB_ORIGIN="$BEE_WEB_ORIGIN" BEE_TRUST_PROXY="$BEE_TRUST_PROXY" BEE_DEMO_LOGIN="${BEE_DEMO_LOGIN:-}" BEE_MFA_REQUIRED="${BEE_MFA_REQUIRED:-}" \
  sh -c "cd \"$ROOT\" && exec node node_modules/next/dist/bin/next dev -p \"$WEB_PORT\" -H 127.0.0.1" >"$LOG_DIR/web.log" 2>&1
wait_http "http://127.0.0.1:${WEB_PORT}/api/runtime/health" 180 200 "$WEB_PID" || {
  tail -30 "$LOG_DIR/web.log" >&2
  die "web did not come back after ngrok restart"
}
agents_restore

log "ngrok public URL: $PUBLIC"
log "BEE_WEB_ORIGIN=$BEE_WEB_ORIGIN BEE_TRUST_PROXY=$BEE_TRUST_PROXY"
printf '\nRemote viewers:\n  Open %s/login\n  Use demo sign-in (not Keycloak) when BEE_DEMO_LOGIN=1.\n  ngrok free tier: add header or click through the browser warning once.\n  Local URL unchanged: http://127.0.0.1:%s\n' "$PUBLIC" "$WEB_PORT"
