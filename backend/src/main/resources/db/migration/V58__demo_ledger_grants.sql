-- DEMO S3: the runtime login reads the simulated ledger and writes only through the functions.
DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.ledger_tx, %I.ledger_event TO bee_runtime', home_schema, home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I.ledger_tx, %I.ledger_event FROM bee_runtime', home_schema, home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.ledger_compute_hash(text, text, text, text, text, text, integer, numeric, date, date, text, integer) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.ledger_effective_valid_to(uuid) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.ledger_submit(uuid, uuid) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.ledger_decide(uuid, uuid, uuid[], text, text) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.ledger_retry(uuid, uuid) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.ledger_change(uuid, uuid, text, date, text) TO bee_runtime', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT ON %I.ledger_tx, %I.ledger_event TO bee_local_maint', home_schema, home_schema);
  END IF;
END $$;
