#!/usr/bin/env bash
# Idempotent: local maintenance DB role for disposable test cleanup (WP05.1c re-review).
source "$(dirname "$0")/lib.sh"
: "${BEE_MAINT_DB_USER:=bee_local_maint}"
: "${BEE_MAINT_DB_PASSWORD:=bee-local-maint}"
export BEE_MAINT_DB_USER BEE_MAINT_DB_PASSWORD

require_docker
container_running bee-local-postgres || die "postgres is not running"

psql_super -d postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${BEE_MAINT_DB_USER}') THEN
    CREATE ROLE ${BEE_MAINT_DB_USER} LOGIN PASSWORD '${BEE_MAINT_DB_PASSWORD}';
  END IF;
END \$\$;
ALTER ROLE ${BEE_MAINT_DB_USER} SET search_path = app;
GRANT CONNECT ON DATABASE bee_app TO ${BEE_MAINT_DB_USER};
SQL

if psql_super -d bee_app -c "SELECT to_regclass('app.local_disposable_application') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT USAGE ON SCHEMA app TO ${BEE_MAINT_DB_USER};
GRANT SELECT, INSERT, DELETE ON app.local_disposable_application TO ${BEE_MAINT_DB_USER};
GRANT DELETE ON app.model_application_fee_snapshot, app.model_application_submission_event, app.model_application TO ${BEE_MAINT_DB_USER};
GRANT EXECUTE ON FUNCTION app.app_disposable_model_cleanup(uuid[]) TO ${BEE_MAINT_DB_USER};
REVOKE ALL ON FUNCTION app.app_disposable_model_cleanup(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.app_disposable_model_cleanup(uuid[]) FROM bee_app;
GRANT SELECT, REFERENCES ON app.local_disposable_application TO ${BEE_MAINT_DB_USER};
SQL
fi

if psql_super -d bee_app -c "SELECT to_regclass('app.fee_rule_proposal') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT SELECT, DELETE ON app.fee_rule_proposal TO ${BEE_MAINT_DB_USER};
GRANT SELECT, INSERT, DELETE ON app.capability_grant, app.fee_application_type TO ${BEE_MAINT_DB_USER};
SQL
fi

if psql_super -d bee_app -c "SELECT to_regclass('app.model_application_document') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT SELECT, DELETE ON app.model_application_document, app.model_application_document_version TO ${BEE_MAINT_DB_USER};
SQL
fi
