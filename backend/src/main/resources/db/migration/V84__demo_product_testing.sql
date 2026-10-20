-- Demonstration: random testing of products by BEE, chosen from compliance risk and customer grievances.
-- (1) grievances received from several sources, (2) test cases that BEE buys and tests at its own cost, with their stage history,
-- (3) the record of each risk-weighted random draw. Written only through the demonstration API (/api/demo/product-testing).
-- No foreign keys to the application tables (a disposable organisation or certificate can be removed without touching these rows).
-- Local demonstration, not BEE rules.
CREATE TABLE grievance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  source text NOT NULL CHECK (source IN ('qr_scan', 'helpline', 'email', 'consumer_portal', 'forum')),
  category text NOT NULL CHECK (category IN ('cooling', 'power', 'label', 'noise', 'counterfeit', 'other')),
  registration_id text NOT NULL,
  model_number text NOT NULL,
  brand_name text NOT NULL,
  organisation_id uuid NOT NULL,
  summary text NOT NULL CHECK (char_length(summary) <= 500),
  complainant_name text,
  complainant_contact text,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed'))
);
CREATE INDEX grievance_model_idx ON grievance (registration_id, received_at DESC);
COMMENT ON TABLE grievance IS 'Demonstration: a complaint from an end customer about a certified product, from one of several channels.';

CREATE TABLE test_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  registration_id text NOT NULL,
  model_number text NOT NULL,
  brand_name text NOT NULL,
  organisation_id uuid NOT NULL,
  basis text NOT NULL CHECK (basis IN ('risk', 'random', 'manual')),
  reason text NOT NULL CHECK (char_length(reason) <= 300),
  risk_score integer,
  stage text NOT NULL DEFAULT 'selected' CHECK (stage IN ('selected', 'procured', 'at_lab', 'result_in', 'closed')),
  procured_from text,
  laboratory text,
  result text CHECK (result IN ('pass', 'fail', 'retest')),
  measured_iseer numeric(4, 2) CHECK (measured_iseer > 0),
  rated_iseer numeric(4, 2),
  tested_on date,
  recommendation text CHECK (recommendation IN ('none', 'review', 'hold')),
  selected_by uuid NOT NULL,
  selected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  draw_id uuid
);
COMMENT ON TABLE test_case IS 'Demonstration: one product bought by BEE from the market and tested at BEE cost, with its stage.';

CREATE TABLE test_case_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  stage text NOT NULL,
  note text CHECK (char_length(note) <= 500),
  by_user uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX test_case_event_idx ON test_case_event (case_id, at);

CREATE TABLE selection_draw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  by_user uuid NOT NULL,
  seed bigint NOT NULL,
  size integer NOT NULL,
  picks text NOT NULL
);
COMMENT ON TABLE selection_draw IS 'Demonstration: a risk-weighted random draw (seed, size and the registration IDs drawn with their weights), kept so it can be explained later.';

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.grievance, %I.test_case, %I.test_case_event, %I.selection_draw TO bee_local_maint', home_schema, home_schema, home_schema, home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I.grievance, %I.test_case TO bee_runtime', home_schema, home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.test_case_event, %I.selection_draw TO bee_runtime', home_schema, home_schema);
  END IF;
END $$;
