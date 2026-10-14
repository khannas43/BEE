-- WP08.1h (owner's direction, 13 October 2026): the business numbers BEE has not decided are configurable data, not constants in code.
-- Provisional local rules: every default below is the owner's assumption, not a BEE rule, and is shown as such.
--
-- A setting is a row in a small catalogue (business_setting_def) with a range. A change is a proposal that a DIFFERENT holder of the
-- business_setting_manage permission approves, never from a date in the past (the pattern of fee rules, V34, and rating schemes, V35).
-- The value in force on a day is the version with the latest start on or before that day, else the catalogue default. Versions are
-- immutable. Five settings are enforced: the maximum declared efficiency figure, the maximum age of a test report, the tolerance on
-- the amount received, the tolerance between the declared and the verified efficiency figure, and the certificate validity.

INSERT INTO capability_grant (capability, role) VALUES ('business_setting_manage', 'admin');

CREATE TABLE business_setting_def (
  setting_key    text PRIMARY KEY CHECK (setting_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  label          text NOT NULL,
  unit           text NOT NULL,
  description    text NOT NULL,
  warning        text,
  decimals       smallint NOT NULL CHECK (decimals IN (0, 2)),
  min_value      numeric(12,2) NOT NULL,
  max_value      numeric(12,2) NOT NULL,
  default_value  numeric(12,2) NOT NULL,
  sort_order     smallint NOT NULL,
  CHECK (min_value <= default_value AND default_value <= max_value)
);

INSERT INTO business_setting_def (setting_key, label, unit, description, warning, decimals, min_value, max_value, default_value, sort_order) VALUES
  ('declared_iseer_max', 'Highest efficiency figure an applicant may declare', 'ISEER', 'The upper limit of the efficiency figure on a model application (two decimals). Owner''s assumption: 99.99, because BEE has not stated the range.',
   'Drafts already saved with a higher figure cannot be submitted until the figure is corrected.', 2, 1.00, 99.99, 99.99, 1),
  ('test_report_max_age_days', 'Oldest test date accepted', 'days before submission', 'How many days before the day of submission the test may have been done. Owner''s assumption: 1095 days (three years), because BEE has not stated a maximum age.',
   'Drafts already saved with an older test date cannot be submitted until the date is corrected.', 0, 1, 3650, 1095, 2),
  ('payment_tolerance_amount', 'Difference allowed between the fee due and the amount received', 'rupees', 'Finance may confirm a receipt whose amount is within this many rupees of the fee due. 0.00 means the amount must match exactly. Owner''s assumption: exact, because BEE has not said.',
   'A confirmation is recorded with the amount actually received; the fee due is not changed.', 2, 0.00, 1000.00, 0.00, 3),
  ('iseer_verify_tolerance', 'Difference allowed between the declared and the verified efficiency figure', 'ISEER', 'The rating step is refused when the verified figure differs from the declared figure by more than this. 0.00 means they must be identical; 99.99 means any difference is accepted, as today. Owner''s assumption: any difference accepted, because BEE has not said.',
   NULL, 2, 0.00, 99.99, 99.99, 4),
  ('certificate_validity_years', 'Validity of a certificate', 'years', 'How long a certificate is valid from the day it is issued. Owner''s assumption: 3 years. Certificates already issued are never changed.',
   NULL, 0, 1, 10, 3, 5);

CREATE TABLE business_setting_version (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key     text NOT NULL REFERENCES business_setting_def (setting_key),
  effective_from  date NOT NULL,
  value           numeric(12,2) NOT NULL,
  source_reference text NOT NULL,
  reason          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (setting_key, effective_from)
);

CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON business_setting_version
  FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON business_setting_version
  FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON business_setting_def
  FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON business_setting_def
  FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change();

CREATE TABLE business_setting_proposal (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key       text NOT NULL REFERENCES business_setting_def (setting_key),
  effective_from    date NOT NULL,
  value             numeric(12,2) NOT NULL,
  source_reference  text NOT NULL CHECK (char_length(btrim(source_reference)) BETWEEN 1 AND 300),
  reason            text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  proposed_by       uuid NOT NULL REFERENCES user_account (id),
  proposed_at       timestamptz NOT NULL DEFAULT now(),
  state             text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by        uuid REFERENCES user_account (id),
  decided_at        timestamptz,
  decision_note     text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  applied_version   uuid REFERENCES business_setting_version (id),
  CHECK ((state = 'pending') = (decided_by IS NULL)),
  CHECK ((state = 'approved') = (applied_version IS NOT NULL))
);
CREATE INDEX business_setting_proposal_state ON business_setting_proposal (state, proposed_at);
CREATE TRIGGER proposal_born_pending BEFORE INSERT ON business_setting_proposal FOR EACH ROW EXECUTE FUNCTION proposal_born_pending();

-- The value in force for a setting on a day: the version with the latest start on or before it, else the catalogue default.
CREATE FUNCTION business_setting_value(p_key text, p_on date) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT coalesce(
    (SELECT v.value FROM business_setting_version v WHERE v.setting_key = p_key AND v.effective_from <= p_on ORDER BY v.effective_from DESC LIMIT 1),
    (SELECT d.default_value FROM business_setting_def d WHERE d.setting_key = p_key));
$$;

-- Decides one proposal; a refusal is a result (first column), never an error. Refusals: not_found, not_pending, not_permitted,
-- same_person, only_proposer, date_passed, rule_conflict (a version already starts that day, or the value is outside the range).
CREATE FUNCTION business_setting_decide(p_proposal uuid, p_decider uuid, p_decision text, p_note text)
RETURNS TABLE (out_state text, out_version uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  p      business_setting_proposal%ROWTYPE;
  d      business_setting_def%ROWTYPE;
  today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  holds  boolean;
  v_id   uuid;
BEGIN
  IF p_decision NOT IN ('approve', 'reject', 'withdraw') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'validation_failed';
  END IF;
  SELECT * INTO p FROM business_setting_proposal WHERE id = p_proposal FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p.state <> 'pending' THEN
    RETURN QUERY SELECT 'not_pending'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM role_assignment ra JOIN capability_grant g ON g.role = ra.role AND g.capability = 'business_setting_manage'
                  WHERE ra.user_id = p_decider AND ra.active) INTO holds;
  IF NOT holds THEN
    RETURN QUERY SELECT 'not_permitted'::text, NULL::uuid;
    RETURN;
  END IF;

  IF p_decision = 'withdraw' THEN
    IF p_decider <> p.proposed_by THEN
      RETURN QUERY SELECT 'only_proposer'::text, NULL::uuid;
      RETURN;
    END IF;
    UPDATE business_setting_proposal SET state = 'withdrawn', decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
    RETURN QUERY SELECT 'withdrawn'::text, NULL::uuid;
    RETURN;
  END IF;

  IF p_decider = p.proposed_by THEN
    RETURN QUERY SELECT 'same_person'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_decision = 'reject' THEN
    UPDATE business_setting_proposal SET state = 'rejected', decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
    RETURN QUERY SELECT 'rejected'::text, NULL::uuid;
    RETURN;
  END IF;

  IF p.effective_from < today THEN
    RETURN QUERY SELECT 'date_passed'::text, NULL::uuid;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(current_schema() || '.business_setting_version'), hashtext(p.setting_key));
  SELECT * INTO d FROM business_setting_def WHERE setting_key = p.setting_key;
  IF p.value < d.min_value OR p.value > d.max_value OR (d.decimals = 0 AND p.value <> trunc(p.value)) THEN
    RETURN QUERY SELECT 'rule_conflict'::text, NULL::uuid;
    RETURN;
  END IF;
  BEGIN
    INSERT INTO business_setting_version (setting_key, effective_from, value, source_reference, reason)
    VALUES (p.setting_key, p.effective_from, p.value, btrim(p.source_reference), btrim(p.reason)) RETURNING id INTO v_id;
  EXCEPTION WHEN SQLSTATE '23505' THEN
    v_id := NULL;
  END;
  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'rule_conflict'::text, NULL::uuid;
    RETURN;
  END IF;
  UPDATE business_setting_proposal SET state = 'approved', decided_by = p_decider, decided_at = now(), decision_note = p_note, applied_version = v_id WHERE id = p.id;
  RETURN QUERY SELECT 'approved'::text, v_id;
END $$;

REVOKE ALL ON FUNCTION business_setting_decide(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business_setting_value(text, date) FROM PUBLIC;

-- A certificate is valid for the number of years in force on the day it is issued (default 3: V37 had it fixed). Everything else in the
-- function is as in V37; certificates already issued are never changed.
CREATE OR REPLACE FUNCTION issue_certificate(p_application uuid, p_event uuid, p_actor uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  a      record;
  r      record;
  today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  yr     integer := extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata'))::integer;
  seq    integer;
  reg    text;
  years  integer := business_setting_value('certificate_validity_years', (now() AT TIME ZONE 'Asia/Kolkata')::date)::integer;
BEGIN
  SELECT m.state, m.category, m.brand_name, m.model_number, o.legal_name INTO a
    FROM model_application m JOIN organisation o ON o.id = m.organisation_id WHERE m.id = p_application;
  IF NOT FOUND OR a.state <> 'approved' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'a certificate is issued only for an approved application';
  END IF;
  SELECT stars, declared_iseer, verified_iseer, scheme_key INTO r
    FROM model_application_rating WHERE application_id = p_application ORDER BY rating_version DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'an application is approved only after it has a rating';
  END IF;
  INSERT INTO certificate_allocator (category_code, issue_year, next_value) VALUES (a.category, yr, 10002)
    ON CONFLICT (category_code, issue_year) DO UPDATE SET next_value = certificate_allocator.next_value + 1
    RETURNING next_value - 1 INTO seq;
  reg := 'BEE/' || a.category || '/' || yr || '/' || seq;
  INSERT INTO certificate (application_id, transition_event_id, registration_id, category_code, issue_year, sequence_no, valid_from, valid_to,
                           organisation_name, brand_name, model_number, stars, declared_iseer, verified_iseer, scheme_key, issued_by_account_id)
  VALUES (p_application, p_event, reg, a.category, yr, seq, today, (today + make_interval(years => years) - interval '1 day')::date,
          a.legal_name, a.brand_name, a.model_number, r.stars, r.declared_iseer, r.verified_iseer, r.scheme_key, p_actor);
  RETURN reg;
END $$;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.business_setting_proposal TO bee_local_maint', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.business_setting_def, %I.business_setting_version TO bee_runtime', home_schema, home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.business_setting_proposal TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.business_setting_decide(uuid, uuid, text, text) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.business_setting_value(text, date) TO bee_runtime', home_schema);
  END IF;
END $$;
