-- Demonstration: the product details a model application carries beyond brand, model number and test evidence (air-conditioner type,
-- rated cooling capacity, rated power input, compressor, refrigerant, rated voltage, test report number).
-- Kept in its own table, written only through the demonstration API (/api/demo/model-technical), so the contract-listed model application
-- routes and records do not change. application_id deliberately has no foreign key: a disposable test application can be removed
-- without touching this table (a stray row is harmless). Local demonstration, not BEE rules.
CREATE TABLE model_technical_detail (
  application_id uuid PRIMARY KEY,
  ac_type text CHECK (ac_type IN ('split', 'window', 'cassette', 'portable')),
  cooling_capacity_w integer CHECK (cooling_capacity_w BETWEEN 500 AND 30000),
  power_input_w integer CHECK (power_input_w BETWEEN 100 AND 15000),
  compressor_type text CHECK (compressor_type IN ('fixed', 'inverter')),
  refrigerant text CHECK (refrigerant IN ('R32', 'R410A', 'R290', 'R22')),
  rated_voltage integer CHECK (rated_voltage BETWEEN 180 AND 260),
  test_report_number text CHECK (char_length(btrim(test_report_number)) BETWEEN 3 AND 60),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE model_technical_detail IS 'Demonstration: product details of a model application, written through /api/demo/model-technical.';

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_technical_detail TO bee_local_maint', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I.model_technical_detail TO bee_runtime', home_schema);
  END IF;
END $$;
