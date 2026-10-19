-- Brief C3 (applied after V78 guest director activation on the integration line, renumbered from V78): role-identity succession (19 October 2026). Operational authority moves:
--   role director  -> officer  (same grants; bee.director account becomes bee.officer)
--   role secretary -> director (same grants; bee.secretary account becomes bee.director)
-- Workflow state names (director_review, secretary_approval, director_approval) are unchanged.

-- Accounts (fixed demo ids ...007 / ...008).
UPDATE user_account SET username = 'bee.officer', display_name = 'BEE Officer'
  WHERE id = '00000000-0000-4000-a000-000000000007' AND username = 'bee.director';
UPDATE user_account SET username = 'bee.director', display_name = 'BEE Director'
  WHERE id = '00000000-0000-4000-a000-000000000008' AND username = 'bee.secretary';

-- Widen CHECK constraints before two-step role renames (officer_staging is transient).
ALTER TABLE role_assignment DROP CONSTRAINT IF EXISTS role_assignment_role_check;
ALTER TABLE role_assignment ADD CONSTRAINT role_assignment_role_check CHECK (role IN (
  'admin', 'programme', 'reviewer', 'officer', 'officer_staging', 'director', 'secretary', 'finance', 'helpdesk', 'auditor',
  'manufacturer', 'agency', 'iame', 'sda', 'laboratory'
));

ALTER TABLE delegation DROP CONSTRAINT IF EXISTS delegation_role_check;
ALTER TABLE delegation ADD CONSTRAINT delegation_role_check CHECK (role IN ('programme', 'officer', 'director', 'finance'));

-- Role assignments: two-step rename avoids collision on unique (user_id, role).
UPDATE role_assignment SET role = 'officer_staging' WHERE role = 'director';
UPDATE role_assignment SET role = 'director' WHERE role = 'secretary';
UPDATE role_assignment SET role = 'officer' WHERE role = 'officer_staging';

-- Capability grants tied to operational personas.
UPDATE capability_grant SET role = 'officer_staging' WHERE role = 'director';
UPDATE capability_grant SET role = 'director' WHERE role = 'secretary';
UPDATE capability_grant SET role = 'officer' WHERE role = 'officer_staging';

-- Delegations: delegable stage role director -> officer.
-- Existing delegation rows are immutable by trigger (who, what, when) and are left exactly as recorded: a row delegated as role director before this migration keeps that name.

-- Historical actor_role on workflow events (read models and checks use the new keys).
-- model_application_transition_event is append-only: past rows keep the actor role recorded at the time (director for the former Director, secretary for the former Secretary).

ALTER TABLE role_assignment DROP CONSTRAINT IF EXISTS role_assignment_role_check;
ALTER TABLE role_assignment ADD CONSTRAINT role_assignment_role_check CHECK (role IN (
  'admin', 'programme', 'reviewer', 'officer', 'director', 'finance', 'helpdesk', 'auditor',
  'manufacturer', 'agency', 'iame', 'sda', 'laboratory'
));

-- 'director' stays an accepted value only so that delegation rows recorded before this migration (immutable) remain valid when their state changes; the service offers programme, officer and finance only.
ALTER TABLE delegation DROP CONSTRAINT IF EXISTS delegation_role_check;
ALTER TABLE delegation ADD CONSTRAINT delegation_role_check CHECK (role IN ('programme', 'officer', 'director', 'finance'));

