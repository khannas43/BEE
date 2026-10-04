-- WP05.1c re-review: V21 granted EXECUTE ON ALL FUNCTIONS to bee_runtime, undoing cleanup revoke.
-- Runtime JDBC uses table DML only; triggers run without EXECUTE grants on trigger functions.

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM bee_runtime', home_schema);
  END IF;
  EXECUTE format(
    'REVOKE EXECUTE ON FUNCTION %I.master_supersede(text, text, integer, date, text, text, text, jsonb) FROM PUBLIC',
    home_schema);
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION %I.master_supersede(text, text, integer, date, text, text, text, jsonb) TO bee_app',
    home_schema);
END $$;
