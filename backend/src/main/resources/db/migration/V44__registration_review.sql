-- WP04.2b-2 (owner's defaults, 14 October 2026): review and approval of a brand or agency registration. Provisional local rules, not BEE rules.
--
-- Programme recommends (or returns), the Director approves, returns or rejects, the applicant resubmits a returned request. The approver is
-- never the submitter and never a person who recommended it. Approval writes the brand, or the agency authorisation, in the same step as
-- the state change, inside one database function (as fee_rule_decide does), so a refusal leaves nothing behind.

ALTER TABLE registration_transition_event ADD COLUMN note text CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 500);

ALTER TABLE registration_application
  ADD COLUMN registered_brand_id         uuid REFERENCES brand (id),
  ADD COLUMN registered_authorisation_id uuid REFERENCES agency_authorisation (id),
  ADD CONSTRAINT registration_application_register_entry CHECK (
    (state = 'approved' AND ((kind = 'brand' AND registered_brand_id IS NOT NULL AND registered_authorisation_id IS NULL)
                          OR (kind = 'agency' AND registered_authorisation_id IS NOT NULL AND registered_brand_id IS NULL)))
    OR (state <> 'approved' AND registered_brand_id IS NULL AND registered_authorisation_id IS NULL));

INSERT INTO capability_grant (capability, role) VALUES ('registration_approve', 'director');

-- The only legal moves of a request (closes BL-165 for registrations).
CREATE FUNCTION registration_application_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'draft'             AND NEW.state = 'fee_due')
    OR (OLD.state = 'fee_due'           AND NEW.state = 'programme_review')
    OR (OLD.state = 'programme_review'  AND NEW.state IN ('director_approval', 'returned'))
    OR (OLD.state = 'director_approval' AND NEW.state IN ('approved', 'returned', 'rejected'))
    OR (OLD.state = 'returned'          AND NEW.state = 'programme_review')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format('registration cannot move from %s to %s', OLD.state, NEW.state);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER registration_application_02_transition BEFORE UPDATE OF state ON registration_application
  FOR EACH ROW EXECUTE FUNCTION registration_application_transition();

-- Segregation of duties on the record itself: whoever filed a request, or recommended it, cannot approve it; whoever filed cannot review it.
CREATE FUNCTION registration_transition_event_segregation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action IN ('recommend', 'approve', 'return', 'reject') THEN
    IF EXISTS (SELECT 1 FROM registration_submission_event e WHERE e.application_id = NEW.application_id AND e.actor_account_id = NEW.actor_account_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'the person who filed a registration cannot review it';
    END IF;
  END IF;
  IF NEW.action = 'approve' AND EXISTS (SELECT 1 FROM registration_transition_event t WHERE t.application_id = NEW.application_id
                                           AND t.action = 'recommend' AND t.actor_account_id = NEW.actor_account_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'the person who recommended a registration cannot approve it';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER registration_transition_event_segregation BEFORE INSERT ON registration_transition_event
  FOR EACH ROW EXECUTE FUNCTION registration_transition_event_segregation();

-- Approve: from director_approval, the Director (capability registration_approve), a second person. Writes the register entry.
-- Refusals come back as out_state, never as an error, so the caller's transaction stays usable.
CREATE FUNCTION registration_approve(p_application uuid, p_actor uuid, p_version integer, p_note text)
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
                  WHERE ra.user_id = p_actor AND ra.active) INTO holds;
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
REVOKE ALL ON FUNCTION registration_approve(uuid, uuid, integer, text) FROM PUBLIC;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.brand, %I.agency_authorisation TO bee_local_maint', home_schema, home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.registration_approve(uuid, uuid, integer, text) TO bee_runtime', home_schema);
  END IF;
END $$;
