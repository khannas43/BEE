-- WP05.1c re-review: maintenance role privileges for disposable cleanup (local only).

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_local_maint', home_schema);
    EXECUTE format('GRANT ALL ON TABLE %I.local_disposable_application TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application_fee_snapshot TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application_submission_event TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application TO bee_local_maint', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.app_disposable_model_cleanup(uuid[]) TO bee_local_maint', home_schema);
  END IF;
END $$;
