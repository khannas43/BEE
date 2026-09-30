#!/usr/bin/env bash
# npm run local:reset — targeted app-data reset (ADR-001 D-RT5).
# Drops and recreates only schema "app" in database bee_app, as the bee_app login,
# then lets Flyway rebuild it and reloads the seed. It never touches the keycloak
# database, the project volume, the Homebrew PostgreSQL or any other container.
source "$(dirname "$0")/lib.sh"

refuse() { printf 'REFUSED: %s\n' "$*" >&2; exit 2; }

# ---- guards (all must pass before anything is changed)
[[ "$BEE_APP_DB" == "bee_app" ]] || refuse "target database is '$BEE_APP_DB'; only bee_app may be reset"
[[ "$BEE_APP_DB_USER" == "bee_app" ]] || refuse "reset must run as the bee_app login, not '$BEE_APP_DB_USER'"
container_running bee-local-postgres || refuse "project container bee-local-postgres is not running"
[[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' bee-local-postgres)" == "$BEE_COMPOSE_PROJECT" ]] \
  || refuse "bee-local-postgres does not belong to compose project $BEE_COMPOSE_PROJECT"
published="$(docker port bee-local-postgres 5432/tcp 2>/dev/null || true)"
[[ "$published" == "127.0.0.1:${BEE_PG_PORT}" ]] || refuse "BEE_PG_PORT=${BEE_PG_PORT} is not the project container's port (${published:-none})"
[[ "$(psql_app -c 'SELECT current_database()')" == "bee_app" ]] || refuse "connected database is not bee_app"
[[ "$(psql_app -c "SELECT has_database_privilege('bee_app', 'keycloak', 'CONNECT')")" == "f" ]] \
  || refuse "bee_app can connect to the keycloak database; isolation is broken"

kc_fingerprint() { psql_super -d keycloak -c "SELECT (SELECT count(*) FROM realm) || '/' || (SELECT count(*) FROM user_entity) || '/' || (SELECT count(*) FROM credential)"; }
before="$(kc_fingerprint)"
T0=$(now_ms)

api_was_running=0; pid_alive "$API_PID" && api_was_running=1
stop_api
psql_app -c "SET client_min_messages = warning; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA app AUTHORIZATION bee_app;"
log "schema app in bee_app dropped and recreated"
start_api
bash "$ROOT/scripts/local/seed.sh"
(( api_was_running == 1 )) || stop_api

after="$(kc_fingerprint)"
[[ "$before" == "$after" ]] || die "keycloak database changed during reset ($before -> $after)"
log "keycloak database unchanged (realms/users/credentials $after)"
log "targeted app-data reset done in $(( $(now_ms) - T0 )) ms"
