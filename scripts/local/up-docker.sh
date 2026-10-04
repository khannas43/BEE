#!/usr/bin/env bash
# npm run local:app:up — the same runtime as local:up, but the Spring API and the portal run as containers
# (docs/local/CONTAINERS.md). Stops host-mode processes first: both use the same ports.
source "$(dirname "$0")/lib.sh"
export BEE_APP_MODE=container

require_docker
T0=$(now_ms)

if pid_alive "$WEB_PID" || pid_alive "$API_PID"; then
  log "stopping the host-mode API and portal (same ports)"
  if pid_alive "$WEB_PID"; then kill_tree "$(cat "$WEB_PID")"; fi
  rm -f "$WEB_PID"; stop_api
fi
assert_port_ours "$BEE_PG_PORT" postgres
assert_port_ours "$BEE_KC_PORT" keycloak
assert_port_ours "$BEE_API_PORT" api
assert_port_ours "$BEE_WEB_PORT" web
mkdir -p "$LOG_DIR" "$ROOT/.local/documents"

compose up -d postgres >"$LOG_DIR/compose-postgres.log" 2>&1 || { cat "$LOG_DIR/compose-postgres.log" >&2; die "postgres failed to start"; }
wait_container_healthy bee-local-postgres 60
compose up -d keycloak >"$LOG_DIR/compose-keycloak.log" 2>&1 || { cat "$LOG_DIR/compose-keycloak.log" >&2; die "keycloak failed to start"; }
wait_http "${KC_ISSUER}/.well-known/openid-configuration" 240 200 bee-local-keycloak || { docker logs --tail 40 bee-local-keycloak >&2; die "keycloak realm not available"; }
log "postgres and keycloak up"

bash "$(dirname "$0")/ensure-runtime-role.sh" >"$LOG_DIR/ensure-runtime-role.log" 2>&1 || { cat "$LOG_DIR/ensure-runtime-role.log" >&2; die "runtime DB role setup failed"; }

t=$(now_ms)
compose --profile app build >"$LOG_DIR/compose-build.log" 2>&1 || { tail -40 "$LOG_DIR/compose-build.log" >&2; die "image build failed (log: $LOG_DIR/compose-build.log)"; }
log "images built ($(( $(now_ms) - t )) ms)"

compose --profile app up -d api >"$LOG_DIR/compose-api.log" 2>&1 || { cat "$LOG_DIR/compose-api.log" >&2; die "api container failed to start"; }
wait_http "http://127.0.0.1:${BEE_API_PORT}/actuator/health" 120 200 bee-local-api || { docker logs --tail 40 bee-local-api >&2; die "API container did not become healthy"; }
log "api container up on 127.0.0.1:${BEE_API_PORT}"

bash "$(dirname "$0")/ensure-maint-role.sh" >"$LOG_DIR/ensure-maint-role.log" 2>&1 || { cat "$LOG_DIR/ensure-maint-role.log" >&2; die "maintenance DB role setup failed"; }
bash "$(dirname "$0")/ensure-runtime-role.sh" >>"$LOG_DIR/ensure-runtime-role.log" 2>&1 || { cat "$LOG_DIR/ensure-runtime-role.log" >&2; die "runtime DB role grants failed"; }

compose --profile app up -d web >"$LOG_DIR/compose-web.log" 2>&1 || { cat "$LOG_DIR/compose-web.log" >&2; die "web container failed to start"; }
wait_http "http://127.0.0.1:${BEE_WEB_PORT}/api/runtime/health" 120 200 bee-local-web || { docker logs --tail 40 bee-local-web >&2; die "web container did not answer /api/runtime/health"; }
log "web container up on 127.0.0.1:${BEE_WEB_PORT}"
log "containerised runtime up in $(( $(now_ms) - T0 )) ms"
