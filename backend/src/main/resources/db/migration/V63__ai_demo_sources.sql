-- Demo slice S6: source tables owned by the AI demonstration. All rows are synthetic (filled by local/seed/demo/s6_ai.sql); they supplement
-- live portal data where this local database is thin, and every run says so.

CREATE TABLE ai_kb (
  id        integer PRIMARY KEY,
  category  text NOT NULL CHECK (category IN ('registration', 'application', 'fees', 'certificate', 'qr', 'account', 'production')),
  title     text NOT NULL,
  body      text NOT NULL
);

CREATE TABLE ai_demo_entity (
  entity_key          text PRIMARY KEY,
  name                text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('manufacturer', 'model')),
  applications        integer NOT NULL CHECK (applications >= 0),
  returned            integer NOT NULL CHECK (returned >= 0),
  rejected            integer NOT NULL CHECK (rejected >= 0),
  resubmissions       integer NOT NULL CHECK (resubmissions >= 0),
  efficiency_gap_pct  numeric(5, 2) NOT NULL,
  fee_delay_days      numeric(5, 1) NOT NULL,
  production_ratio    numeric(6, 2)
);

CREATE TABLE ai_demo_production (
  id           integer PRIMARY KEY,
  series_key   text NOT NULL,
  organisation text NOT NULL,
  model_label  text NOT NULL,
  quarter      text NOT NULL CHECK (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  units        integer NOT NULL CHECK (units >= 0),
  serials_bound integer
);

CREATE TABLE ai_demo_rating (
  id        integer PRIMARY KEY,
  month     text NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  category  text NOT NULL,
  stars     smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  iseer     numeric(4, 2) NOT NULL
);

CREATE TABLE ai_demo_report_text (
  application_reference text PRIMARY KEY,
  report_text           text NOT NULL
);

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT SELECT ON %I.ai_kb, %I.ai_demo_entity, %I.ai_demo_production, %I.ai_demo_rating, %I.ai_demo_report_text TO bee_runtime',
      home_schema, home_schema, home_schema, home_schema, home_schema);
  END IF;
END $$;
