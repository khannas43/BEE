#!/usr/bin/env bash
# npm run local:seed — load synthetic identity, scope and provisional rule metadata. Idempotent.
source "$(dirname "$0")/lib.sh"

container_running bee-local-postgres || die "postgres is not running (npm run local:up)"
node "$ROOT/local/generate-fixtures.cjs" --check >/dev/null || die "local fixtures are stale: run node local/generate-fixtures.cjs"
[[ "$(psql_app -c "SELECT to_regclass('app.user_account') IS NOT NULL")" == "t" ]] || die "schema not migrated yet: start the API first (npm run local:up)"

psql_app < "$ROOT/local/seed/seed.sql"
counts="$(psql_app -F ' ' -c "SELECT (SELECT count(*) FROM app.organisation), (SELECT count(*) FROM app.user_account), (SELECT count(*) FROM app.organisation_membership), (SELECT count(*) FROM app.role_assignment), (SELECT count(*) FROM app.role_assignment WHERE active)")"
read -r orgs users members roles active <<<"$counts"
log "seed applied: organisations=$orgs user_accounts=$users memberships=$members role_assignments=$roles (active $active)"