-- SNL WP02B forward validation after resubmit (actor roles).
CREATE OR REPLACE FUNCTION model_return_response_validate_forward_transition(
  p_resumed_stage text,
  p_action text,
  p_from_state text,
  p_to_state text,
  p_actor_role text
) RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_action IN ('return', 'reject') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'model_return_response_forward_action_refused';
  END IF;
  IF NOT (
    (p_resumed_stage = 'iame_scrutiny' AND p_action = 'iame_recommend' AND p_from_state = 'iame_scrutiny' AND p_to_state = 'bee_scrutiny' AND p_actor_role = 'iame')
    OR (p_resumed_stage = 'bee_scrutiny' AND p_action = 'reviewer_forward' AND p_from_state = 'bee_scrutiny' AND p_to_state = 'rating' AND p_actor_role = 'reviewer')
    OR (p_resumed_stage = 'rating' AND p_action = 'compute_rating' AND p_from_state = 'rating' AND p_to_state = 'director_review' AND p_actor_role = 'programme')
    OR (p_resumed_stage = 'director_review' AND p_action = 'director_recommend' AND p_from_state = 'director_review' AND p_to_state IN ('secretary_approval', 'approved') AND p_actor_role = 'officer')
    OR (p_resumed_stage = 'secretary_approval' AND p_action = 'secretary_approve' AND p_from_state = 'secretary_approval' AND p_to_state = 'approved' AND p_actor_role = 'director')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'model_return_response_forward_transition_refused';
  END IF;
END $$;

-- Delegation decide (V50): segregated stage-role list uses officer + director (no secretary role).
CREATE OR REPLACE FUNCTION delegation_decide(p_delegation uuid, p_actor uuid, p_decision text, p_note text)
RETURNS TABLE (out_state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  d      delegation%ROWTYPE;
  today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  holds  boolean;
BEGIN
  IF p_decision NOT IN ('approve', 'reject', 'withdraw', 'revoke') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'validation_failed';
  END IF;
  SELECT * INTO d FROM delegation WHERE id = p_delegation FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text;
    RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM role_assignment ra JOIN capability_grant g ON g.role = ra.role AND g.capability = 'delegation_approve'
                  WHERE ra.user_id = p_actor AND ra.active AND ra.scope = 'all' AND ra.valid_from <= now() AND now() < ra.valid_to) INTO holds;

  IF p_decision = 'withdraw' THEN
    IF d.state <> 'pending' THEN
      RETURN QUERY SELECT 'not_pending'::text;
      RETURN;
    END IF;
    IF p_actor <> d.delegator_id THEN
      RETURN QUERY SELECT 'only_delegator'::text;
      RETURN;
    END IF;
    UPDATE delegation SET state = 'withdrawn', decided_by = p_actor, decided_at = now(), decision_note = p_note WHERE id = d.id;
    INSERT INTO delegation_event (delegation_id, action, actor_account_id, note) VALUES (d.id, 'withdrawn', p_actor, p_note);
    RETURN QUERY SELECT 'withdrawn'::text;
    RETURN;
  END IF;

  IF p_decision = 'revoke' THEN
    IF d.state <> 'approved' THEN
      RETURN QUERY SELECT 'not_active'::text;
      RETURN;
    END IF;
    IF p_actor <> d.delegator_id AND NOT holds THEN
      RETURN QUERY SELECT 'not_permitted'::text;
      RETURN;
    END IF;
    UPDATE delegation SET state = 'revoked', revoked_by = p_actor, revoked_at = now(), revoke_note = p_note WHERE id = d.id;
    INSERT INTO delegation_event (delegation_id, action, actor_account_id, note) VALUES (d.id, 'revoked', p_actor, p_note);
    RETURN QUERY SELECT 'revoked'::text;
    RETURN;
  END IF;

  IF d.state <> 'pending' THEN
    RETURN QUERY SELECT 'not_pending'::text;
    RETURN;
  END IF;
  IF NOT holds THEN
    RETURN QUERY SELECT 'not_permitted'::text;
    RETURN;
  END IF;
  IF p_actor = d.delegator_id OR p_actor = d.delegate_id THEN
    RETURN QUERY SELECT 'same_person'::text;
    RETURN;
  END IF;
  IF p_decision = 'reject' THEN
    UPDATE delegation SET state = 'rejected', decided_by = p_actor, decided_at = now(), decision_note = p_note WHERE id = d.id;
    INSERT INTO delegation_event (delegation_id, action, actor_account_id, note) VALUES (d.id, 'rejected', p_actor, p_note);
    RETURN QUERY SELECT 'rejected'::text;
    RETURN;
  END IF;
  IF d.valid_to <= today THEN
    RETURN QUERY SELECT 'date_passed'::text;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_account u WHERE u.id = d.delegator_id AND u.status = 'active')
     OR NOT EXISTS (SELECT 1 FROM role_assignment ra WHERE ra.user_id = d.delegator_id AND ra.role = d.role AND ra.scope = 'all' AND ra.active
                      AND ra.valid_from <= now() AND now() < ra.valid_to)
     OR EXISTS (SELECT 1 FROM role_assignment ra WHERE ra.user_id = d.delegator_id AND ra.active AND ra.valid_from <= now() AND now() < ra.valid_to
                  AND ra.role IN ('programme', 'officer', 'director', 'finance', 'iame', 'reviewer') AND ra.role <> d.role)
     OR EXISTS (SELECT 1 FROM role_assignment ra WHERE ra.user_id = d.delegate_id AND ra.active AND ra.valid_from <= now() AND now() < ra.valid_to
                  AND ra.role IN ('manufacturer', 'agency', 'sda', 'laboratory'))
     OR NOT EXISTS (SELECT 1 FROM user_account u WHERE u.id = d.delegate_id AND u.status = 'active')
     OR NOT EXISTS (SELECT 1 FROM role_assignment ra WHERE ra.user_id = d.delegate_id AND ra.active AND ra.valid_from <= now() AND now() < ra.valid_to)
     OR NOT EXISTS (SELECT 1 FROM organisation_membership a JOIN organisation_membership b ON b.organisation_id = a.organisation_id
                     WHERE a.user_id = d.delegator_id AND b.user_id = d.delegate_id AND a.active AND b.active
                       AND a.valid_from <= now() AND now() < a.valid_to AND b.valid_from <= now() AND now() < b.valid_to) THEN
    RETURN QUERY SELECT 'not_eligible'::text;
    RETURN;
  END IF;
  UPDATE delegation SET state = 'approved', decided_by = p_actor, decided_at = now(), decision_note = p_note WHERE id = d.id;
  INSERT INTO delegation_event (delegation_id, action, actor_account_id, note) VALUES (d.id, 'approved', p_actor, p_note);
  RETURN QUERY SELECT 'approved'::text;
END $$;

-- Registration review: director_approval stage is acted by role officer (succession from former Director persona).
-- registration_transition_event is append-only: past rows keep the actor role recorded at the time.

