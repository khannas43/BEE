-- Owner-approved WP3-D1: guest manufacturer signup and Director-gated activation.
-- New successful submissions stop at director_review. Director approval activates
-- the organisation, issues the permittee number and starts the 15-day IST observation.
-- V77 automatic-activation rows are historical evidence and are not rewritten.

ALTER TABLE user_account ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS mobile text;
CREATE UNIQUE INDEX IF NOT EXISTS user_account_email_unique ON user_account (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_account_mobile_unique ON user_account (mobile) WHERE mobile IS NOT NULL;

ALTER TABLE manufacturer_onboarding_application DROP CONSTRAINT IF EXISTS manufacturer_onboarding_application_state_check;
ALTER TABLE manufacturer_onboarding_application ADD CONSTRAINT manufacturer_onboarding_application_state_check CHECK (state IN (
  'draft', 'submitted', 'automatic_checks_failed', 'director_review', 'returned',
  'active_observation', 'active', 'on_hold', 'rejected', 'revoked'));

ALTER TABLE manufacturer_onboarding_director_decision DROP CONSTRAINT IF EXISTS manufacturer_onboarding_director_decision_decision_check;
ALTER TABLE manufacturer_onboarding_director_decision ADD CONSTRAINT manufacturer_onboarding_director_decision_decision_check
  CHECK (decision IN ('approve', 'reject', 'return'));

ALTER TABLE manufacturer_onboarding_command_evidence DROP CONSTRAINT IF EXISTS manufacturer_onboarding_command_evidence_purpose_check;
ALTER TABLE manufacturer_onboarding_command_evidence ADD CONSTRAINT manufacturer_onboarding_command_evidence_purpose_check
  CHECK (purpose IN ('submit', 'director_decision', 'raise_anomaly', 'resolve_anomaly', 'revoke', 'observation_close', 'public_signup'));

INSERT INTO manufacturer_onboarding_allocator (scope, next_value) VALUES ('guest_org', 0)
  ON CONFLICT (scope) DO NOTHING;

CREATE OR REPLACE FUNCTION manufacturer_onboarding_command_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'manufacturer_onboarding_command_evidence_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF session_user <> 'bee_local_maint' AND current_user <> 'bee_local_maint' THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'manufacturer_onboarding_command_evidence_delete_refused';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE manufacturer_onboarding_public_signup (
  command_id uuid PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES user_account (id),
  organisation_id uuid NOT NULL UNIQUE REFERENCES organisation (id),
  application_id uuid NOT NULL UNIQUE REFERENCES manufacturer_onboarding_application (id),
  email text NOT NULL,
  mobile text NOT NULL,
  full_name text NOT NULL,
  email_verified_simulated boolean NOT NULL DEFAULT true,
  mobile_verified_simulated boolean NOT NULL DEFAULT true,
  payload_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX manufacturer_onboarding_public_signup_email ON manufacturer_onboarding_public_signup (lower(email));
CREATE UNIQUE INDEX manufacturer_onboarding_public_signup_mobile ON manufacturer_onboarding_public_signup (mobile);

CREATE FUNCTION manufacturer_onboarding_next_guest_org_code() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  UPDATE manufacturer_onboarding_allocator SET next_value = next_value + 1 WHERE scope = 'guest_org' RETURNING next_value INTO v;
  IF NOT FOUND THEN
    INSERT INTO manufacturer_onboarding_allocator (scope, next_value) VALUES ('guest_org', 1) RETURNING next_value INTO v;
  END IF;
  RETURN format('GUEST-%s', lpad(v::text, 5, '0'));
END $$;

CREATE OR REPLACE FUNCTION manufacturer_onboarding_trusted_patch_draft(
  p_actor uuid, p_application uuid, p_organisation uuid, p_version integer,
  p_legal_name text, p_draft jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE a manufacturer_onboarding_application%ROWTYPE; merged jsonb; v_after integer;
BEGIN
  PERFORM manufacturer_onboarding_assert_applicant_writer(p_actor, p_organisation, p_application);
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state NOT IN ('draft', 'automatic_checks_failed', 'returned') OR a.version <> p_version THEN
    RETURN NULL;
  END IF;
  merged := manufacturer_onboarding_merge_draft_payload(a.draft_payload, p_draft);
  v_after := a.version + 1;
  UPDATE manufacturer_onboarding_application
     SET legal_name = coalesce(nullif(btrim(p_legal_name), ''), legal_name),
         draft_payload = CASE WHEN p_draft IS NULL THEN draft_payload ELSE merged END,
         version = v_after
   WHERE id = p_application;
  RETURN v_after;
END $$;

CREATE OR REPLACE FUNCTION manufacturer_onboarding_trusted_append_document(
  p_actor uuid, p_application uuid, p_organisation uuid, p_document_kind text,
  p_content_sha256 char(64), p_size_bytes bigint, p_original_filename text, p_label text,
  p_issue_on date, p_expires_on date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE a manufacturer_onboarding_application%ROWTYPE; doc_id uuid; next_ver integer;
  kinds text[] := ARRAY['trade_licence', 'certificate_of_incorporation', 'gst_certificate', 'pan_card', 'signatory_photo_id',
    'facility_address_proof', 'signed_declaration', 'signed_agreement', 'annexure_supporting'];
BEGIN
  PERFORM manufacturer_onboarding_assert_applicant_writer(p_actor, p_organisation, p_application);
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state NOT IN ('draft', 'automatic_checks_failed', 'returned') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'not_editable';
  END IF;
  IF NOT (p_document_kind = ANY (kinds)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'validation_failed';
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_content_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'validation_failed';
  END IF;
  IF p_expires_on IS NOT NULL AND p_issue_on IS NOT NULL AND p_expires_on <= p_issue_on THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'validation_failed';
  END IF;
  SELECT id INTO doc_id FROM manufacturer_onboarding_document WHERE application_id = p_application AND document_kind = p_document_kind FOR UPDATE;
  IF NOT FOUND THEN
    doc_id := gen_random_uuid();
    INSERT INTO manufacturer_onboarding_document (id, application_id, document_kind) VALUES (doc_id, p_application, p_document_kind);
  END IF;
  SELECT coalesce(max(version_number), 0) + 1 INTO next_ver FROM manufacturer_onboarding_document_version WHERE document_id = doc_id;
  INSERT INTO manufacturer_onboarding_document_version (id, document_id, version_number, content_sha256, size_bytes, media_type, original_filename, label, uploaded_by_account_id, issue_on, expires_on)
  VALUES (gen_random_uuid(), doc_id, next_ver, p_content_sha256, p_size_bytes, 'application/pdf', p_original_filename, p_label, p_actor, p_issue_on, p_expires_on);
  RETURN next_ver;
END $$;

CREATE OR REPLACE FUNCTION manufacturer_onboarding_orchestrate_submit(
  p_application uuid, p_actor uuid, p_role text, p_version integer,
  p_amount_inr numeric, p_fee_rule_key text, p_fee_rule_version integer,
  p_verification_status text, p_source_reference text, p_note text,
  p_command_id uuid, p_payload_hash char(64))
RETURNS TABLE (out_state text, out_version integer, out_payment_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  a manufacturer_onboarding_application%ROWTYPE;
  plc text;
  pay_id uuid;
  gw text;
  sha text;
  receipt text;
  v_after integer;
  checks_ok boolean;
  to_state text;
  notify_id uuid := gen_random_uuid();
  notify_hash char(64) := md5(p_command_id::text || 'mob-notify-submit') || md5('mob-notify-submit|' || p_command_id::text);
  canonical char(64);
  prior manufacturer_onboarding_command_evidence;
  from_state text;
  existing_pay uuid;
BEGIN
  canonical := manufacturer_onboarding_canonical_hash(ARRAY[
    'submit', p_application::text, p_actor::text, 'manufacturer', p_version::text,
    p_amount_inr::text, p_fee_rule_key, p_fee_rule_version::text, coalesce(p_verification_status, ''),
    coalesce(p_source_reference, ''), coalesce(p_note, '')]);
  prior := manufacturer_onboarding_idempotency_replay(p_command_id, p_application, 'submit', canonical, p_payload_hash);
  IF prior IS NOT NULL THEN
    RETURN QUERY SELECT prior.result_state, prior.result_version, prior.result_payment_id;
    RETURN;
  END IF;
  PERFORM manufacturer_onboarding_assert_submit_actor(p_actor, p_application, p_role);
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state NOT IN ('draft', 'automatic_checks_failed', 'returned') OR a.version <> p_version THEN
    RETURN QUERY SELECT 'not_submittable'::text, NULL::integer, NULL::uuid; RETURN;
  END IF;
  SELECT permittee_lifecycle INTO plc FROM organisation WHERE id = a.organisation_id;
  IF plc IN ('on_hold', 'revoked', 'active', 'pending') THEN
    RETURN QUERY SELECT 'organisation_not_eligible'::text, NULL::integer, NULL::uuid; RETURN;
  END IF;
  from_state := a.state;
  checks_ok := manufacturer_onboarding_run_automated_checks(p_application);
  IF p_amount_inr IS DISTINCT FROM 5000.00 THEN
    INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
    VALUES (p_application, 'fee_rule_amount', 'fail', 'Fee must match master rule INR 5000.00');
    checks_ok := false;
  END IF;
  IF NOT checks_ok THEN
    v_after := a.version + 1;
    UPDATE manufacturer_onboarding_application SET state = 'automatic_checks_failed', version = v_after WHERE id = p_application;
    INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
    VALUES (p_application, 'submit_checks_failed', from_state, 'automatic_checks_failed', p_actor, 'manufacturer', 'Automated checks failed');
    INSERT INTO manufacturer_onboarding_command_evidence
      (command_id, application_id, purpose, payload_hash, result_state, result_version, result_payment_id)
    VALUES (p_command_id, p_application, 'submit', canonical, 'automatic_checks_failed', v_after, NULL);
    RETURN QUERY SELECT 'automatic_checks_failed'::text, v_after, NULL::uuid; RETURN;
  END IF;

  SELECT payment_id INTO existing_pay FROM manufacturer_onboarding_payment_link WHERE application_id = p_application;
  IF existing_pay IS NOT NULL THEN
    pay_id := existing_pay;
    SELECT receipt_number INTO receipt FROM payment WHERE id = pay_id;
  ELSE
    pay_id := gen_random_uuid();
    gw := 'SIMGW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    sha := md5(p_application::text || p_command_id::text) || md5('sim|' || p_application::text || p_command_id::text);
    receipt := manufacturer_onboarding_sim_receipt_number();
    INSERT INTO payment (id, application_id, organisation_id, amount_inr, status, gateway_ref, started_by_account_id, receipt_number, settled_at)
    VALUES (pay_id, p_application, a.organisation_id, p_amount_inr, 'paid', gw, p_actor, receipt, now());
    INSERT INTO payment_callback (payment_id, gateway_ref, outcome, payload_sha256) VALUES (pay_id, gw, 'paid', sha);
    INSERT INTO payment_event (payment_id, event, actor_account_id, actor_role, detail)
    VALUES (pay_id, 'started', p_actor, 'manufacturer', 'Onboarding fee at simulated gateway'),
           (pay_id, 'paid', p_actor, 'manufacturer', 'Simulated auto-settle on submit');
    INSERT INTO manufacturer_onboarding_payment_link (application_id, payment_id) VALUES (p_application, pay_id);
    INSERT INTO manufacturer_onboarding_fee_snapshot
      (application_id, amount_inr, tax_rate_percent, fee_rule_key, fee_rule_version, verification_status, source_reference, note)
    VALUES (p_application, p_amount_inr, 0, p_fee_rule_key, p_fee_rule_version, p_verification_status, p_source_reference, p_note);
  END IF;
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'payment_receipt', 'pass', receipt);

  v_after := a.version + 1;
  UPDATE manufacturer_onboarding_application SET state = 'submitted', version = v_after WHERE id = p_application;
  INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
  VALUES (p_application, 'submit', from_state, 'submitted', p_actor, 'manufacturer', 'Submitted with simulated payment');
  v_after := v_after + 1;
  to_state := 'director_review';
  UPDATE manufacturer_onboarding_application SET state = to_state, version = v_after WHERE id = p_application;
  UPDATE organisation SET permittee_lifecycle = 'pending' WHERE id = a.organisation_id AND permittee_lifecycle = 'none';
  INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
  VALUES (p_application, 'checks_passed', 'submitted', to_state, p_actor, 'manufacturer', 'Automated checks passed; awaiting Director decision');
  PERFORM notification_foundation_deliver(notify_id, notify_hash, 'manufacturer_onboarding_application', p_application,
    'manufacturer_onboarding_director_review', 'Automated checks passed; director review required.', p_actor);
  INSERT INTO manufacturer_onboarding_command_evidence
    (command_id, application_id, purpose, payload_hash, result_state, result_version, result_payment_id)
  VALUES (p_command_id, p_application, 'submit', canonical, to_state, v_after, pay_id);
  RETURN QUERY SELECT to_state, v_after, pay_id;
END $$;

CREATE OR REPLACE FUNCTION manufacturer_onboarding_orchestrate_director_decision(
  p_application uuid, p_actor uuid, p_version integer, p_decision text, p_note text,
  p_command_id uuid, p_payload_hash char(64))
RETURNS TABLE (out_state text, out_version integer, out_permittee_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  a manufacturer_onboarding_application%ROWTYPE;
  v_after integer;
  pt text;
  ev uuid := gen_random_uuid();
  approved_at timestamptz := clock_timestamp();
  obs_start date;
  obs_end date;
  canonical char(64);
  prior manufacturer_onboarding_command_evidence;
  note text := nullif(btrim(p_note), '');
  notify_id uuid := gen_random_uuid();
  notify_hash char(64) := md5(p_command_id::text || 'mob-notify-director') || md5('mob-notify-director|' || p_command_id::text);
BEGIN
  canonical := manufacturer_onboarding_canonical_hash(ARRAY[
    'director_decision', p_application::text, p_actor::text, p_version::text, p_decision, coalesce(note, '')]);
  prior := manufacturer_onboarding_idempotency_replay(p_command_id, p_application, 'director_decision', canonical, p_payload_hash);
  IF prior IS NOT NULL THEN
    RETURN QUERY SELECT prior.result_state, prior.result_version, prior.result_permittee_number;
    RETURN;
  END IF;
  IF p_decision NOT IN ('approve', 'reject', 'return') THEN
    RETURN QUERY SELECT 'validation_failed'::text, NULL::integer, NULL::text; RETURN;
  END IF;
  IF p_decision IN ('reject', 'return') AND (note IS NULL OR char_length(note) < 8) THEN
    RETURN QUERY SELECT 'validation_failed'::text, NULL::integer, NULL::text; RETURN;
  END IF;
  PERFORM manufacturer_onboarding_assert_director_actor(p_actor, p_application);
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state <> 'director_review' OR a.version <> p_version THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer, NULL::text; RETURN;
  END IF;
  v_after := a.version + 1;
  IF p_decision = 'return' THEN
    UPDATE manufacturer_onboarding_application SET state = 'returned', version = v_after WHERE id = p_application;
    UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = a.organisation_id AND permittee_lifecycle = 'pending';
    INSERT INTO manufacturer_onboarding_director_decision (application_id, decision, note, actor_account_id, transition_event_id)
    VALUES (p_application, 'return', note, p_actor, ev);
    INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
    VALUES (p_application, 'director_return', 'director_review', 'returned', p_actor, 'director', note);
    INSERT INTO manufacturer_onboarding_command_evidence
      (command_id, application_id, purpose, payload_hash, result_state, result_version, result_permittee_number)
    VALUES (p_command_id, p_application, 'director_decision', canonical, 'returned', v_after, NULL);
    RETURN QUERY SELECT 'returned'::text, v_after, NULL::text; RETURN;
  END IF;
  IF p_decision = 'reject' THEN
    UPDATE manufacturer_onboarding_application SET state = 'rejected', version = v_after WHERE id = p_application;
    UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = a.organisation_id;
    INSERT INTO manufacturer_onboarding_director_decision (application_id, decision, note, actor_account_id, transition_event_id)
    VALUES (p_application, 'reject', note, p_actor, ev);
    INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
    VALUES (p_application, 'director_reject', 'director_review', 'rejected', p_actor, 'director', note);
    INSERT INTO manufacturer_onboarding_command_evidence
      (command_id, application_id, purpose, payload_hash, result_state, result_version, result_permittee_number)
    VALUES (p_command_id, p_application, 'director_decision', canonical, 'rejected', v_after, NULL);
    RETURN QUERY SELECT 'rejected'::text, v_after, NULL::text; RETURN;
  END IF;
  obs_start := (approved_at AT TIME ZONE 'Asia/Kolkata')::date;
  obs_end := obs_start + 15;
  pt := manufacturer_onboarding_next_permittee(extract(year from obs_start)::integer);
  UPDATE manufacturer_onboarding_application
     SET state = 'active_observation', version = v_after, permittee_number = pt, observation_ends_on = obs_end
   WHERE id = p_application;
  UPDATE organisation SET permittee_lifecycle = 'active' WHERE id = a.organisation_id;
  INSERT INTO manufacturer_onboarding_director_decision (application_id, decision, note, actor_account_id, decided_at, transition_event_id)
  VALUES (p_application, 'approve', note, p_actor, approved_at, ev);
  INSERT INTO manufacturer_onboarding_observation (application_id, started_on, ends_on) VALUES (p_application, obs_start, obs_end);
  INSERT INTO manufacturer_onboarding_permittee_activation
    (application_id, organisation_id, permittee_number, activated_at, transition_event_id)
  VALUES (p_application, a.organisation_id, pt, approved_at, ev);
  INSERT INTO manufacturer_onboarding_event (id, application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail, occurred_at)
  VALUES (ev, p_application, 'director_approve', 'director_review', 'active_observation', p_actor, 'director',
    coalesce(note, 'Director approved; manufacturer activated for 15-day observation.'), approved_at);
  PERFORM notification_foundation_deliver(notify_id, notify_hash,
    'manufacturer_onboarding_application', p_application, 'manufacturer_onboarding_information',
    'Director approved; permittee in observation.', p_actor);
  INSERT INTO manufacturer_onboarding_command_evidence
    (command_id, application_id, purpose, payload_hash, result_state, result_version, result_permittee_number)
  VALUES (p_command_id, p_application, 'director_decision', canonical, 'active_observation', v_after, pt);
  RETURN QUERY SELECT 'active_observation'::text, v_after, pt;
END $$;

CREATE FUNCTION manufacturer_onboarding_orchestrate_public_signup(
  p_full_name text, p_email text, p_mobile text, p_keycloak_subject uuid,
  p_command_id uuid, p_payload_hash char(64))
RETURNS TABLE (out_state text, out_account_id uuid, out_organisation_id uuid, out_application_id uuid, out_username text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_full_name text := btrim(p_full_name);
  v_email text := lower(btrim(p_email));
  v_mobile text := btrim(p_mobile);
  v_username text;
  account_id uuid := gen_random_uuid();
  org_id uuid := gen_random_uuid();
  app_id uuid;
  subject uuid := coalesce(p_keycloak_subject, gen_random_uuid());
  canonical char(64);
  prior manufacturer_onboarding_public_signup;
  year integer := extract(year from (now() AT TIME ZONE 'Asia/Kolkata'))::integer;
  org_code text;
BEGIN
  canonical := manufacturer_onboarding_canonical_hash(ARRAY[
    'public_signup', coalesce(v_email, ''), coalesce(v_mobile, ''), coalesce(v_full_name, ''), coalesce(p_keycloak_subject::text, '')]);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text, 0));
  IF p_payload_hash IS NOT NULL AND p_payload_hash <> canonical THEN
    RETURN QUERY SELECT 'idempotency_key_conflict'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text; RETURN;
  END IF;
  SELECT * INTO prior FROM manufacturer_onboarding_public_signup WHERE command_id = p_command_id;
  IF FOUND THEN
    IF prior.payload_hash <> canonical THEN
      RETURN QUERY SELECT 'idempotency_key_conflict'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text; RETURN;
    END IF;
    SELECT u.username INTO v_username FROM user_account u WHERE u.id = prior.account_id;
    RETURN QUERY SELECT 'created'::text, prior.account_id, prior.organisation_id, prior.application_id, v_username;
    RETURN;
  END IF;
  IF v_full_name IS NULL OR char_length(v_full_name) < 2 OR char_length(v_full_name) > 120
     OR v_email IS NULL OR v_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
     OR v_mobile IS NULL OR v_mobile !~ '^[6-9][0-9]{9}$' THEN
    RETURN QUERY SELECT 'validation_failed'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text; RETURN;
  END IF;
  v_username := v_email;
  IF v_username IN ('onboarding.applicant', 'bee.admin', 'bee.director', 'bee.finance', 'bee.programme', 'nova.applicant')
     OR EXISTS (SELECT 1 FROM user_account u WHERE lower(u.username) = v_username OR lower(u.email) = v_email OR u.mobile = v_mobile)
     OR EXISTS (SELECT 1 FROM manufacturer_onboarding_public_signup s WHERE lower(s.email) = v_email OR s.mobile = v_mobile) THEN
    RETURN QUERY SELECT 'registration_not_available'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM user_account u WHERE u.keycloak_subject = subject) THEN
    RETURN QUERY SELECT 'registration_not_available'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text; RETURN;
  END IF;
  org_code := manufacturer_onboarding_next_guest_org_code();
  INSERT INTO organisation (id, code, kind, legal_name, status, permittee_lifecycle)
  VALUES (org_id, org_code, 'manufacturer', v_full_name, 'active', 'none');
  INSERT INTO user_account (id, keycloak_subject, username, display_name, status, email, mobile)
  VALUES (account_id, subject, v_username, v_full_name, 'active', v_email, v_mobile);
  INSERT INTO organisation_membership (user_id, organisation_id, active) VALUES (account_id, org_id, true);
  INSERT INTO role_assignment (user_id, role, scope, active) VALUES (account_id, 'manufacturer', 'own-org', true);
  app_id := manufacturer_onboarding_trusted_create(account_id, org_id, v_full_name, year, '{}'::jsonb);
  INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
  VALUES (app_id, 'public_signup', NULL, 'draft', account_id, 'manufacturer',
    'Guest applicant created with simulated email and mobile OTP verification.');
  INSERT INTO manufacturer_onboarding_public_signup
    (command_id, account_id, organisation_id, application_id, email, mobile, full_name, payload_hash)
  VALUES (p_command_id, account_id, org_id, app_id, v_email, v_mobile, v_full_name, canonical);
  INSERT INTO manufacturer_onboarding_command_evidence
    (command_id, application_id, purpose, payload_hash, result_state, result_version)
  VALUES (p_command_id, app_id, 'public_signup', canonical, 'draft', 0);
  RETURN QUERY SELECT 'created'::text, account_id, org_id, app_id, v_username;
END $$;

CREATE FUNCTION manufacturer_onboarding_maint_cleanup_public_signup(p_account uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  r manufacturer_onboarding_public_signup%ROWTYPE;
  app uuid;
  org uuid;
  n integer := 0;
BEGIN
  SELECT * INTO r FROM manufacturer_onboarding_public_signup WHERE account_id = p_account;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM user_account u WHERE u.id = p_account AND u.username = 'onboarding.applicant') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'not_permitted';
  END IF;
  app := r.application_id;
  org := r.organisation_id;
  DELETE FROM manufacturer_onboarding_public_signup WHERE account_id = p_account;
  DELETE FROM notification WHERE subject_kind = 'manufacturer_onboarding_application' AND subject_id = app;
  DELETE FROM notification_command WHERE subject_kind = 'manufacturer_onboarding_application' AND subject_id = app;
  DELETE FROM manufacturer_onboarding_command_evidence WHERE application_id = app;
  DELETE FROM manufacturer_onboarding_automated_check WHERE application_id = app;
  DELETE FROM manufacturer_onboarding_anomaly WHERE application_id = app;
  DELETE FROM manufacturer_onboarding_director_decision WHERE application_id = app;
  DELETE FROM manufacturer_onboarding_observation WHERE application_id = app;
  DELETE FROM manufacturer_onboarding_permittee_activation WHERE application_id = app;
  DELETE FROM manufacturer_onboarding_fee_snapshot WHERE application_id = app;
  DELETE FROM manufacturer_onboarding_document_version v
    USING manufacturer_onboarding_document d
   WHERE v.document_id = d.id AND d.application_id = app;
  DELETE FROM manufacturer_onboarding_document WHERE application_id = app;
  DELETE FROM manufacturer_onboarding_event WHERE application_id = app;
  DELETE FROM manufacturer_onboarding_payment_link WHERE application_id = app;
  DELETE FROM payment_event pe USING payment p
    WHERE pe.payment_id = p.id AND p.organisation_id = org;
  DELETE FROM payment_callback pc USING payment p
    WHERE pc.payment_id = p.id AND p.organisation_id = org;
  DELETE FROM payment WHERE organisation_id = org;
  DELETE FROM manufacturer_onboarding_application WHERE id = app;
  DELETE FROM role_assignment WHERE user_id = p_account;
  DELETE FROM organisation_membership WHERE user_id = p_account;
  DELETE FROM user_account WHERE id = p_account;
  DELETE FROM organisation WHERE id = org;
  n := 1;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION manufacturer_onboarding_next_guest_org_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_orchestrate_public_signup(text, text, text, uuid, uuid, char(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_maint_cleanup_public_signup(uuid) FROM PUBLIC;

DO $$
DECLARE home_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_trusted_patch_draft(uuid, uuid, uuid, integer, text, jsonb) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_trusted_append_document(uuid, uuid, uuid, text, char(64), bigint, text, text, date, date) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_orchestrate_submit(uuid, uuid, text, integer, numeric, text, integer, text, text, text, uuid, char(64)) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_orchestrate_director_decision(uuid, uuid, integer, text, text, uuid, char(64)) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_orchestrate_public_signup(text, text, text, uuid, uuid, char(64)) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_maint_cleanup_public_signup(uuid) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_next_guest_org_code() SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.manufacturer_onboarding_orchestrate_public_signup(text, text, text, uuid, uuid, char(64)) TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.manufacturer_onboarding_public_signup TO bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I.manufacturer_onboarding_public_signup FROM bee_runtime', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.manufacturer_onboarding_maint_cleanup_public_signup(uuid) TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.manufacturer_onboarding_public_signup TO bee_local_maint', home_schema);
  END IF;
END $$;
