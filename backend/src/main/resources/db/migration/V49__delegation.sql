-- WP02.4c (owner's defaults, 14 October 2026; the candidate rules of docs/wp02/WP02.3_MFA.md section 7): delegation. Provisional local rules, not BEE rules.
--
-- A delegation lets one person act in another's role for a short, fixed period. It exists only as a row here, never as a Keycloak change.
--   * Only a role that acts on applications at a stage and is held for all records can be delegated: programme, director, finance. Never the Secretary's
--     final approval, never an administrative role, never a role tied to an assignment or an organisation.
--   * The delegator asks (maker); a different person holding delegation_approve (the Administrator) approves (checker); the delegate is a third person.
--   * The period starts today or later and lasts at most 30 days. A delegation is revoked by the delegator or by an approver, at once.
--   * It applies to the stage steps on model applications (see Caller), not to administrative capabilities nor to registration review.
--   * Every request, decision and use is recorded and cannot be changed.

INSERT INTO capability_grant (capability, role) VALUES ('delegation_approve', 'admin');

CREATE TABLE delegation (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegator_id   uuid NOT NULL REFERENCES user_account (id),
  delegate_id    uuid NOT NULL REFERENCES user_account (id),
  role           text NOT NULL CHECK (role IN ('programme', 'director', 'finance')),
  reason         text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  valid_from     date NOT NULL,
  valid_to       date NOT NULL,
  state          text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn', 'revoked')),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  decided_by     uuid REFERENCES user_account (id),
  decided_at     timestamptz,
  decision_note  text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  revoked_by     uuid REFERENCES user_account (id),
  revoked_at     timestamptz,
  revoke_note    text CHECK (revoke_note IS NULL OR char_length(revoke_note) <= 500),
  CHECK (delegator_id <> delegate_id),
  CHECK (valid_to > valid_from AND valid_to - valid_from <= 30),
  CHECK ((state = 'pending') = (decided_by IS NULL)),
  CHECK ((state = 'revoked') = (revoked_by IS NOT NULL))
);
CREATE INDEX delegation_delegate ON delegation (delegate_id, state);
CREATE INDEX delegation_delegator ON delegation (delegator_id, state);
CREATE INDEX delegation_state ON delegation (state, requested_at);
-- One open delegation of a role between the same two people.
CREATE UNIQUE INDEX delegation_open ON delegation (delegator_id, delegate_id, role) WHERE state IN ('pending', 'approved');
CREATE TRIGGER proposal_born_pending BEFORE INSERT ON delegation FOR EACH ROW EXECUTE FUNCTION proposal_born_pending();

CREATE FUNCTION delegation_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'pending' AND NEW.state IN ('approved', 'rejected', 'withdrawn'))
    OR (OLD.state = 'approved'  AND NEW.state = 'revoked')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format('a delegation cannot move from %s to %s', OLD.state, NEW.state);
  END IF;
  IF NEW.delegator_id <> OLD.delegator_id OR NEW.delegate_id <> OLD.delegate_id OR NEW.role <> OLD.role OR NEW.valid_from <> OLD.valid_from OR NEW.valid_to <> OLD.valid_to THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'who, what and when of a delegation cannot be changed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delegation_transition BEFORE UPDATE ON delegation FOR EACH ROW EXECUTE FUNCTION delegation_transition();

CREATE TABLE delegation_event (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegation_id     uuid NOT NULL REFERENCES delegation (id),
  action            text NOT NULL CHECK (action IN ('requested', 'approved', 'rejected', 'withdrawn', 'revoked')),
  actor_account_id  uuid NOT NULL REFERENCES user_account (id),
  note              text,
  occurred_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delegation_event_delegation ON delegation_event (delegation_id, occurred_at);

-- Every successful write made while a delegation was needed to pass a role check.
CREATE TABLE delegation_use (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegation_id     uuid NOT NULL REFERENCES delegation (id),
  acting_account_id uuid NOT NULL REFERENCES user_account (id),
  delegator_id      uuid NOT NULL REFERENCES user_account (id),
  role              text NOT NULL,
  method            text NOT NULL,
  route             text NOT NULL,
  status            integer NOT NULL,
  correlation_id    text,
  occurred_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delegation_use_delegation ON delegation_use (delegation_id, occurred_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['delegation_event', 'delegation_use'] LOOP
    EXECUTE format('CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION submission_reject_change()', t);
    EXECUTE format('CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change()', t);
  END LOOP;
END $$;

-- The request is logged by the database, so no code path can forget it.
CREATE FUNCTION delegation_log_request() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  INSERT INTO delegation_event (delegation_id, action, actor_account_id, note) VALUES (NEW.id, 'requested', NEW.delegator_id, NEW.reason);
  RETURN NEW;
END $$;
CREATE TRIGGER delegation_log_request AFTER INSERT ON delegation FOR EACH ROW EXECUTE FUNCTION delegation_log_request();

-- Decides one delegation; a refusal is a result (first column), never an error. Refusals: not_found, not_pending (approve, reject, withdraw on
-- one that is not pending), not_active (revoke on one that is not approved), not_permitted, same_person (the approver is the delegator or the
-- delegate), only_delegator (withdraw), date_passed (the period has ended), not_eligible (the delegator no longer holds the role, or the delegate
-- has no active account, no role of their own, or no organisation in common with the delegator).
CREATE FUNCTION delegation_decide(p_delegation uuid, p_actor uuid, p_decision text, p_note text)
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
REVOKE ALL ON FUNCTION delegation_decide(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION delegation_log_request() FROM PUBLIC;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.delegation, %I.delegation_event, %I.delegation_use TO bee_local_maint', home_schema, home_schema, home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.delegation, %I.delegation_use TO bee_runtime', home_schema, home_schema);
    EXECUTE format('GRANT SELECT ON %I.delegation_event TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.delegation_decide(uuid, uuid, text, text) TO bee_runtime', home_schema);
  END IF;
END $$;