CREATE OR REPLACE FUNCTION registration_return_response_assert_stage_actor(
  p_from_stage text, p_actor_role text, p_actor_account uuid, p_valid_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_required_role text;
BEGIN
  v_required_role := CASE p_from_stage
    WHEN 'programme_review' THEN 'programme'
    WHEN 'director_approval' THEN 'officer'
    ELSE NULL END;
  IF v_required_role IS NULL OR p_actor_role IS DISTINCT FROM v_required_role THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_stage_role_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM user_account u
    JOIN role_assignment ra ON ra.user_id = u.id
     WHERE u.id = p_actor_account AND u.status = 'active'
       AND ra.role = v_required_role AND ra.active AND ra.valid_from <= p_valid_at AND p_valid_at < ra.valid_to
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_stage_role_mismatch';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION registration_return_response_assert_officer_recipient(
  p_return_id uuid,
  p_application_id uuid,
  p_valid_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_stage text;
  v_officer uuid;
  v_required_role text;
BEGIN
  SELECT returned_from_state, returned_by_account_id INTO v_stage, v_officer
    FROM registration_application_return WHERE id = p_return_id AND application_id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_return_mismatch';
  END IF;
  v_required_role := CASE v_stage WHEN 'programme_review' THEN 'programme' WHEN 'director_approval' THEN 'officer' ELSE NULL END;
  IF v_required_role IS NULL OR NOT EXISTS (
    SELECT 1 FROM user_account u
    JOIN role_assignment ra ON ra.user_id = u.id
     WHERE u.id = v_officer AND u.status = 'active'
       AND ra.role = v_required_role AND ra.active AND ra.valid_from <= p_valid_at AND p_valid_at < ra.valid_to
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'notification_recipient_inactive';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION registration_approve(p_application uuid, p_actor uuid, p_version integer, p_note text)
RETURNS TABLE (out_state text, out_version integer, out_brand uuid, out_authorisation uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  a        registration_application%ROWTYPE;
  holds    boolean;
  v_brand  uuid;
  v_auth   uuid;
  v_event  uuid := gen_random_uuid();
  v_after  integer;
  today    date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  SELECT * INTO a FROM registration_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state <> 'director_approval' THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM role_assignment ra JOIN capability_grant g ON g.role = ra.role AND g.capability = 'registration_approve'
                  WHERE ra.user_id = p_actor AND ra.active AND ra.scope = 'all' AND ra.valid_from <= now() AND now() < ra.valid_to) INTO holds;
  IF NOT holds THEN
    RETURN QUERY SELECT 'not_permitted'::text, NULL::integer, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  IF a.version <> p_version THEN
    RETURN QUERY SELECT 'version_conflict'::text, NULL::integer, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM registration_submission_event e WHERE e.application_id = a.id AND e.actor_account_id = p_actor)
     OR EXISTS (SELECT 1 FROM registration_transition_event t WHERE t.application_id = a.id AND t.action = 'recommend' AND t.actor_account_id = p_actor)
     OR EXISTS (SELECT 1 FROM organisation_membership m WHERE m.active AND m.user_id = p_actor AND m.organisation_id = a.organisation_id) THEN
    RETURN QUERY SELECT 'segregation_refused'::text, NULL::integer, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  BEGIN
    IF a.kind = 'brand' THEN
      PERFORM pg_advisory_xact_lock(hashtext(current_schema() || '.brand'), hashtext(lower(btrim(a.brand_name))));
      IF EXISTS (SELECT 1 FROM brand b WHERE lower(btrim(b.name)) = lower(btrim(a.brand_name)) AND b.status <> 'revoked') THEN
        RETURN QUERY SELECT 'brand_name_taken'::text, NULL::integer, NULL::uuid, NULL::uuid;
        RETURN;
      END IF;
      INSERT INTO brand (name, owner_organisation_id, status, source_reference, verification_status, note)
      VALUES (btrim(a.brand_name), a.organisation_id, 'active', a.reference, 'provisional',
              'Registered through ' || a.reference || ' (provisional local rule, not a BEE rule).')
      RETURNING id INTO v_brand;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM brand b WHERE b.id = a.brand_id AND b.status = 'active' AND b.owner_organisation_id = a.principal_organisation_id) THEN
        RETURN QUERY SELECT 'brand_not_permitted'::text, NULL::integer, NULL::uuid, NULL::uuid;
        RETURN;
      END IF;
      IF a.valid_to IS NOT NULL AND a.valid_to <= today THEN
        RETURN QUERY SELECT 'period_passed'::text, NULL::integer, NULL::uuid, NULL::uuid;
        RETURN;
      END IF;
      INSERT INTO agency_authorisation (agency_organisation_id, principal_organisation_id, brand_id, valid_from, valid_to, status,
                                        source_reference, verification_status, note)
      VALUES (a.organisation_id, a.principal_organisation_id, a.brand_id, a.valid_from, a.valid_to, 'active', a.reference, 'provisional',
              'Authorised through ' || a.reference || ' (provisional local rule, not a BEE rule).')
      RETURNING id INTO v_auth;
    END IF;
  EXCEPTION WHEN SQLSTATE '23P01' OR SQLSTATE '23505' THEN
    RETURN QUERY SELECT CASE WHEN a.kind = 'brand' THEN 'brand_name_taken' ELSE 'authorisation_overlap' END::text, NULL::integer, NULL::uuid, NULL::uuid;
    RETURN;
  END;

  INSERT INTO register_status_event (brand_id, authorisation_id, from_status, to_status, valid_to_after, source, registration_id, actor_account_id, reason)
  VALUES (v_brand, v_auth, NULL, 'active', CASE WHEN v_auth IS NULL THEN NULL ELSE a.valid_to END, 'registration', a.id, p_actor, nullif(btrim(p_note), ''));
  v_after := a.version + 1;
  UPDATE registration_application SET state = 'approved', version = v_after, registered_brand_id = v_brand, registered_authorisation_id = v_auth
   WHERE id = a.id;
  INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, note)
  VALUES (v_event, a.id, 'approve', 'director_approval', 'approved', p_actor, 'officer', v_after, nullif(btrim(p_note), ''));
  RETURN QUERY SELECT 'approved'::text, v_after, v_brand, v_auth;
