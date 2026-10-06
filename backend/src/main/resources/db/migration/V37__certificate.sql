-- WP09.1a (owner's assumptions D7, 5 October 2026, not BEE's decision): when an application becomes approved, a certificate is issued in
-- the same transaction. Provisional local rules; every certificate is a LOCAL DEMONSTRATION, not a BEE certificate.
--
-- * Registration ID: BEE/<category>/<year>/<number>, numbered per category and year from 10001 (the fixtures use BEE/RAC/2026/10016).
-- * Validity: 3 years from the approval date, the last day being the day before the third anniversary. Renewal is not built.
-- * Issued automatically by issue_certificate(), called by the two steps that end in "approved" (the Secretary's approval and a Director's
--   recommendation that is final for the category). If issuing fails, the approval does not happen.
-- * The certificate keeps the facts it was issued on (brand, model, organisation name, rating) so it never changes with later records.
--   Status (valid or expired) is worked out from the dates when it is read; revoked is designed in (a later step) but not built.

CREATE TABLE certificate_allocator (
  category_code  text    NOT NULL CHECK (category_code ~ '^[A-Z]{2,10}$'),
  issue_year     integer NOT NULL CHECK (issue_year BETWEEN 2000 AND 2999),
  next_value     integer NOT NULL CHECK (next_value >= 10001),
  PRIMARY KEY (category_code, issue_year)
);

CREATE TABLE certificate (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL UNIQUE REFERENCES model_application (id),
  transition_event_id   uuid NOT NULL UNIQUE REFERENCES model_application_transition_event (id),
  registration_id       text NOT NULL UNIQUE CHECK (registration_id ~ '^BEE/[A-Z]{2,10}/[0-9]{4}/[0-9]{5,}$'),
  category_code         text NOT NULL,
  issue_year            integer NOT NULL,
  sequence_no           integer NOT NULL CHECK (sequence_no >= 10001),
  valid_from            date NOT NULL,
  valid_to              date NOT NULL,
  organisation_name     text NOT NULL,
  brand_name            text NOT NULL,
  model_number          text NOT NULL,
  stars                 smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  declared_iseer        numeric(4,2) NOT NULL,
  verified_iseer        numeric(4,2) NOT NULL,
  scheme_key            text NOT NULL,
  basis                 text NOT NULL DEFAULT 'local_demo' CHECK (basis = 'local_demo'),
  issued_by_account_id  uuid NOT NULL REFERENCES user_account (id),
  issued_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to > valid_from),
  UNIQUE (category_code, issue_year, sequence_no)
);
CREATE INDEX certificate_validity ON certificate (valid_to);

CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON certificate
  FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON certificate
  FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change();

-- Issues the certificate of an application that has just become approved (the caller has already moved the state and written the
-- transition event, in the same transaction). Returns the registration ID. Raises if the application is not approved or has no rating.
CREATE FUNCTION issue_certificate(p_application uuid, p_event uuid, p_actor uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  a      record;
  r      record;
  today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  yr     integer := extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata'))::integer;
  seq    integer;
  reg    text;
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
  -- The first number of a category and year is 10001; the upsert holds the row lock, so concurrent approvals get different numbers.
  INSERT INTO certificate_allocator (category_code, issue_year, next_value) VALUES (a.category, yr, 10002)
    ON CONFLICT (category_code, issue_year) DO UPDATE SET next_value = certificate_allocator.next_value + 1
    RETURNING next_value - 1 INTO seq;
  reg := 'BEE/' || a.category || '/' || yr || '/' || seq;
  INSERT INTO certificate (application_id, transition_event_id, registration_id, category_code, issue_year, sequence_no, valid_from, valid_to,
                           organisation_name, brand_name, model_number, stars, declared_iseer, verified_iseer, scheme_key, issued_by_account_id)
  VALUES (p_application, p_event, reg, a.category, yr, seq, today, (today + interval '3 years' - interval '1 day')::date,
          a.legal_name, a.brand_name, a.model_number, r.stars, r.declared_iseer, r.verified_iseer, r.scheme_key, p_actor);
  RETURN reg;
END $$;

REVOKE ALL ON FUNCTION issue_certificate(uuid, uuid, uuid) FROM PUBLIC;

DROP FUNCTION IF EXISTS app_disposable_model_cleanup(uuid[]);

CREATE FUNCTION app_disposable_model_cleanup(app_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  home_schema text := coalesce(nullif(current_setting('bee.cleanup_schema', true), ''), current_schema());
  missing boolean;
BEGIN
  IF session_user <> 'bee_local_maint' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'cleanup refused: maintenance role required';
  END IF;
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM unnest($1::uuid[]) AS u(id) '
      || 'WHERE NOT EXISTS (SELECT 1 FROM %I.local_disposable_application d WHERE d.application_id = u.id))',
    home_schema)
  INTO missing USING app_ids;
  IF missing THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'cleanup refused: unregistered application id';
  END IF;
  EXECUTE format('DELETE FROM %I.model_application_rejection WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_resubmission WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_return WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_secretary_approval WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_director_recommendation WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_rating WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_reviewer_forward WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_iame_recommendation WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.certificate WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.fee_correction_proposal WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_fee_confirmation WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_transition_event WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.assignment WHERE subject_type = ''model_application'' AND subject_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.model_application_document_version v USING %I.model_application_document d '
      || 'WHERE v.document_id = d.id AND d.application_id = ANY ($1)',
    home_schema, home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.model_application_document WHERE application_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.model_application_fee_snapshot WHERE application_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.model_application_submission_event WHERE application_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.local_disposable_application WHERE application_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application WHERE id = ANY ($1)', home_schema) USING app_ids;
END $$;

REVOKE ALL ON FUNCTION app_disposable_model_cleanup(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_disposable_model_cleanup(uuid[]) FROM bee_app;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.app_disposable_model_cleanup(uuid[]) TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.certificate TO bee_local_maint', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    -- The runtime login reads certificates and issues one only through the function; it cannot write the table or the numbers.
    EXECUTE format('GRANT SELECT ON %I.certificate TO bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I.certificate, %I.certificate_allocator FROM bee_runtime', home_schema, home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.issue_certificate(uuid, uuid, uuid) TO bee_runtime', home_schema);
  END IF;
END $$;
