#!/usr/bin/env bash
# npm run local:up — start PostgreSQL, Keycloak, the Spring API and Next.js (ADR-001 §3).
# Idempotent: components that are already running are left alone.
source "$(dirname "$0")/lib.sh"

require_docker
T0=$(now_ms)

assert_port_ours "$BEE_PG_PORT" postgres
assert_port_ours "$BEE_KC_PORT" keycloak
assert_port_ours "$BEE_API_PORT" api
assert_port_ours "$BEE_WEB_PORT" web

t=$(now_ms)
compose up -d postgres >"$LOG_DIR/compose-postgres.log" 2>&1 || { cat "$LOG_DIR/compose-postgres.log" >&2; die "postgres failed to start"; }
wait_container_healthy bee-local-postgres 60
PG_MS=$(( $(now_ms) - t )); log "postgres healthy on 127.0.0.1:${BEE_PG_PORT} (${PG_MS} ms)"

t=$(now_ms)
compose up -d keycloak >"$LOG_DIR/compose-keycloak.log" 2>&1 || { cat "$LOG_DIR/compose-keycloak.log" >&2; die "keycloak failed to start"; }
wait_http "${KC_ISSUER}/.well-known/openid-configuration" 240 200 bee-local-keycloak || { docker logs --tail 40 bee-local-keycloak >&2; die "keycloak realm not available"; }
KC_MS=$(( $(now_ms) - t )); log "keycloak realm ${BEE_REALM} available on 127.0.0.1:${BEE_KC_PORT} (${KC_MS} ms)"

t=$(now_ms)
start_api
API_MS=$(( $(now_ms) - t ))

bash "$(dirname "$0")/ensure-maint-role.sh" >"$LOG_DIR/ensure-maint-role.log" 2>&1 || { cat "$LOG_DIR/ensure-maint-role.log" >&2; die "maintenance DB role setup failed"; }

t=$(now_ms)
if pid_alive "$WEB_PID"; then
  log "web already running (pid $(cat "$WEB_PID"))"
else
  agents_snapshot
  rm -f "$WEB_PID"
  (cd "$ROOT" && export BEE_API_URL="http://127.0.0.1:${BEE_API_PORT}" NEXT_TELEMETRY_DISABLED=1 &&
    detach "$WEB_PID" node node_modules/next/dist/bin/next dev -p "$BEE_WEB_PORT" -H 127.0.0.1 >"$LOG_DIR/web.log" 2>&1)
  if ! wait_http "http://127.0.0.1:${BEE_WEB_PORT}/api/runtime/health" 180 200 "$WEB_PID"; then
    agents_restore; tail -40 "$LOG_DIR/web.log" >&2; die "web did not answer /api/runtime/health"
  fi
  agents_restore
  log "web up on 127.0.0.1:${BEE_WEB_PORT} (pid $(cat "$WEB_PID"))"
fi
WEB_MS=$(( $(now_ms) - t ))

TOTAL_MS=$(( $(now_ms) - T0 ))
cat > "$RUN_DIR/startup.json" <<JSON
{"postgres_ms":$PG_MS,"keycloak_ms":$KC_MS,"api_ms":$API_MS,"web_ms":$WEB_MS,"total_ms":$TOTAL_MS,"at":"$(date '+%Y-%m-%dT%H:%M:%S%z')"}
JSON
log "local runtime up in ${TOTAL_MS} ms (postgres ${PG_MS}, keycloak ${KC_MS}, api ${API_MS}, web ${WEB_MS})"