END $$;

-- Demo registration messages: notify role officer at director_approval (not the Spring role name director).
CREATE OR REPLACE FUNCTION demo_message_on_registration_step() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  r record;
  note text;
BEGIN
  IF current_setting('bee.demo_seeding', true) = 'on' THEN
    RETURN NEW;
  END IF;
  SELECT reg.reference, reg.brand_name, reg.kind, reg.organisation_id, o.legal_name INTO r
    FROM registration_application reg JOIN organisation o ON o.id = reg.organisation_id WHERE reg.id = NEW.application_id;
  IF r.reference IS NULL THEN
    RETURN NEW;
  END IF;
  note := COALESCE(NEW.note, '');
  IF NEW.action = 'confirm_fee' THEN
    PERFORM demo_message_org(r.organisation_id, 'registration_fee_confirmed', r.reference, 'Registration fee confirmed: ' || r.reference,
      'BEE Finance confirmed the fee for ' || r.reference || ' (' || r.brand_name || '). The request is now with the Programme officer. Simulated message: nothing was sent.',
      'BEE demo: fee confirmed for registration ' || r.reference || '.');
    PERFORM demo_message_role('programme', 'registration_to_review', r.reference, 'Registration to review: ' || r.reference,
      r.legal_name || ' registration ' || r.reference || ' (' || r.brand_name || ') is ready for programme review. Open Registration reviews. Simulated message: nothing was sent.', NULL);
  ELSIF NEW.action = 'recommend' THEN
    PERFORM demo_message_org(r.organisation_id, 'registration_recommended', r.reference, 'Registration recommended: ' || r.reference,
      'The Programme officer recommended ' || r.reference || ' (' || r.brand_name || '). It now waits for the Director. Simulated message: nothing was sent.',
      'BEE demo: registration ' || r.reference || ' was recommended and waits for the Director.');
    PERFORM demo_message_role('officer', 'registration_to_approve', r.reference, 'Registration to approve: ' || r.reference,
      r.legal_name || ' registration ' || r.reference || ' (' || r.brand_name || ') is recommended and waits for your decision. Open Registration reviews. Simulated message: nothing was sent.', NULL);
  ELSIF NEW.action = 'return' THEN
    PERFORM demo_message_org(r.organisation_id, 'registration_returned', r.reference, 'Registration returned to you: ' || r.reference,
      r.reference || ' (' || r.brand_name || ') was returned for changes: ' || note || ' Edit it and send it again. Simulated message: nothing was sent.',
      'BEE demo: registration ' || r.reference || ' was returned for changes.');
  ELSIF NEW.action = 'reject' THEN
    PERFORM demo_message_org(r.organisation_id, 'registration_rejected', r.reference, 'Registration rejected: ' || r.reference,
      r.reference || ' (' || r.brand_name || ') was rejected: ' || note || ' Simulated message: nothing was sent.',
      'BEE demo: registration ' || r.reference || ' was rejected.');
  ELSIF NEW.action = 'approve' THEN
    PERFORM demo_message_org(r.organisation_id, 'registration_approved', r.reference, 'Registration approved: ' || r.reference,
      r.reference || ' (' || r.brand_name || ') was approved by the Director and is now on the register. Simulated message: nothing was sent.',
      'BEE demo: registration ' || r.reference || ' was approved. You are on the register.');
  ELSIF NEW.action = 'resubmit' THEN
    PERFORM demo_message_role('programme', 'registration_resubmitted', r.reference, 'Registration sent again: ' || r.reference,
      r.legal_name || ' sent ' || r.reference || ' (' || r.brand_name || ') again after a return. Open Registration reviews. Simulated message: nothing was sent.', NULL);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION demo_message_on_register_proposal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  label text;
  owner_org uuid;
  what text;
