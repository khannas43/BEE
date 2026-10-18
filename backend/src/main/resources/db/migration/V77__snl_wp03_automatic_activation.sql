-- Owner-approved optimized manufacturer onboarding correction:
-- successful automated checks activate the manufacturer immediately and start
-- a 15-calendar-day observation window. Director approval is not a prerequisite.

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
  pay_id uuid := gen_random_uuid();
  gw text := 'SIMGW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  sha text := md5(p_application::text || p_command_id::text) || md5('sim|' || p_application::text || p_command_id::text);
  receipt text;
  v_after integer;
  checks_ok boolean;
  notify_id uuid := gen_random_uuid();
  notify_hash char(64) := md5(p_command_id::text || 'mob-notify-automatic-activation')
    || md5('mob-notify-automatic-activation|' || p_command_id::text);
  canonical char(64);
  prior manufacturer_onboarding_command_evidence;
  from_state text;
  activated_at timestamptz := clock_timestamp();
  obs_start date;
  obs_end date;
  permittee text;
  activation_event uuid := gen_random_uuid();
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
  IF NOT FOUND OR a.state NOT IN ('draft', 'automatic_checks_failed') OR a.version <> p_version THEN
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

  receipt := manufacturer_onboarding_sim_receipt_number();
  INSERT INTO payment (id, application_id, organisation_id, amount_inr, status, gateway_ref, started_by_account_id, receipt_number, settled_at)
  VALUES (pay_id, p_application, a.organisation_id, p_amount_inr, 'paid', gw, p_actor, receipt, now());
  INSERT INTO payment_callback (payment_id, gateway_ref, outcome, payload_sha256) VALUES (pay_id, gw, 'paid', sha);
  INSERT INTO payment_event (payment_id, event, actor_account_id, actor_role, detail)
  VALUES (pay_id, 'started', p_actor, 'manufacturer', 'Onboarding fee at simulated gateway'),
         (pay_id, 'paid', p_actor, 'manufacturer', 'Simulated auto-settle on submit');
  INSERT INTO manufacturer_onboarding_payment_link (application_id, payment_id) VALUES (p_application, pay_id);
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'payment_receipt', 'pass', receipt);
  INSERT INTO manufacturer_onboarding_fee_snapshot
    (application_id, amount_inr, tax_rate_percent, fee_rule_key, fee_rule_version, verification_status, source_reference, note)
  VALUES (p_application, p_amount_inr, 0, p_fee_rule_key, p_fee_rule_version, p_verification_status, p_source_reference, p_note);

  v_after := a.version + 1;
  UPDATE manufacturer_onboarding_application SET state = 'submitted', version = v_after WHERE id = p_application;
  INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
  VALUES (p_application, 'submit', from_state, 'submitted', p_actor, 'manufacturer', 'Submitted with simulated payment');

  obs_start := (activated_at AT TIME ZONE 'Asia/Kolkata')::date;
  obs_end := obs_start + 15;
  permittee := manufacturer_onboarding_next_permittee(extract(year from obs_start)::integer);
  v_after := v_after + 1;
  UPDATE manufacturer_onboarding_application
     SET state = 'active_observation', version = v_after, permittee_number = permittee, observation_ends_on = obs_end
   WHERE id = p_application;
  UPDATE organisation SET permittee_lifecycle = 'active' WHERE id = a.organisation_id;
  INSERT INTO manufacturer_onboarding_observation (application_id, started_on, ends_on)
  VALUES (p_application, obs_start, obs_end);
  INSERT INTO manufacturer_onboarding_permittee_activation
    (application_id, organisation_id, permittee_number, activated_at, transition_event_id)
  VALUES (p_application, a.organisation_id, permittee, activated_at, activation_event);
  INSERT INTO manufacturer_onboarding_event
    (id, application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail, occurred_at)
  VALUES (activation_event, p_application, 'automatic_activation', 'submitted', 'active_observation', p_actor, 'system',
    'Payment and automated checks passed; manufacturer activated for 15-day observation.', activated_at);
  PERFORM notification_foundation_deliver(notify_id, notify_hash,
    'manufacturer_onboarding_application', p_application, 'manufacturer_onboarding_information',
    'Manufacturer automatically activated; 15-day observation window started.', p_actor);
  INSERT INTO manufacturer_onboarding_command_evidence
    (command_id, application_id, purpose, payload_hash, result_state, result_version, result_payment_id, result_permittee_number)
  VALUES (p_command_id, p_application, 'submit', canonical, 'active_observation', v_after, pay_id, permittee);
  RETURN QUERY SELECT 'active_observation'::text, v_after, pay_id;
END $$;

