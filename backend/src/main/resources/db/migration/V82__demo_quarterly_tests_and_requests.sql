-- Demonstration: (1) the result of BEE's test of a product for a quarter, and (2) manufacturer service requests (renewal, withdrawal, helpdesk).
-- Written only through the demonstration API (/api/demo/quarterly-test and /api/demo/service-requests), outside the contract-listed routes.
-- No foreign keys to the application tables (a disposable test application or organisation can be removed without touching these rows).
-- Local demonstration, not BEE rules.
CREATE TABLE quarterly_test_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  quarter text NOT NULL CHECK (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  registration_id text NOT NULL,
  model_number text NOT NULL,
  result text NOT NULL CHECK (result IN ('pass', 'fail', 'retest')),
  measured_iseer numeric(4, 2) CHECK (measured_iseer > 0),
  tested_on date NOT NULL,
  laboratory_code text,
  remarks text CHECK (char_length(remarks) <= 500),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, quarter, registration_id)
);
COMMENT ON TABLE quarterly_test_result IS 'Demonstration: BEE test result for one product in one quarter (a new record for the same product and quarter replaces the earlier one).';

CREATE TABLE service_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('renewal', 'withdrawal', 'helpdesk')),
  organisation_id uuid NOT NULL,
  subject_ref text,
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 3 AND 160),
  message text CHECK (char_length(message) <= 1000),
  category text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'acknowledged', 'resolved', 'declined')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  response_note text CHECK (char_length(response_note) <= 500),
  responded_by uuid,
  responded_at timestamptz
);
COMMENT ON TABLE service_request IS 'Demonstration: a manufacturer request for a renewal, a withdrawal or help, answered by BEE staff.';

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.quarterly_test_result, %I.service_request TO bee_local_maint', home_schema, home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I.quarterly_test_result, %I.service_request TO bee_runtime', home_schema, home_schema);
  END IF;
END $$;
