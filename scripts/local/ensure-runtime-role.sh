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

if psql_super -d bee_app -c "SELECT to_regclass('app.certificate') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT EXECUTE ON FUNCTION app.issue_certificate(uuid, uuid, uuid) TO ${BEE_RUNTIME_DB_USER};
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON app.certificate, app.certificate_allocator FROM ${BEE_RUNTIME_DB_USER};
SQL
fi

if psql_super -d bee_app -c "SELECT to_regclass('app.notification') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT EXECUTE ON FUNCTION app.notification_mark_read(uuid, uuid), app.notification_mark_all_read(uuid) TO ${BEE_RUNTIME_DB_USER};
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON app.notification FROM ${BEE_RUNTIME_DB_USER};
SQL
fi

if psql_super -d bee_app -c "SELECT to_regclass('app.fee_reversal_proposal') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT EXECUTE ON FUNCTION app.fee_reversal_decide(uuid, uuid, text, text), app.fee_reversal_possible(uuid, uuid) TO ${BEE_RUNTIME_DB_USER};
REVOKE UPDATE, DELETE, TRUNCATE ON app.fee_reversal_proposal FROM ${BEE_RUNTIME_DB_USER};
SQL
fi

if psql_super -d bee_app -c "SELECT to_regclass('app.fee_correction_proposal') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT EXECUTE ON FUNCTION app.fee_correction_decide(uuid, uuid, text, text) TO ${BEE_RUNTIME_DB_USER};
GRANT EXECUTE ON FUNCTION app.fee_correction_segregated(uuid, uuid) TO ${BEE_RUNTIME_DB_USER};
REVOKE UPDATE, DELETE, TRUNCATE ON app.fee_correction_proposal FROM ${BEE_RUNTIME_DB_USER};
SQL
fi

if psql_super -d bee_app -c "SELECT to_regclass('app.rating_scheme_proposal') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT EXECUTE ON FUNCTION app.rating_scheme_decide(uuid, uuid, text, text) TO ${BEE_RUNTIME_DB_USER};
REVOKE UPDATE, DELETE, TRUNCATE ON app.rating_scheme_proposal FROM ${BEE_RUNTIME_DB_USER};
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON app.master_category, app.master_standard, app.master_lab_accreditation, app.master_fee_rule, app.master_rating_formula, app.master_closure, app.rating_demo_band FROM ${BEE_RUNTIME_DB_USER};
SQL
fi

if psql_super -d bee_app -c "SELECT to_regclass('app.business_setting_proposal') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT SELECT ON app.business_setting_def, app.business_setting_version TO ${BEE_RUNTIME_DB_USER};
GRANT EXECUTE ON FUNCTION app.business_setting_decide(uuid, uuid, text, text), app.business_setting_value(text, date) TO ${BEE_RUNTIME_DB_USER};
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON app.business_setting_def, app.business_setting_version FROM ${BEE_RUNTIME_DB_USER};
REVOKE UPDATE, DELETE, TRUNCATE ON app.business_setting_proposal FROM ${BEE_RUNTIME_DB_USER};
SQL
fi

if psql_super -d bee_app -c "SELECT to_regclass('app.fee_rule_proposal') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT EXECUTE ON FUNCTION app.fee_rule_decide(uuid, uuid, text, text) TO ${BEE_RUNTIME_DB_USER};
REVOKE UPDATE, DELETE, TRUNCATE ON app.fee_rule_proposal FROM ${BEE_RUNTIME_DB_USER};
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON app.capability_grant, app.fee_application_type FROM ${BEE_RUNTIME_DB_USER};
SQL
fi

if psql_super -d bee_app -c "SELECT to_regproc('app.registration_approve') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT EXECUTE ON FUNCTION app.registration_approve(uuid, uuid, integer, text) TO ${BEE_RUNTIME_DB_USER};
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON app.brand, app.agency_authorisation FROM ${BEE_RUNTIME_DB_USER};
SQL
fi

if psql_super -d bee_app -c "SELECT to_regclass('app.register_revocation_proposal') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT EXECUTE ON FUNCTION app.register_revocation_decide(uuid, uuid, text, text) TO ${BEE_RUNTIME_DB_USER};
REVOKE UPDATE, DELETE, TRUNCATE ON app.register_revocation_proposal FROM ${BEE_RUNTIME_DB_USER};
SQL
fi

if psql_super -d bee_app -c "SELECT to_regclass('app.delegation') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT EXECUTE ON FUNCTION app.delegation_decide(uuid, uuid, text, text) TO ${BEE_RUNTIME_DB_USER};
REVOKE UPDATE, DELETE, TRUNCATE ON app.delegation, app.delegation_event, app.delegation_use FROM ${BEE_RUNTIME_DB_USER};
REVOKE INSERT ON app.delegation_event FROM ${BEE_RUNTIME_DB_USER};
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

