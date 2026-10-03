-- WP05.1d: submit-time evidence fields and model uniqueness.
-- Provisional local defaults, not BEE rules (docs/wp05/WP05.1d_DECISIONS.md). The fields are optional on a draft
-- and become required at submit; Spring enforces the gates, the database backs the uniqueness rule.
ALTER TABLE model_application
  ADD COLUMN laboratory_code text REFERENCES organisation (code),
  ADD COLUMN tested_on date,
  ADD COLUMN declared_iseer numeric(4, 2) CHECK (declared_iseer > 0),
  -- The master versions the submit check resolved, kept for traceability. Written once, in the submit transaction.
  ADD COLUMN accreditation_rule_key text,
  ADD COLUMN accreditation_version integer,
  ADD COLUMN standard_rule_key text,
  ADD COLUMN standard_version integer;

-- One live application per brand and model number. A draft is not yet a claim on the number; a rejected
-- application releases it. Legacy rows without a brand link are outside the rule.
CREATE UNIQUE INDEX model_application_model_unique
  ON model_application (brand_id, upper(btrim(model_number)))
  WHERE brand_id IS NOT NULL AND state NOT IN ('draft', 'rejected');

COMMENT ON COLUMN model_application.declared_iseer IS 'WP05.1d: efficiency figure declared by the applicant; the rating step (WP05.2) recomputes and records its own.';
