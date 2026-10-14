-- WP04.2b-2 review fixes (V44 is applied locally and is not edited): the database repeats the organisation rule for recommend, return and
-- reject, and the approval function checks the role's scope and validity period exactly as the service does.
CREATE OR REPLACE FUNCTION registration_transition_event_segregation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action IN ('recommend', 'approve', 'return', 'reject') THEN
    IF EXISTS (SELECT 1 FROM registration_submission_event e WHERE e.application_id = NEW.application_id AND e.actor_account_id = NEW.actor_account_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'the person who filed a registration cannot review it';
    END IF;
    IF EXISTS (SELECT 1 FROM registration_application a JOIN organisation_membership m ON m.organisation_id = a.organisation_id
                WHERE a.id = NEW.application_id AND m.user_id = NEW.actor_account_id AND m.active) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'a member of the applicant organisation cannot review its registration';
    END IF;
  END IF;
  IF NEW.action = 'approve' AND EXISTS (SELECT 1 FROM registration_transition_event t WHERE t.application_id = NEW.application_id
                                           AND t.action = 'recommend' AND t.actor_account_id = NEW.actor_account_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'the person who recommended a registration cannot approve it';
  END IF;
  RETURN NEW;
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

  v_after := a.version + 1;
  UPDATE registration_application SET state = 'approved', version = v_after, registered_brand_id = v_brand, registered_authorisation_id = v_auth
   WHERE id = a.id;
  INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, note)
  VALUES (v_event, a.id, 'approve', 'director_approval', 'approved', p_actor, 'director', v_after, nullif(btrim(p_note), ''));
  RETURN QUERY SELECT 'approved'::text, v_after, v_brand, v_auth;
END $$;
