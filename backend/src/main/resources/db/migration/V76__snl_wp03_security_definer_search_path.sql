-- SNL WP03: pin search_path on WP3 SECURITY DEFINER functions only (schema, pg_catalog, pg_temp; pg_temp last).
DO $$
DECLARE home_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_trusted_create(uuid, uuid, text, integer, jsonb) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_trusted_patch_draft(uuid, uuid, uuid, integer, text, jsonb) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_trusted_append_document(uuid, uuid, uuid, text, char(64), bigint, text, text, date, date) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_run_automated_checks(uuid) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_orchestrate_submit(uuid, uuid, text, integer, numeric, text, integer, text, text, text, uuid, char(64)) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_orchestrate_director_decision(uuid, uuid, integer, text, text, uuid, char(64)) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_orchestrate_raise_anomaly(uuid, uuid, text, integer, text, uuid, char(64)) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_orchestrate_resolve_anomaly(uuid, uuid, integer, text, text, uuid, char(64)) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_orchestrate_observation_close(uuid, uuid, text, integer, uuid, char(64)) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_maint_observation_close_as_of(uuid, date) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_maint_close_expired_observations(date) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
END $$;