-- This expedited anomaly route exists only during the 15-day observation
-- window. After the scheduler promotes a registration to active, any later
-- concern must use the normal revocation process.
CREATE OR REPLACE FUNCTION manufacturer_onboarding_orchestrate_raise_anomaly(
  p_application uuid, p_actor uuid, p_actor_role text, p_version integer, p_reason text,
  p_command_id uuid, p_payload_hash char(64))
RETURNS TABLE (out_state text, out_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE a manufacturer_onboarding_application%ROWTYPE; v_after integer;
  canonical char(64); prior manufacturer_onboarding_command_evidence;
BEGIN
  canonical := manufacturer_onboarding_canonical_hash(ARRAY[
    'raise_anomaly', p_application::text, p_actor::text, p_actor_role, p_version::text, btrim(p_reason)]);
  prior := manufacturer_onboarding_idempotency_replay(p_command_id, p_application, 'raise_anomaly', canonical, p_payload_hash);
  IF prior IS NOT NULL THEN RETURN QUERY SELECT prior.result_state, prior.result_version; RETURN; END IF;
  PERFORM manufacturer_onboarding_assert_anomaly_actor(p_actor, p_actor_role);
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state <> 'active_observation' OR a.version <> p_version THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM manufacturer_onboarding_anomaly WHERE application_id = p_application AND resolved_at IS NULL) THEN
    RETURN QUERY SELECT 'anomaly_open'::text, NULL::integer; RETURN;
  END IF;
  v_after := a.version + 1;
  UPDATE manufacturer_onboarding_application SET state = 'on_hold', version = v_after WHERE id = p_application;
  UPDATE organisation SET permittee_lifecycle = 'on_hold' WHERE id = a.organisation_id;
  INSERT INTO manufacturer_onboarding_anomaly (application_id, raised_by_role, reason, raised_by_account_id)
  VALUES (p_application, p_actor_role, btrim(p_reason), p_actor);
  INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
  VALUES (p_application, 'anomaly_raised', 'active_observation', 'on_hold', p_actor, p_actor_role, p_reason);
  INSERT INTO manufacturer_onboarding_command_evidence (command_id, application_id, purpose, payload_hash, result_state, result_version)
  VALUES (p_command_id, p_application, 'raise_anomaly', canonical, 'on_hold', v_after);
  RETURN QUERY SELECT 'on_hold'::text, v_after;
END $$;

CREATE OR REPLACE FUNCTION manufacturer_onboarding_orchestrate_resolve_anomaly(
  p_application uuid, p_actor uuid, p_version integer, p_resolution text, p_note text,
  p_command_id uuid, p_payload_hash char(64))