# ---- Demonstration slices (docs/demo/DEMO_WORK_PLAN.md): the blanket grants above are re-applied on every start, so each slice's function
# execute rights and append-only tables are restated here, as its migration set them.
if psql_super -d bee_app -c "SELECT to_regclass('app.ledger_tx') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT EXECUTE ON FUNCTION app.ledger_effective_valid_to(uuid), app.ledger_submit(uuid, uuid), app.ledger_decide(uuid, uuid, uuid[], text, text),
  app.ledger_retry(uuid, uuid), app.ledger_change(uuid, uuid, text, date, text) TO ${BEE_RUNTIME_DB_USER};
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON app.ledger_tx, app.ledger_event FROM ${BEE_RUNTIME_DB_USER};
SQL
fi
if psql_super -d bee_app -c "SELECT to_regclass('app.payment_event') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
REVOKE UPDATE, DELETE, TRUNCATE ON app.payment_event, app.payment_callback FROM ${BEE_RUNTIME_DB_USER};
REVOKE DELETE, TRUNCATE ON app.payment FROM ${BEE_RUNTIME_DB_USER};
SQL
fi
if psql_super -d bee_app -c "SELECT to_regclass('app.qr_event') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
REVOKE UPDATE, DELETE, TRUNCATE ON app.qr_event FROM ${BEE_RUNTIME_DB_USER};
REVOKE DELETE, TRUNCATE ON app.qr_batch, app.qr_serial FROM ${BEE_RUNTIME_DB_USER};
SQL
fi
if psql_super -d bee_app -c "SELECT to_regclass('app.production_event') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
REVOKE UPDATE, DELETE, TRUNCATE ON app.production_event, app.production_evidence FROM ${BEE_RUNTIME_DB_USER};
REVOKE UPDATE, DELETE, TRUNCATE ON app.production_row FROM ${BEE_RUNTIME_DB_USER};
REVOKE DELETE, TRUNCATE ON app.production_submission FROM ${BEE_RUNTIME_DB_USER};
SQL
fi
if psql_super -d bee_app -c "SELECT to_regclass('app.demo_message') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT EXECUTE ON FUNCTION app.demo_message_mark_read(uuid, uuid), app.demo_message_mark_all_read(uuid) TO ${BEE_RUNTIME_DB_USER};
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON app.demo_message FROM ${BEE_RUNTIME_DB_USER};
SQL
fi
if psql_super -d bee_app -c "SELECT to_regprocedure('app.production_replace_rows(uuid, uuid)') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT EXECUTE ON FUNCTION app.production_replace_rows(uuid, uuid) TO ${BEE_RUNTIME_DB_USER};
SQL
fi
if psql_super -d bee_app -c "SELECT to_regclass('app.ai_run') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
REVOKE UPDATE, DELETE, TRUNCATE ON app.ai_model, app.ai_run, app.ai_disposition, app.ai_audit_event FROM ${BEE_RUNTIME_DB_USER};
SQL
fi

# WP3 optimized manufacturer onboarding (V75): orchestrators only; observation close stays maint-only.
if psql_super -d bee_app -c "SELECT to_regclass('app.manufacturer_onboarding_application') IS NOT NULL" | grep -q t; then
  psql_super -d bee_app <<SQL
GRANT SELECT ON app.manufacturer_onboarding_application TO ${BEE_RUNTIME_DB_USER};
REVOKE INSERT, UPDATE, DELETE ON app.manufacturer_onboarding_application FROM ${BEE_RUNTIME_DB_USER};
GRANT EXECUTE ON FUNCTION app.manufacturer_onboarding_trusted_create(uuid, uuid, text, integer, jsonb),
  app.manufacturer_onboarding_trusted_patch_draft(uuid, uuid, uuid, integer, text, jsonb),
  app.manufacturer_onboarding_trusted_append_document(uuid, uuid, uuid, text, char, bigint, text, text, date, date),
  app.manufacturer_onboarding_orchestrate_submit(uuid, uuid, text, integer, numeric, text, integer, text, text, text, uuid, char),
  app.manufacturer_onboarding_orchestrate_director_decision(uuid, uuid, integer, text, text, uuid, char),
  app.manufacturer_onboarding_orchestrate_raise_anomaly(uuid, uuid, text, integer, text, uuid, char),
  app.manufacturer_onboarding_orchestrate_resolve_anomaly(uuid, uuid, integer, text, text, uuid, char)
  TO ${BEE_RUNTIME_DB_USER};
REVOKE EXECUTE ON FUNCTION app.manufacturer_onboarding_orchestrate_observation_close(uuid, uuid, text, integer, uuid, char) FROM ${BEE_RUNTIME_DB_USER};
REVOKE SELECT, UPDATE ON app.manufacturer_onboarding_allocator FROM ${BEE_RUNTIME_DB_USER};
REVOKE INSERT ON app.manufacturer_onboarding_event FROM ${BEE_RUNTIME_DB_USER};
GRANT SELECT ON app.manufacturer_onboarding_event TO ${BEE_RUNTIME_DB_USER};
GRANT SELECT ON app.manufacturer_onboarding_anomaly, app.manufacturer_onboarding_director_decision,
  app.manufacturer_onboarding_observation, app.manufacturer_onboarding_permittee_activation TO ${BEE_RUNTIME_DB_USER};
GRANT SELECT ON app.manufacturer_onboarding_payment_link TO ${BEE_RUNTIME_DB_USER};
REVOKE INSERT, UPDATE, DELETE ON app.manufacturer_onboarding_document, app.manufacturer_onboarding_document_version FROM ${BEE_RUNTIME_DB_USER};
GRANT SELECT ON app.manufacturer_onboarding_document, app.manufacturer_onboarding_document_version TO ${BEE_RUNTIME_DB_USER};
REVOKE INSERT, UPDATE, DELETE ON app.manufacturer_onboarding_command_evidence, app.manufacturer_onboarding_automated_check,
  app.manufacturer_onboarding_director_decision, app.manufacturer_onboarding_permittee_activation,
  app.manufacturer_onboarding_observation, app.manufacturer_onboarding_anomaly, app.manufacturer_onboarding_fee_snapshot,
  app.manufacturer_onboarding_payment_link FROM ${BEE_RUNTIME_DB_USER};
GRANT SELECT ON app.manufacturer_onboarding_command_evidence, app.manufacturer_onboarding_automated_check,
  app.manufacturer_onboarding_fee_snapshot TO ${BEE_RUNTIME_DB_USER};
SQL
fi
