-- Demo slice S4: the margin (percent) by which declared units may exceed bound QR serials before reconciliation flags a model for review.
-- A flag only; nothing is decided automatically. Local demonstration value, not a BEE rule.
CREATE TABLE production_setting (
  key    text PRIMARY KEY CHECK (key ~ '^[a-z_]{3,60}$'),
  value  numeric(10, 2) NOT NULL CHECK (value >= 0)
);
INSERT INTO production_setting (key, value) VALUES ('reconciliation_margin_percent', 10) ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.production_setting TO bee_local_maint', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.production_setting TO bee_runtime', home_schema);
  END IF;
END $$;
