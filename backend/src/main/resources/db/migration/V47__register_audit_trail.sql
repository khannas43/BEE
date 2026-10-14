-- WP04.3 (package review of WP04, 14 October 2026): the register's own audit trail, a revoked brand's name can be registered again, and
-- approval refuses an agency period that has already ended (BL-177).
--
-- register_status_event is append-only. One row for every change of the register: a brand or an authorisation registered through an
-- approved request (from NULL to active), revoked (with the cascaded authorisations of a revoked brand, one row each), or closed on a date
-- (status unchanged, valid_to before and after). It names the actor, the time, the request or proposal behind it and the reason.
-- Provisional local rules, not BEE rules.

CREATE TABLE register_status_event (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         uuid REFERENCES brand (id),
  authorisation_id uuid REFERENCES agency_authorisation (id),
  from_status      text,
  to_status        text NOT NULL,
  valid_to_before  date,
  valid_to_after   date,
  source           text NOT NULL CHECK (source IN ('registration', 'revocation')),
  registration_id  uuid REFERENCES registration_application (id),
  proposal_id      uuid REFERENCES register_revocation_proposal (id),
  cascaded         boolean NOT NULL DEFAULT false,
  actor_account_id uuid NOT NULL REFERENCES user_account (id),
  reason           text,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((brand_id IS NULL) <> (authorisation_id IS NULL)),
  CHECK ((source = 'registration') = (registration_id IS NOT NULL)),
  CHECK ((source = 'revocation') = (proposal_id IS NOT NULL))
);
CREATE INDEX register_status_event_brand ON register_status_event (brand_id, occurred_at) WHERE brand_id IS NOT NULL;
CREATE INDEX register_status_event_authorisation ON register_status_event (authorisation_id, occurred_at) WHERE authorisation_id IS NOT NULL;
CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON register_status_event FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON register_status_event FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change();

-- A revoked brand frees its name: uniqueness among live brands only, ignoring case and surrounding space (as the registration rules do).
ALTER TABLE brand DROP CONSTRAINT brand_owner_organisation_id_name_key;
CREATE UNIQUE INDEX brand_owner_name_live ON brand (owner_organisation_id, lower(btrim(name))) WHERE status <> 'revoked';

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
  VALUES (v_event, a.id, 'approve', 'director_approval', 'approved', p_actor, 'director', v_after, nullif(btrim(p_note), ''));
  RETURN QUERY SELECT 'approved'::text, v_after, v_brand, v_auth;
END $$;

CREATE OR REPLACE FUNCTION register_revocation_decide(p_proposal uuid, p_decider uuid, p_decision text, p_note text)
RETURNS TABLE (out_state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  p      register_revocation_proposal%ROWTYPE;
  today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  holds  boolean;
  a      agency_authorisation%ROWTYPE;
  b      brand%ROWTYPE;
BEGIN
  IF p_decision NOT IN ('approve', 'reject', 'withdraw') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'validation_failed';
  END IF;
  SELECT * INTO p FROM register_revocation_proposal WHERE id = p_proposal FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text;
    RETURN;
  END IF;
  IF p.state <> 'pending' THEN
    RETURN QUERY SELECT 'not_pending'::text;
    RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM role_assignment ra JOIN capability_grant g ON g.role = ra.role
                  AND g.capability = CASE WHEN p_decision = 'withdraw' THEN 'register_revoke_propose' ELSE 'register_revoke_decide' END
                  WHERE ra.user_id = p_decider AND ra.active AND ra.scope = 'all' AND ra.valid_from <= now() AND now() < ra.valid_to) INTO holds;
  IF NOT holds THEN
    RETURN QUERY SELECT 'not_permitted'::text;
    RETURN;
  END IF;

  IF p_decision = 'withdraw' THEN
    IF p_decider <> p.proposed_by THEN
      RETURN QUERY SELECT 'only_proposer'::text;
      RETURN;
    END IF;
    UPDATE register_revocation_proposal SET state = 'withdrawn', decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
    RETURN QUERY SELECT 'withdrawn'::text;
    RETURN;
  END IF;

  IF p_decider = p.proposed_by THEN
    RETURN QUERY SELECT 'same_person'::text;
    RETURN;
  END IF;
  IF p_decision = 'reject' THEN
    UPDATE register_revocation_proposal SET state = 'rejected', decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
    RETURN QUERY SELECT 'rejected'::text;
    RETURN;
  END IF;

  IF p.target_brand_id IS NOT NULL THEN
    SELECT * INTO b FROM brand WHERE id = p.target_brand_id FOR UPDATE;
    IF NOT FOUND OR b.status <> 'active' THEN
      RETURN QUERY SELECT 'rule_conflict'::text;
      RETURN;
    END IF;
    INSERT INTO register_status_event (authorisation_id, from_status, to_status, valid_to_before, valid_to_after, source, proposal_id, cascaded, actor_account_id, reason)
      SELECT x.id, 'active', 'revoked', x.valid_to, x.valid_to, 'revocation', p.id, true, p_decider, p.reason
        FROM agency_authorisation x WHERE x.brand_id = b.id AND x.status = 'active';
    UPDATE agency_authorisation SET status = 'revoked' WHERE brand_id = b.id AND status = 'active';
    INSERT INTO register_status_event (brand_id, from_status, to_status, source, proposal_id, actor_account_id, reason)
    VALUES (b.id, 'active', 'revoked', 'revocation', p.id, p_decider, p.reason);
    UPDATE brand SET status = 'revoked' WHERE id = b.id;
  ELSE
    SELECT * INTO a FROM agency_authorisation WHERE id = p.target_authorisation_id FOR UPDATE;
    IF NOT FOUND OR a.status <> 'active' THEN
      RETURN QUERY SELECT 'rule_conflict'::text;
      RETURN;
    END IF;
    IF p.action = 'revoke' THEN
      INSERT INTO register_status_event (authorisation_id, from_status, to_status, valid_to_before, valid_to_after, source, proposal_id, actor_account_id, reason)
      VALUES (a.id, 'active', 'revoked', a.valid_to, a.valid_to, 'revocation', p.id, p_decider, p.reason);
      UPDATE agency_authorisation SET status = 'revoked' WHERE id = a.id;
    ELSE
      IF p.close_on < today THEN
        RETURN QUERY SELECT 'date_passed'::text;
        RETURN;
      END IF;
      IF p.close_on <= a.valid_from OR (a.valid_to IS NOT NULL AND p.close_on >= a.valid_to) THEN
        RETURN QUERY SELECT 'rule_conflict'::text;
        RETURN;
      END IF;
      INSERT INTO register_status_event (authorisation_id, from_status, to_status, valid_to_before, valid_to_after, source, proposal_id, actor_account_id, reason)
      VALUES (a.id, 'active', 'active', a.valid_to, p.close_on, 'revocation', p.id, p_decider, p.reason);
      UPDATE agency_authorisation SET valid_to = p.close_on WHERE id = a.id;
    END IF;
  END IF;
  UPDATE register_revocation_proposal SET state = 'approved', decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
  RETURN QUERY SELECT 'approved'::text;
END $$;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.register_status_event TO bee_local_maint', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT SELECT ON %I.register_status_event TO bee_runtime', home_schema);
  END IF;
END $$;
