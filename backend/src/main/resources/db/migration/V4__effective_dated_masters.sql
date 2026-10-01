-- WP04.1: effective-dated master data (docs/wp04/WP04.1_MASTERS.md).
--
-- Every master row is one immutable version of a rule key. Shared columns:
--   rule_key, version          one row per (rule_key, version)
--   effective_from/_to         calendar dates, half-open [from, to): a version applies ON its
--                              effective_from and NOT on its effective_to; NULL effective_to
--                              is open-ended. Periods of one rule key never overlap; a date in
--                              no period has no applicable rule.
--   source_reference           where the values came from (never empty)
--   verification_status        synthetic (made up locally) | provisional (cited, not confirmed
--                              by BEE) | verified (confirmed by BEE; no row is verified today)
-- No row may be updated or deleted; a change is a new version for a later period.
-- Internal to Spring: no browser route, API permission or administration write uses these.

CREATE FUNCTION master_reject_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  clash integer;
BEGIN
  -- serialise writers of one rule key so two concurrent inserts cannot both pass the check
  PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME), hashtext(NEW.rule_key));
  -- the same (rule_key, version) is left to the unique constraint, so ON CONFLICT DO NOTHING
  -- makes a repeat seed a no-op instead of an overlap with itself
  EXECUTE format('SELECT version FROM %I.%I WHERE rule_key = $1 AND version <> $4 AND daterange(effective_from, effective_to, ''[)'') && daterange($2, $3, ''[)'') LIMIT 1',
                 TG_TABLE_SCHEMA, TG_TABLE_NAME)
    INTO clash USING NEW.rule_key, NEW.effective_from, NEW.effective_to, NEW.version;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23P01',
      MESSAGE = format('%s %s v%s [%s, %s) overlaps v%s', TG_TABLE_NAME, NEW.rule_key, NEW.version, NEW.effective_from, coalesce(NEW.effective_to::text, 'open'), clash);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION master_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000',
    MESSAGE = format('%s versions are immutable (%s refused); add a new version for a later period', TG_TABLE_NAME, TG_OP);
END $$;

CREATE FUNCTION master_guard(t regclass) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER reject_overlap BEFORE INSERT ON %s FOR EACH ROW EXECUTE FUNCTION master_reject_overlap()', t);
  EXECUTE format('CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION master_reject_change()', t);
  EXECUTE format('CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION master_reject_change()', t);
END $$;

-- Shared columns, repeated per table so each master keeps typed payload columns.
CREATE TABLE master_category (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key             text NOT NULL CHECK (rule_key ~ '^[A-Z]{2,10}$'),
  version              integer NOT NULL CHECK (version > 0),
  effective_from       date NOT NULL,
  effective_to         date CHECK (effective_to > effective_from),
  source_reference     text NOT NULL CHECK (length(trim(source_reference)) > 0),
  verification_status  text NOT NULL CHECK (verification_status IN ('synthetic', 'provisional', 'verified')),
  note                 text NOT NULL,
  legacy_id            text,
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  name                 text NOT NULL,
  UNIQUE (rule_key, version)
);

CREATE TABLE master_standard (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key             text NOT NULL,
  version              integer NOT NULL CHECK (version > 0),
  effective_from       date NOT NULL,
  effective_to         date CHECK (effective_to > effective_from),
  source_reference     text NOT NULL CHECK (length(trim(source_reference)) > 0),
  verification_status  text NOT NULL CHECK (verification_status IN ('synthetic', 'provisional', 'verified')),
  note                 text NOT NULL,
  legacy_id            text,
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  category_code        text NOT NULL CHECK (category_code ~ '^[A-Z]{2,10}$'),
  purpose              text NOT NULL CHECK (purpose ~ '^[a-z_]{2,40}$'),
  standard_code        text NOT NULL,
  title                text NOT NULL,
  edition              text NOT NULL,
  CHECK (rule_key = category_code || ':' || purpose),
  UNIQUE (rule_key, version)
);

CREATE TABLE master_lab_accreditation (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key             text NOT NULL,
  version              integer NOT NULL CHECK (version > 0),
  effective_from       date NOT NULL,
  effective_to         date CHECK (effective_to > effective_from),
  source_reference     text NOT NULL CHECK (length(trim(source_reference)) > 0),
  verification_status  text NOT NULL CHECK (verification_status IN ('synthetic', 'provisional', 'verified')),
  note                 text NOT NULL,
  legacy_id            text,
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  laboratory_code      text NOT NULL REFERENCES organisation (code),
  category_code        text NOT NULL CHECK (category_code ~ '^[A-Z]{2,10}$'),
  accreditation_body   text NOT NULL,
  certificate_ref      text NOT NULL,
  accreditation_status text NOT NULL CHECK (accreditation_status IN ('active', 'suspended', 'withdrawn')),
  CHECK (rule_key = laboratory_code || ':' || category_code),
  UNIQUE (rule_key, version)
);