RETURNS TABLE (out_state text, out_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE a manufacturer_onboarding_application%ROWTYPE; v_after integer; resume text; today date; ev uuid := gen_random_uuid();
  purpose text; canonical char(64); prior manufacturer_onboarding_command_evidence;
BEGIN
  IF p_resolution NOT IN ('cleared', 'revoked') THEN RETURN QUERY SELECT 'validation_failed'::text, NULL::integer; RETURN; END IF;
  purpose := CASE WHEN p_resolution = 'revoked' THEN 'revoke' ELSE 'resolve_anomaly' END;
  canonical := manufacturer_onboarding_canonical_hash(ARRAY[
    purpose, p_application::text, p_actor::text, p_version::text, p_resolution, coalesce(nullif(btrim(p_note), ''), '')]);
  prior := manufacturer_onboarding_idempotency_replay(p_command_id, p_application, purpose, canonical, p_payload_hash);
  IF prior IS NOT NULL THEN RETURN QUERY SELECT prior.result_state, prior.result_version; RETURN; END IF;
  PERFORM manufacturer_onboarding_assert_director_actor(p_actor, p_application);
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state <> 'on_hold' OR a.version <> p_version THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer; RETURN;
  END IF;
  v_after := a.version + 1;
  IF p_resolution = 'revoked' THEN
    UPDATE manufacturer_onboarding_application SET state = 'revoked', version = v_after WHERE id = p_application;
    UPDATE organisation SET permittee_lifecycle = 'revoked' WHERE id = a.organisation_id;
    UPDATE manufacturer_onboarding_anomaly SET resolved_at = now(), resolution = 'revoked', resolved_by_account_id = p_actor,
      resolution_note = nullif(btrim(p_note), '') WHERE application_id = p_application AND resolved_at IS NULL;
    INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
    VALUES (p_application, 'director_revoke', 'on_hold', 'revoked', p_actor, 'director', p_note);
    INSERT INTO manufacturer_onboarding_command_evidence
      (command_id, application_id, purpose, payload_hash, result_state, result_version)
    VALUES (p_command_id, p_application, 'revoke', canonical, 'revoked', v_after);
    RETURN QUERY SELECT 'revoked'::text, v_after; RETURN;
  END IF;
  today := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  IF a.observation_ends_on IS NOT NULL AND today >= a.observation_ends_on THEN
    resume := 'active';
    UPDATE manufacturer_onboarding_observation SET closed_at = now(), transition_event_id = ev
      WHERE application_id = p_application AND closed_at IS NULL;
  ELSE
    resume := 'active_observation';
  END IF;
  UPDATE organisation SET permittee_lifecycle = 'active' WHERE id = a.organisation_id;
  UPDATE manufacturer_onboarding_application SET state = resume, version = v_after WHERE id = p_application;
  UPDATE manufacturer_onboarding_anomaly SET resolved_at = now(), resolution = 'cleared', resolved_by_account_id = p_actor,
    resolution_note = nullif(btrim(p_note), '') WHERE application_id = p_application AND resolved_at IS NULL;
  INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
  VALUES (p_application, 'anomaly_cleared', 'on_hold', resume, p_actor, 'director', p_note);
  INSERT INTO manufacturer_onboarding_command_evidence
    (command_id, application_id, purpose, payload_hash, result_state, result_version)
  VALUES (p_command_id, p_application, 'resolve_anomaly', canonical, resume, v_after);
  RETURN QUERY SELECT resume, v_after;
END $$;

CREATE OR REPLACE FUNCTION manufacturer_onboarding_orchestrate_observation_close(
  p_application uuid, p_actor uuid, p_role text, p_version integer,
  p_command_id uuid, p_payload_hash char(64))
RETURNS TABLE (out_state text, out_version integer, out_permittee_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE a manufacturer_onboarding_application%ROWTYPE; today date; v_after integer; ev uuid := gen_random_uuid();
  canonical char(64); prior manufacturer_onboarding_command_evidence;
BEGIN
  canonical := manufacturer_onboarding_canonical_hash(ARRAY[
    'observation_close', p_application::text, p_actor::text, coalesce(p_role, ''), p_version::text]);
  prior := manufacturer_onboarding_idempotency_replay(p_command_id, p_application, 'observation_close', canonical, p_payload_hash);
  IF prior IS NOT NULL THEN
    RETURN QUERY SELECT prior.result_state, prior.result_version, prior.result_permittee_number; RETURN;
  END IF;
  today := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state <> 'active_observation' OR a.version <> p_version THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer, NULL::text; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM manufacturer_onboarding_anomaly WHERE application_id = p_application AND resolved_at IS NULL) THEN
    RETURN QUERY SELECT 'anomaly_open'::text, NULL::integer, NULL::text; RETURN;
  END IF;
  IF today < a.observation_ends_on THEN
    RETURN QUERY SELECT 'observation_not_ended'::text, NULL::integer, NULL::text; RETURN;
  END IF;
  v_after := a.version + 1;
  UPDATE manufacturer_onboarding_application SET state = 'active', version = v_after WHERE id = p_application;
  UPDATE manufacturer_onboarding_observation SET closed_at = now(), transition_event_id = ev
    WHERE application_id = p_application AND closed_at IS NULL;
  UPDATE organisation SET permittee_lifecycle = 'active' WHERE id = a.organisation_id;
  INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
  VALUES (p_application, 'observation_close', 'active_observation', 'active', p_actor, p_role, '15-day observation complete');
  INSERT INTO manufacturer_onboarding_command_evidence
    (command_id, application_id, purpose, payload_hash, result_state, result_version, result_permittee_number)
  VALUES (p_command_id, p_application, 'observation_close', canonical, 'active', v_after, a.permittee_number);
  RETURN QUERY SELECT 'active'::text, v_after, a.permittee_number;
END $$;

CREATE FUNCTION manufacturer_onboarding_system_close_expired_observations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  r record;
  n integer := 0;
  today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  cmd uuid;
  hash char(64);
  system_actor uuid;
BEGIN
  SELECT id INTO system_actor FROM user_account WHERE username = 'bee.director' AND status = 'active' LIMIT 1;
  IF system_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'observation_close_system_actor_missing';
  END IF;
  FOR r IN
    SELECT a.id, a.version FROM manufacturer_onboarding_application a
     WHERE a.state = 'active_observation' AND a.observation_ends_on <= today
       AND NOT EXISTS (SELECT 1 FROM manufacturer_onboarding_anomaly an
         WHERE an.application_id = a.id AND an.resolved_at IS NULL)
     FOR UPDATE
  LOOP
    cmd := gen_random_uuid();
    hash := manufacturer_onboarding_canonical_hash(ARRAY[
      'observation_close', r.id::text, system_actor::text, 'system', r.version::text]);
    PERFORM manufacturer_onboarding_orchestrate_observation_close(
      r.id, system_actor, 'system', r.version, cmd, hash);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Existing applications that were waiting only for the removed approval step are
-- activated during migration and enter a fresh observation window.
DO $$
DECLARE
  r record;
  actor uuid;
  permittee text;
  started date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  ends_on date := started + 15;
  ev uuid;
BEGIN
  SELECT id INTO actor FROM user_account WHERE username = 'bee.director' LIMIT 1;
  FOR r IN SELECT * FROM manufacturer_onboarding_application WHERE state = 'director_review' FOR UPDATE LOOP
    ev := gen_random_uuid();
    permittee := manufacturer_onboarding_next_permittee(extract(year from started)::integer);
    UPDATE manufacturer_onboarding_application
       SET state = 'active_observation', version = version + 1, permittee_number = permittee, observation_ends_on = ends_on
     WHERE id = r.id;
    UPDATE organisation SET permittee_lifecycle = 'active' WHERE id = r.organisation_id;
    INSERT INTO manufacturer_onboarding_observation (application_id, started_on, ends_on)
    VALUES (r.id, started, ends_on) ON CONFLICT (application_id) DO NOTHING;
    INSERT INTO manufacturer_onboarding_permittee_activation
      (application_id, organisation_id, permittee_number, transition_event_id)
    VALUES (r.id, r.organisation_id, permittee, ev) ON CONFLICT (application_id) DO NOTHING;
    INSERT INTO manufacturer_onboarding_event
      (id, application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
    VALUES (ev, r.id, 'automatic_activation_migration', 'director_review', 'active_observation', actor, 'system',
      'Migrated to owner-approved automatic activation and 15-day observation.');
  END LOOP;
END $$;

-- Information notifications now include Director, Programme and Finance.
CREATE OR REPLACE FUNCTION notification_foundation_fan_out(
  p_subject_kind text, p_subject_id uuid, p_kind text, p_message text
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer; org_id uuid;
BEGIN
  IF p_subject_kind = 'manufacturer_onboarding_application' THEN
    IF p_kind = 'manufacturer_onboarding_director_review' THEN
      INSERT INTO notification (recipient_account_id, application_id, subject_kind, subject_id, kind, message)
      SELECT DISTINCT ra.user_id, NULL::uuid, p_subject_kind, p_subject_id, p_kind, p_message
        FROM role_assignment ra
        JOIN capability_grant g ON g.role = ra.role AND g.capability = 'manufacturer_onboarding_director'
        JOIN user_account u ON u.id = ra.user_id
       WHERE ra.active AND u.status = 'active';
    ELSIF p_kind = 'manufacturer_onboarding_information' THEN
      INSERT INTO notification (recipient_account_id, application_id, subject_kind, subject_id, kind, message)
      SELECT DISTINCT ra.user_id, NULL::uuid, p_subject_kind, p_subject_id, p_kind, p_message
        FROM role_assignment ra JOIN user_account u ON u.id = ra.user_id
       WHERE ra.active AND u.status = 'active' AND ra.role IN ('finance', 'programme', 'director') AND ra.scope = 'all';
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_kind_invalid';
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END IF;
  IF p_subject_kind = 'model_application' THEN
    SELECT organisation_id INTO org_id FROM model_application WHERE id = p_subject_id;
  ELSE
    SELECT organisation_id INTO org_id FROM registration_application WHERE id = p_subject_id;
  END IF;
  IF org_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_missing'; END IF;
  INSERT INTO notification (recipient_account_id, application_id, subject_kind, subject_id, kind, message)
  SELECT DISTINCT m.user_id, CASE WHEN p_subject_kind = 'model_application' THEN p_subject_id ELSE NULL END,
         p_subject_kind, p_subject_id, p_kind, p_message
    FROM organisation_membership m JOIN organisation o ON o.id = m.organisation_id JOIN user_account u ON u.id = m.user_id
   WHERE m.organisation_id = org_id AND m.active AND o.status = 'active' AND u.status = 'active'
     AND now() >= m.valid_from AND now() < m.valid_to;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION manufacturer_onboarding_system_close_expired_observations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION manufacturer_onboarding_system_close_expired_observations() TO bee_runtime;

DO $$
DECLARE home_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_orchestrate_submit(uuid, uuid, text, integer, numeric, text, integer, text, text, text, uuid, char(64)) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_orchestrate_raise_anomaly(uuid, uuid, text, integer, text, uuid, char(64)) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_orchestrate_resolve_anomaly(uuid, uuid, integer, text, text, uuid, char(64)) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_orchestrate_observation_close(uuid, uuid, text, integer, uuid, char(64)) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.manufacturer_onboarding_system_close_expired_observations() SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
END $$;
