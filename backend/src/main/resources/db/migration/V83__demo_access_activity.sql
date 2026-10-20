-- Demonstration: who signed in, from which address, and what they did (one row per sign-in or recorded action).
-- Written only through the demonstration API (/api/demo/activity), outside the contract-listed routes. Insert-only for the runtime role.
-- Person and organisation are copied into the row, so the trail still reads correctly if an account or organisation changes later.
-- Local demonstration, not BEE rules.
CREATE TABLE access_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  username text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL,
  organisation_id uuid,
  organisation_code text,
  organisation_name text,
  ip text NOT NULL CHECK (char_length(ip) <= 64),
  kind text NOT NULL CHECK (kind IN ('login', 'action')),
  action text NOT NULL CHECK (char_length(action) <= 200),
  target text CHECK (char_length(target) <= 200)
);
CREATE INDEX access_activity_at_idx ON access_activity (at DESC);
CREATE INDEX access_activity_org_idx ON access_activity (organisation_id, at DESC);
COMMENT ON TABLE access_activity IS 'Demonstration: sign-ins and recorded actions with the address they came from.';

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.access_activity TO bee_local_maint', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.access_activity TO bee_runtime', home_schema);
  END IF;
END $$;
