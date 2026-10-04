#!/usr/bin/env bash
# Idempotent: restricted Spring runtime DB login (WP05.1c review of 0bc2cea).
source "$(dirname "$0")/lib.sh"
: "${BEE_RUNTIME_DB_USER:=bee_runtime}"
: "${BEE_RUNTIME_DB_PASSWORD:=bee-local-runtime}"
export BEE_RUNTIME_DB_USER BEE_RUNTIME_DB_PASSWORD

require_docker
container_running bee-local-postgres || die "postgres is not running"

psql_super -d postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${BEE_RUNTIME_DB_USER}') THEN
    CREATE ROLE ${BEE_RUNTIME_DB_USER} LOGIN PASSWORD '${BEE_RUNTIME_DB_PASSWORD}';
  END IF;
END \$\$;
ALTER ROLE ${BEE_RUNTIME_DB_USER} SET search_path = app;
GRANT CONNECT ON DATABASE bee_app TO ${BEE_RUNTIME_DB_USER};
SQL

if psql_super -d bee_app -c "SELECT to_regclass('app.model_application') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT USAGE ON SCHEMA app TO ${BEE_RUNTIME_DB_USER};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO ${BEE_RUNTIME_DB_USER};
REVOKE DELETE, UPDATE, TRUNCATE ON app.model_application_submission_event FROM ${BEE_RUNTIME_DB_USER};
REVOKE DELETE, UPDATE, TRUNCATE ON app.model_application_fee_snapshot FROM ${BEE_RUNTIME_DB_USER};
GRANT INSERT, SELECT ON app.model_application_submission_event TO ${BEE_RUNTIME_DB_USER};
GRANT INSERT, SELECT ON app.model_application_fee_snapshot TO ${BEE_RUNTIME_DB_USER};
REVOKE INSERT, DELETE, UPDATE ON app.local_disposable_application FROM ${BEE_RUNTIME_DB_USER};
GRANT SELECT ON app.local_disposable_application TO ${BEE_RUNTIME_DB_USER};
REVOKE ALL ON FUNCTION app.app_disposable_model_cleanup(uuid[]) FROM ${BEE_RUNTIME_DB_USER};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO ${BEE_RUNTIME_DB_USER};
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM ${BEE_RUNTIME_DB_USER};
REVOKE CREATE ON SCHEMA app FROM ${BEE_RUNTIME_DB_USER};
REVOKE EXECUTE ON FUNCTION app.master_supersede(text, text, integer, date, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.master_supersede(text, text, integer, date, text, text, text, jsonb) TO bee_app;
SQL
fi

if psql_super -d bee_app -c "SELECT to_regclass('app.model_application_document') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
REVOKE DELETE, UPDATE, TRUNCATE ON app.model_application_document FROM ${BEE_RUNTIME_DB_USER};
REVOKE DELETE, UPDATE, TRUNCATE ON app.model_application_document_version FROM ${BEE_RUNTIME_DB_USER};
GRANT INSERT, SELECT ON app.model_application_document TO ${BEE_RUNTIME_DB_USER};
GRANT INSERT, SELECT ON app.model_application_document_version TO ${BEE_RUNTIME_DB_USER};
SQL
fi
