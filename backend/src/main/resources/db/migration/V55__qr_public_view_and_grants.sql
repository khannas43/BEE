-- Demo slice S2: what the public verifier may learn from a serial (only that a BOUND serial belongs to a registration), and the runtime grants.
CREATE VIEW public_qr_serial WITH (security_barrier = true) AS
  SELECT s.serial, c.registration_id
    FROM qr_serial s JOIN certificate c ON c.id = s.certificate_id
   WHERE s.state = 'bound';

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.qr_batch TO bee_runtime', home_schema);
    EXECUTE format('GRANT UPDATE (status) ON %I.qr_batch TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.qr_serial TO bee_runtime', home_schema);
    EXECUTE format('GRANT UPDATE (state, bound_at, voided_at, void_reason) ON %I.qr_serial TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.qr_event TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.public_qr_serial TO bee_runtime', home_schema);
  END IF;
END $$;