BEGIN
  IF current_setting('bee.demo_seeding', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.target_brand_id IS NOT NULL THEN
    SELECT b.name, b.owner_organisation_id INTO label, owner_org FROM brand b WHERE b.id = NEW.target_brand_id;
  ELSE
    SELECT b.name || ' (agency authorisation)', a.principal_organisation_id INTO label, owner_org
      FROM agency_authorisation a JOIN brand b ON b.id = a.brand_id WHERE a.id = NEW.target_authorisation_id;
  END IF;
  what := CASE NEW.action WHEN 'close' THEN 'closure' ELSE 'revocation' END;
  IF TG_OP = 'INSERT' THEN
    PERFORM demo_message_role('officer', 'register_to_decide', label, 'Register ' || what || ' to decide: ' || COALESCE(label, ''),
      'A ' || what || ' of ' || COALESCE(label, 'a register entry') || ' was proposed: ' || NEW.reason || ' Open Register and approve or reject it. A different person from the proposer decides. Simulated message: nothing was sent.', NULL, NEW.proposed_by);
  ELSIF OLD.state = 'pending' AND NEW.state <> 'pending' THEN
    PERFORM demo_message_send(NEW.proposed_by, 'register_decided', label, 'Register ' || what || ' ' || NEW.state || ': ' || COALESCE(label, ''),
      'Your proposed ' || what || ' of ' || COALESCE(label, 'a register entry') || ' was ' || NEW.state || '.' || COALESCE(' Note: ' || NEW.decision_note, '') || ' Simulated message: nothing was sent.',
      'BEE demo: your proposed ' || what || ' of ' || COALESCE(label, 'a register entry') || ' was ' || NEW.state || '.');
    IF NEW.state = 'approved' AND owner_org IS NOT NULL THEN
      PERFORM demo_message_org(owner_org, 'register_entry_closed', label, 'Register entry ' || CASE NEW.action WHEN 'close' THEN 'closed: ' ELSE 'revoked: ' END || COALESCE(label, ''),
        COALESCE(label, 'A register entry') || ' was ' || CASE NEW.action WHEN 'close' THEN 'closed' ELSE 'revoked' END || ' on the BEE register: ' || NEW.reason || ' Simulated message: nothing was sent.',
        'BEE demo: ' || COALESCE(label, 'a register entry') || ' was ' || CASE NEW.action WHEN 'close' THEN 'closed' ELSE 'revoked' END || ' on the register.');
    END IF;
  END IF;
  RETURN NEW;
END $$;


-- Registration return resubmit wiring: task owner at director_approval is role officer.
CREATE OR REPLACE FUNCTION registration_return_response_orchestrate_resubmit(
  p_application_id uuid,
  p_return_id uuid,
  p_resubmission_id uuid,
  p_transition_event_id uuid,
  p_returned_from_stage text,
  p_returned_at timestamptz,
  p_return_reason text,
  p_resumed_stage text,
  p_response_body text,
  p_resubmitted_at timestamptz,
  p_responded_by uuid,
  p_responded_role text,
  p_wiring_command_id uuid,
  p_wiring_payload_hash char(64),
  p_notify_command_id uuid,
  p_task_command_id uuid,
  p_task_payload_hash char(64),
  p_task_owner_role text,
  p_task_owner_account uuid,
  p_due_at timestamptz,
  p_policy_version_id uuid,
  p_actor_account uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_prior registration_return_response_wiring_evidence;
  v_cycle registration_return_response_cycle;
  v_task_id uuid;
  v_discrepancy_id uuid;
  v_clock_id uuid;
  v_notify_hash char(64);
  v_recipient uuid;
  v_persisted_resub uuid;
  v_computed_due timestamptz;
  v_computed_wiring_hash char(64);
BEGIN
  PERFORM workflow_validate_subject('registration_application', p_application_id);
  v_computed_wiring_hash := registration_return_response_wiring_resubmit_hash(
    p_application_id, p_return_id, p_resubmission_id, p_transition_event_id, p_returned_from_stage, p_returned_at, p_return_reason,
    p_resumed_stage, p_response_body, p_resubmitted_at, p_responded_by, p_responded_role, p_notify_command_id, p_task_command_id, p_task_payload_hash,
    p_task_owner_role, p_task_owner_account, p_due_at, p_policy_version_id, p_actor_account);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_wiring_command_id::text, 0));
  SELECT * INTO v_prior FROM registration_return_response_wiring_evidence WHERE command_id = p_wiring_command_id;
  IF FOUND THEN
    IF v_prior.payload_hash IS DISTINCT FROM v_computed_wiring_hash
       OR v_prior.application_id IS DISTINCT FROM p_application_id
       OR v_prior.purpose IS DISTINCT FROM 'registration_resubmit_wiring' THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'registration_return_response_wiring_idempotency_conflict';
    END IF;
    SELECT id INTO v_persisted_resub FROM registration_application_resubmission
     WHERE application_id = p_application_id AND transition_event_id = p_transition_event_id AND id = p_resubmission_id;
    IF v_persisted_resub IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_replay_incomplete';
    END IF;
    RETURN;
  END IF;
  IF p_wiring_payload_hash IS DISTINCT FROM v_computed_wiring_hash THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'registration_return_response_wiring_idempotency_conflict';
  END IF;
  PERFORM registration_return_response_assert_resubmit_transition(
    p_application_id, p_transition_event_id, p_responded_by, p_resubmitted_at, p_responded_role);
  IF NOT EXISTS (SELECT 1 FROM registration_application a WHERE a.id = p_application_id AND a.state = 'programme_review') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_application_state_mismatch';
  END IF;
  PERFORM registration_return_response_assert_return_row_facts(
    p_return_id, p_application_id, p_returned_from_stage, p_returned_at, p_return_reason);
  PERFORM registration_return_response_assert_officer_recipient(p_return_id, p_application_id, p_resubmitted_at);
  IF p_actor_account IS DISTINCT FROM p_responded_by THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_actor_mismatch';
  END IF;
  IF p_resumed_stage IS DISTINCT FROM 'programme_review' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_resumed_stage_invalid';
  END IF;
  v_computed_due := workflow_sla_due_at_end_of_working_days(p_policy_version_id, p_returned_at);
  IF p_due_at IS DISTINCT FROM v_computed_due THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_due_at_mismatch';
  END IF;
  IF p_policy_version_id IS DISTINCT FROM registration_return_response_applicable_policy_id(p_returned_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_policy_mismatch';
  END IF;
  IF p_task_owner_account IS DISTINCT FROM (
    SELECT returned_by_account_id FROM registration_application_return WHERE id = p_return_id)
     OR p_task_owner_role IS DISTINCT FROM (
    SELECT CASE returned_from_state WHEN 'programme_review' THEN 'programme' WHEN 'director_approval' THEN 'officer' END
      FROM registration_application_return WHERE id = p_return_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_task_owner_mismatch';
  END IF;
  SELECT * INTO v_cycle FROM registration_return_response_cycle WHERE application_id = p_application_id AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN
    v_task_id := workflow_foundation_create_task(
      'registration_application', p_application_id, p_returned_from_stage, 'review', p_task_owner_role, p_task_owner_account,
      p_task_command_id, p_task_payload_hash, p_due_at, p_policy_version_id, p_returned_at, p_actor_account, p_responded_role);
    INSERT INTO workflow_discrepancy (subject_kind, subject_id, line_code, summary, opened_by)
    VALUES ('registration_application', p_application_id, 'return_response', p_return_reason, p_task_owner_account)
    RETURNING id INTO v_discrepancy_id;
    PERFORM registration_return_response_link_cycle(p_application_id, p_returned_from_stage, v_task_id, v_discrepancy_id);
    SELECT id INTO v_clock_id FROM workflow_sla_clock WHERE task_id = v_task_id;
    PERFORM workflow_foundation_append_clock_event(v_clock_id, 'start', 'bureau', p_returned_at, NULL);
    PERFORM workflow_foundation_append_clock_event(v_clock_id, 'pause', 'applicant', p_returned_at + interval '1 millisecond', NULL);
    SELECT * INTO v_cycle FROM registration_return_response_cycle WHERE application_id = p_application_id AND status = 'open';
    IF NOT EXISTS (SELECT 1 FROM registration_return_response_cycle_return WHERE cycle_id = v_cycle.id AND return_id = p_return_id) THEN
      PERFORM registration_return_response_bind_cycle_return(v_cycle.id, p_return_id);
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM registration_return_response_cycle_return WHERE cycle_id = v_cycle.id AND return_id = p_return_id) THEN
    IF EXISTS (SELECT 1 FROM registration_return_response_cycle_return WHERE return_id = p_return_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_return_cycle_mismatch';
    END IF;
    PERFORM registration_return_response_bind_cycle_return(v_cycle.id, p_return_id);
  END IF;
  IF p_return_id IS DISTINCT FROM registration_return_response_latest_cycle_return(v_cycle.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_return_cycle_mismatch';
  END IF;
  PERFORM registration_return_response_insert_resubmission(
    p_resubmission_id, p_application_id, p_transition_event_id, p_return_id, p_responded_by);
  PERFORM registration_return_response_update_last_resumed_stage(p_application_id, p_resubmission_id, p_resumed_stage);
  PERFORM registration_return_response_append_response(v_cycle.discrepancy_id, p_response_body, p_responded_by);
  SELECT id INTO v_clock_id FROM workflow_sla_clock WHERE task_id = v_cycle.task_id;
  PERFORM workflow_foundation_append_clock_event(v_clock_id, 'resume', 'applicant', p_resubmitted_at + interval '1 millisecond', NULL);
  PERFORM registration_return_response_officer_resubmit_notify(
    p_notify_command_id, p_application_id, p_return_id, p_resubmission_id, p_resumed_stage, p_actor_account);
  v_recipient := registration_return_response_resolve_officer(p_application_id, p_return_id);
  v_notify_hash := encode(
    sha256(convert_to('registration_application|' || p_application_id::text || '|applicant_resubmitted|' || p_return_id::text || '|' || p_resumed_stage || '|' || v_recipient::text, 'UTF8')),
    'hex');
  PERFORM registration_return_response_record_wiring_evidence(p_wiring_command_id, p_application_id, 'registration_resubmit_wiring', v_computed_wiring_hash);
  PERFORM registration_return_response_record_wiring_evidence(p_notify_command_id, p_application_id, 'registration_resubmit_notify', v_notify_hash);
END $$;

-- Ledger demo messages: notify Spring role director (succession from secretary persona).
CREATE OR REPLACE FUNCTION demo_message_on_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  c record;
  k text;
  w text;
  sub uuid;
BEGIN
  IF demo_seeding_on() THEN
    RETURN NEW;
  END IF;
  SELECT cert.registration_id, a.organisation_id INTO c
    FROM certificate cert JOIN model_application a ON a.id = cert.application_id WHERE cert.id = NEW.certificate_id;
  IF c.registration_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.action IN ('submit', 'amend', 'revoke', 'retry') THEN
    w := CASE NEW.action WHEN 'submit' THEN 'issue' WHEN 'retry' THEN 'issue (tried again)' WHEN 'amend' THEN 'amendment' ELSE 'revocation' END;
    PERFORM demo_message_role('director', 'ledger_to_sign', c.registration_id, 'Second signature needed: ' || c.registration_id,
      'The ' || w || ' of certificate ' || c.registration_id || ' is waiting on the simulated ledger. A different person from the one who sent it must commit it. Simulated message: nothing was sent.', NULL, NEW.actor_account_id);
    PERFORM demo_message_role('admin', 'ledger_to_sign', c.registration_id, 'Second signature needed: ' || c.registration_id,
      'The ' || w || ' of certificate ' || c.registration_id || ' is waiting on the simulated ledger. A different person from the one who sent it must commit it. Simulated message: nothing was sent.', NULL, NEW.actor_account_id);
    PERFORM demo_message_role('programme', 'ledger_to_sign', c.registration_id, 'Second signature needed: ' || c.registration_id,
      'The ' || w || ' of certificate ' || c.registration_id || ' is waiting on the simulated ledger. A different person from the one who sent it must commit it. Simulated message: nothing was sent.', NULL, NEW.actor_account_id);
  ELSIF NEW.action = 'commit' THEN
    SELECT kind INTO k FROM ledger_tx WHERE id = NEW.tx_id;
    PERFORM demo_message_org(c.organisation_id, 'ledger_committed', c.registration_id,
      CASE k WHEN 'revoke' THEN 'Certificate revoked: ' WHEN 'amend' THEN 'Certificate amended: ' ELSE 'Certificate on the ledger: ' END || c.registration_id,
      'Certificate ' || c.registration_id || CASE k WHEN 'revoke' THEN ' was revoked on the simulated Fabric ledger.' WHEN 'amend' THEN ' was amended on the simulated Fabric ledger.'
        ELSE ' is recorded on the simulated Fabric ledger.' END || ' Anyone can check it on the public verification page. Simulated message: nothing was sent.',
      'BEE demo: certificate ' || c.registration_id || CASE k WHEN 'revoke' THEN ' was revoked.' WHEN 'amend' THEN ' was amended.' ELSE ' is now on the ledger.' END);
  ELSIF NEW.action = 'fail' THEN
    SELECT submitted_by INTO sub FROM ledger_tx WHERE id = NEW.tx_id;
    PERFORM demo_message_role('admin', 'ledger_failed', c.registration_id, 'Ledger transaction failed: ' || c.registration_id,
      'The simulated ledger transaction for ' || c.registration_id || ' failed and can be retried. Simulated message: nothing was sent.', NULL);
    PERFORM demo_message_role('director', 'ledger_failed', c.registration_id, 'Ledger transaction failed: ' || c.registration_id,
      'The simulated ledger transaction for ' || c.registration_id || ' failed and can be retried. Simulated message: nothing was sent.', NULL);
    -- the person who sent it is told too, whatever their role
    IF sub IS NOT NULL THEN
      PERFORM demo_message_send(sub, 'ledger_failed', c.registration_id, 'Ledger transaction failed: ' || c.registration_id,
        'The simulated ledger transaction you sent for ' || c.registration_id || ' failed and can be retried. Simulated message: nothing was sent.', NULL);
    END IF;
  END IF;
  RETURN NEW;
END $$;


-- Pin search_path on V78 SECURITY DEFINER replacements (schema, pg_catalog, pg_temp last).
DO $$
DECLARE home_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.delegation_decide(uuid, uuid, text, text) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_approve(uuid, uuid, integer, text) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_assert_stage_actor(text, text, uuid, timestamptz) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_assert_officer_recipient(uuid, uuid, timestamptz) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_orchestrate_resubmit(uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, timestamptz, uuid, text, uuid, char(64), uuid, uuid, char(64), text, uuid, timestamptz, uuid, uuid) SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.demo_message_on_registration_step() SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.demo_message_on_register_proposal() SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.demo_message_on_ledger() SET search_path = %I, pg_catalog, pg_temp', home_schema, home_schema);
END $$;

-- ===== Manufacturer onboarding (V75 to V78 guest registration): the operational approver is now the officer =====
-- V75 to V78 record the operational approver (approve, return, reject, hold clearance, revocation, observation close, fan-out to staff) as role 'director'.
-- After this migration that role name means the final model authority (the former Secretary), so every such literal becomes 'officer'.
-- Capability grants already move with the role rename above (manufacturer_onboarding_director and manufacturer_onboarding_anomaly pass from director to officer).
-- Event names (director_approve and so on), stages (director_review) and past event rows are unchanged; past rows keep the role that was current when they were written.
UPDATE manufacturer_onboarding_anomaly SET raised_by_role = 'officer' WHERE raised_by_role = 'director';
ALTER TABLE manufacturer_onboarding_anomaly DROP CONSTRAINT IF EXISTS manufacturer_onboarding_anomaly_raised_by_role_check;
ALTER TABLE manufacturer_onboarding_anomaly ADD CONSTRAINT manufacturer_onboarding_anomaly_raised_by_role_check CHECK (raised_by_role IN ('finance', 'programme', 'officer'));

-- manufacturer_onboarding_assert_anomaly_actor (last defined in V75)
CREATE OR REPLACE FUNCTION manufacturer_onboarding_assert_anomaly_actor(p_actor uuid, p_actor_role text)
RETURNS void LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_account u WHERE u.id = p_actor AND u.status = 'active') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'no_active_account';
  END IF;
  IF p_actor_role NOT IN ('finance', 'programme', 'officer') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'not_permitted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM role_assignment ra JOIN capability_grant g ON g.role = ra.role AND g.capability = 'manufacturer_onboarding_anomaly'
                  WHERE ra.user_id = p_actor AND ra.active AND ra.role = p_actor_role) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'not_permitted';
  END IF;
END $$;

-- manufacturer_onboarding_orchestrate_director_decision (last defined in V78)
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
    VALUES (p_application, 'director_return', 'director_review', 'returned', p_actor, 'officer', note);
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
    VALUES (p_application, 'director_reject', 'director_review', 'rejected', p_actor, 'officer', note);
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
  VALUES (ev, p_application, 'director_approve', 'director_review', 'active_observation', p_actor, 'officer',
    coalesce(note, 'Director approved; manufacturer activated for 15-day observation.'), approved_at);
  PERFORM notification_foundation_deliver(notify_id, notify_hash,
    'manufacturer_onboarding_application', p_application, 'manufacturer_onboarding_information',
    'Director approved; permittee in observation.', p_actor);
  INSERT INTO manufacturer_onboarding_command_evidence
    (command_id, application_id, purpose, payload_hash, result_state, result_version, result_permittee_number)
  VALUES (p_command_id, p_application, 'director_decision', canonical, 'active_observation', v_after, pt);
  RETURN QUERY SELECT 'active_observation'::text, v_after, pt;
END $$;

-- manufacturer_onboarding_orchestrate_resolve_anomaly (last defined in V77)
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
    VALUES (p_application, 'director_revoke', 'on_hold', 'revoked', p_actor, 'officer', p_note);
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
  VALUES (p_application, 'anomaly_cleared', 'on_hold', resume, p_actor, 'officer', p_note);
  INSERT INTO manufacturer_onboarding_command_evidence
    (command_id, application_id, purpose, payload_hash, result_state, result_version)
  VALUES (p_command_id, p_application, 'resolve_anomaly', canonical, resume, v_after);
  RETURN QUERY SELECT resume, v_after;
END $$;

-- manufacturer_onboarding_maint_observation_close_as_of (last defined in V75)
CREATE OR REPLACE FUNCTION manufacturer_onboarding_maint_observation_close_as_of(
  p_application uuid, p_as_of date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE a manufacturer_onboarding_application%ROWTYPE;
  cmd uuid := gen_random_uuid();
  dir uuid;
  canonical char(64);
BEGIN
  IF current_user <> 'bee_local_maint' AND session_user <> 'bee_local_maint' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'maint_only';
  END IF;
  SELECT id INTO dir FROM user_account WHERE username = 'bee.director' LIMIT 1;
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application;
  IF NOT FOUND OR a.state <> 'active_observation' THEN RETURN 'not_found'; END IF;
  IF p_as_of < a.observation_ends_on THEN RETURN 'observation_not_ended'; END IF;
  canonical := manufacturer_onboarding_canonical_hash(ARRAY[
    'observation_close', p_application::text, dir::text, 'officer', a.version::text]);
  PERFORM manufacturer_onboarding_orchestrate_observation_close(
    p_application, dir, 'officer', a.version, cmd, canonical);
  RETURN 'active';
END $$;

-- manufacturer_onboarding_maint_close_expired_observations (last defined in V75)
CREATE OR REPLACE FUNCTION manufacturer_onboarding_maint_close_expired_observations(p_as_of date DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE r record; n integer := 0; today date := coalesce(p_as_of, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  cmd uuid; hash char(64); dir uuid;
BEGIN
  IF current_user <> 'bee_local_maint' AND session_user <> 'bee_local_maint' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'maint_only';
  END IF;
  SELECT id INTO dir FROM user_account WHERE username = 'bee.director' LIMIT 1;
  FOR r IN SELECT a.id, a.version FROM manufacturer_onboarding_application a
    WHERE a.state = 'active_observation' AND a.observation_ends_on <= today
      AND NOT EXISTS (SELECT 1 FROM manufacturer_onboarding_anomaly an WHERE an.application_id = a.id AND an.resolved_at IS NULL)
    FOR UPDATE LOOP
    cmd := gen_random_uuid();
    hash := manufacturer_onboarding_canonical_hash(ARRAY[
      'observation_close', r.id::text, dir::text, 'officer', r.version::text]);
    PERFORM manufacturer_onboarding_orchestrate_observation_close(r.id, dir, 'officer', r.version, cmd, hash);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- notification_foundation_fan_out (last defined in V77)
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
       WHERE ra.active AND u.status = 'active' AND ra.role IN ('finance', 'programme', 'officer') AND ra.scope = 'all';
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

-- Pin search_path (schema, pg_catalog, pg_temp last) on the onboarding functions redefined above.
DO $$
DECLARE
  home_schema text := current_schema();
  f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = to_regnamespace(home_schema) AND p.prosecdef
            AND p.proname IN ('manufacturer_onboarding_assert_anomaly_actor', 'manufacturer_onboarding_orchestrate_director_decision',
                              'manufacturer_onboarding_orchestrate_resolve_anomaly', 'manufacturer_onboarding_maint_observation_close_as_of',
                              'manufacturer_onboarding_maint_close_expired_observations', 'notification_foundation_fan_out') LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = %I, pg_catalog, pg_temp', f, home_schema);
  END LOOP;
END $$;
