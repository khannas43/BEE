-- WP04.2b-2b (owner's defaults, 14 October 2026): closing or revoking a registered brand or an agency authorisation takes two people.
-- Provisional local rules, not BEE rules. Programme proposes (capability register_revoke_propose); the Director decides, never the proposer
-- (capability register_revoke_decide). Approval changes the register in the same step, inside one function (as fee_rule_decide does):
--   brand revoke              the brand becomes revoked, and every active authorisation for it is revoked with it;
--   authorisation revoke      the authorisation becomes revoked;
--   authorisation close       the authorisation ends on a date (valid_to), which must fall inside its period and not be in the past.
-- The model flow already refuses a revoked brand or authorisation (brand_not_permitted), so nothing else changes.

INSERT INTO capability_grant (capability, role) VALUES ('register_revoke_propose', 'programme'), ('register_revoke_decide', 'director');

CREATE TABLE register_revocation_proposal (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_brand_id            uuid REFERENCES brand (id),
  target_authorisation_id    uuid REFERENCES agency_authorisation (id),
  action                     text NOT NULL CHECK (action IN ('revoke', 'close')),
  close_on                   date,
  reason                     text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  proposed_by                uuid NOT NULL REFERENCES user_account (id),
  proposed_at                timestamptz NOT NULL DEFAULT now(),
  state                      text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by                 uuid REFERENCES user_account (id),
  decided_at                 timestamptz,
  decision_note              text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  CHECK ((target_brand_id IS NULL) <> (target_authorisation_id IS NULL)),
  CHECK (action = 'revoke' OR (action = 'close' AND target_authorisation_id IS NOT NULL AND close_on IS NOT NULL)),
  CHECK (action = 'close' OR close_on IS NULL),
  CHECK ((state = 'pending') = (decided_by IS NULL))
);
CREATE INDEX register_revocation_proposal_state ON register_revocation_proposal (state, proposed_at);
-- One open proposal per record.
CREATE UNIQUE INDEX register_revocation_pending_brand ON register_revocation_proposal (target_brand_id) WHERE state = 'pending' AND target_brand_id IS NOT NULL;
CREATE UNIQUE INDEX register_revocation_pending_authorisation ON register_revocation_proposal (target_authorisation_id)
  WHERE state = 'pending' AND target_authorisation_id IS NOT NULL;
CREATE TRIGGER proposal_born_pending BEFORE INSERT ON register_revocation_proposal FOR EACH ROW EXECUTE FUNCTION proposal_born_pending();

-- Decides one proposal; a refusal is a result (first column), never an error. Refusals: not_found, not_pending, not_permitted, same_person,
-- only_proposer, date_passed (a closing date already gone), rule_conflict (the record is no longer active, or the date does not fit its period).
CREATE FUNCTION register_revocation_decide(p_proposal uuid, p_decider uuid, p_decision text, p_note text)
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
    UPDATE agency_authorisation SET status = 'revoked' WHERE brand_id = b.id AND status = 'active';
    UPDATE brand SET status = 'revoked' WHERE id = b.id;
  ELSE
    SELECT * INTO a FROM agency_authorisation WHERE id = p.target_authorisation_id FOR UPDATE;
    IF NOT FOUND OR a.status <> 'active' THEN
      RETURN QUERY SELECT 'rule_conflict'::text;
      RETURN;
    END IF;
    IF p.action = 'revoke' THEN
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
      UPDATE agency_authorisation SET valid_to = p.close_on WHERE id = a.id;
    END IF;
  END IF;
  UPDATE register_revocation_proposal SET state = 'approved', decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
  RETURN QUERY SELECT 'approved'::text;
END $$;
REVOKE ALL ON FUNCTION register_revocation_decide(uuid, uuid, text, text) FROM PUBLIC;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.register_revocation_proposal TO bee_local_maint', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.register_revocation_proposal TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.register_revocation_decide(uuid, uuid, text, text) TO bee_runtime', home_schema);
  END IF;
END $$;
