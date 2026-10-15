-- Demonstration slice S1: daily receipt counter (SIMRCPT-yyyymmdd-nnnn) and the runtime login's grants. Local demonstration only.
CREATE TABLE payment_receipt_counter (
  receipt_day date PRIMARY KEY,
  last_value  integer NOT NULL CHECK (last_value >= 1)
);

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.payment TO bee_runtime', home_schema);
    EXECUTE format('GRANT UPDATE (status, receipt_number, settled_at) ON %I.payment TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.payment_callback TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.payment_event TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I.payment_receipt_counter TO bee_runtime', home_schema);
    EXECUTE format('REVOKE DELETE, TRUNCATE ON %I.payment, %I.payment_callback, %I.payment_event, %I.payment_receipt_counter FROM bee_runtime',
                   home_schema, home_schema, home_schema, home_schema);
  END IF;
END $$;
