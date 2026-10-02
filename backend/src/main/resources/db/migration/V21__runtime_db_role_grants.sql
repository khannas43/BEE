-- WP05.1c: Spring runtime login (bee_runtime) — DML only; Flyway/migrations stay on bee_app (owner).

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('REVOKE DELETE, UPDATE, TRUNCATE ON %I.model_application_submission_event FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE DELETE, UPDATE, TRUNCATE ON %I.model_application_fee_snapshot FROM bee_runtime', home_schema);
    EXECUTE format('GRANT INSERT, SELECT ON %I.model_application_submission_event TO bee_runtime', home_schema);
    EXECUTE format('GRANT INSERT, SELECT ON %I.model_application_fee_snapshot TO bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, DELETE, UPDATE ON %I.local_disposable_application FROM bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.local_disposable_application TO bee_runtime', home_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.app_disposable_model_cleanup(uuid[]) FROM bee_runtime', home_schema);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM bee_runtime', home_schema);
  END IF;
END $$;
