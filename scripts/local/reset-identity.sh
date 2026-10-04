#!/usr/bin/env bash
# npm run local:reset:identity — re-import the Keycloak realm from local/keycloak/import.
# Touches only the keycloak database; Spring's bee_app data is unchanged.
source "$(dirname "$0")/lib.sh"

require_docker
container_running bee-local-postgres || die "postgres is not running (npm run local:up)"
compose stop keycloak >/dev/null 2>&1 || true
compose run --rm --no-deps keycloak import --dir /opt/keycloak/data/import --override true >"$LOG_DIR/keycloak-import.log" 2>&1 \
  || { tail -30 "$LOG_DIR/keycloak-import.log" >&2; die "realm import failed"; }
compose up -d keycloak >/dev/null 2>&1
wait_http "${KC_ISSUER}/.well-known/openid-configuration" 240 200 bee-local-keycloak || die "keycloak realm not available after import"
log "realm ${BEE_REALM} re-imported"
