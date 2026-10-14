-- WP02.4c review fixes (V49 is applied locally and is not edited): two ways a delegation could undo segregation of duties.
--  * A delegator who holds another stage role could have the delegate act at one stage while they act at another on the same application. The
--    delegator must hold no stage role other than the one delegated (programme, director, secretary, finance, iame, reviewer).
--  * A delegate who is a partner (manufacturer, agency, sda, laboratory) could act on their own organisation's applications with an officer role.
--    The delegate must hold no partner role.
-- delegation_decide is otherwise as in V49; its grants are kept by CREATE OR REPLACE.

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

  -- approve or reject: the checker, a third person
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
                  AND ra.role IN ('programme', 'director', 'secretary', 'finance', 'iame', 'reviewer') AND ra.role <> d.role)
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
