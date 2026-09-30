-- Provisional, synthetic rule metadata for the local first slice (ADR-001).
-- These records must never be presented as BEE-approved fees or star ratings.
CREATE TABLE fee_rule (
  id text PRIMARY KEY,
  category text NOT NULL,
  version text NOT NULL,
  amount_inr numeric(12,2) NOT NULL CHECK (amount_inr >= 0),
  status text NOT NULL CHECK (status IN ('unverified', 'approved')),
  note text NOT NULL,
  UNIQUE (category, version)
);

CREATE TABLE rating_formula (
  id text PRIMARY KEY,
  category text NOT NULL,
  version text NOT NULL,
  status text NOT NULL CHECK (status IN ('unverified', 'approved')),
  definition jsonb NOT NULL,
  note text NOT NULL,
  UNIQUE (category, version)
);

-- The seed is idempotent, including its run marker.
DELETE FROM seed_run a USING seed_run b
WHERE a.seed_version = b.seed_version AND a.id > b.id;
ALTER TABLE seed_run ADD CONSTRAINT seed_run_version_unique UNIQUE (seed_version);