CREATE TABLE master_fee_rule (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key             text NOT NULL,
  version              integer NOT NULL CHECK (version > 0),
  effective_from       date NOT NULL,
  effective_to         date CHECK (effective_to > effective_from),
  source_reference     text NOT NULL CHECK (length(trim(source_reference)) > 0),
  verification_status  text NOT NULL CHECK (verification_status IN ('synthetic', 'provisional', 'verified')),
  note                 text NOT NULL,
  legacy_id            text,
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  category_code        text NOT NULL CHECK (category_code ~ '^[A-Z]{2,10}$'),
  application_type     text NOT NULL CHECK (application_type ~ '^[a-z_]{2,40}$'),
  amount_inr           numeric(12,2) NOT NULL CHECK (amount_inr >= 0),
  CHECK (rule_key = category_code || ':' || application_type),
  UNIQUE (rule_key, version)
);

-- Metadata only. computation_allowed can be true only for a BEE-verified version, and no
-- code computes a rating (WP05.2 owns the computation once a formula is verified).
CREATE TABLE master_rating_formula (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key             text NOT NULL,
  version              integer NOT NULL CHECK (version > 0),
  effective_from       date NOT NULL,
  effective_to         date CHECK (effective_to > effective_from),
  source_reference     text NOT NULL CHECK (length(trim(source_reference)) > 0),
  verification_status  text NOT NULL CHECK (verification_status IN ('synthetic', 'provisional', 'verified')),
  note                 text NOT NULL,
  legacy_id            text,
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  category_code        text NOT NULL CHECK (category_code ~ '^[A-Z]{2,10}$'),
  formula_label        text NOT NULL,
  inputs               jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'array'),
  definition           jsonb NOT NULL,
  computation_allowed  boolean NOT NULL DEFAULT false CHECK (NOT computation_allowed OR verification_status = 'verified'),
  CHECK (rule_key = category_code || ':star_rating'),
  UNIQUE (rule_key, version)
);

SELECT master_guard('master_category');
SELECT master_guard('master_standard');
SELECT master_guard('master_lab_accreditation');
SELECT master_guard('master_fee_rule');
SELECT master_guard('master_rating_formula');
DROP FUNCTION master_guard(regclass);

-- Preserve the V2 provisional rows as version 1 of their rule keys, exactly as recorded,
-- then retire the V2 tables. Neither row was ever BEE-approved: both become 'synthetic'.
-- The period of the V2 fee (no dates were recorded) is the synthetic local window
-- [2026-01-01, 2026-10-01); see WP04.1_MASTERS.md §4 for the ₹1,000 / ₹24,000 reconciliation.
INSERT INTO master_fee_rule (rule_key, version, effective_from, effective_to, source_reference, verification_status, note, legacy_id,
                             category_code, application_type, amount_inr)
SELECT category || ':new_model', row_number() OVER (PARTITION BY category ORDER BY id), DATE '2026-01-01', DATE '2026-10-01',
       'V2 local seed fee_rule ' || id || ' (local placeholder; no source)', 'synthetic', note, id,
       category, 'new_model', amount_inr
FROM fee_rule;

INSERT INTO master_rating_formula (rule_key, version, effective_from, effective_to, source_reference, verification_status, note, legacy_id,
                                   category_code, formula_label, inputs, definition)
SELECT category || ':star_rating', row_number() OVER (PARTITION BY category ORDER BY id), DATE '2026-01-01', NULL,
       'V2 local seed rating_formula ' || id || ' (FIRST_SLICE.md D3 placeholder)', 'synthetic', note, id,
       category, version, '[]'::jsonb, definition
FROM rating_formula;

DROP TABLE fee_rule;
DROP TABLE rating_formula;

CREATE INDEX master_category_resolve ON master_category (rule_key, effective_from);
CREATE INDEX master_standard_resolve ON master_standard (rule_key, effective_from);
CREATE INDEX master_lab_accreditation_resolve ON master_lab_accreditation (rule_key, effective_from);
CREATE INDEX master_fee_rule_resolve ON master_fee_rule (rule_key, effective_from);
CREATE INDEX master_rating_formula_resolve ON master_rating_formula (rule_key, effective_from);
