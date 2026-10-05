-- BL-134 (owner's assumption A2, 4 October 2026, not BEE's decision): the star-rating scheme (the efficiency figure that earns each
-- star) is configurable data, entered in the portal like a fee rule: one permission holder proposes a scheme from a date, a DIFFERENT
-- one approves it, never from a date in the past. Provisional local rules: a scheme entered here is still a LOCAL DEMONSTRATION, not a
-- BEE-approved formula, and every rating computed from it still says so (basis = 'local_demo').
--
-- A scheme is the five bands of rating_demo_band under one scheme_key. The rating step already uses the scheme with the latest start
-- date on or before the day it computes, so an approved scheme takes over from its date with no change to the rating code. Earlier
-- schemes stay, and every rating keeps the scheme key it was computed with.

INSERT INTO capability_grant (capability, role) VALUES ('rating_scheme_manage', 'admin');

CREATE TABLE rating_scheme_proposal (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code     text NOT NULL CHECK (category_code ~ '^[A-Z]{2,10}$'),
  effective_from    date NOT NULL,
  -- the lowest efficiency figure that earns 1 to 5 stars; each band needs a higher figure than the one below
  min_iseer_1       numeric(4,2) NOT NULL,
  min_iseer_2       numeric(4,2) NOT NULL,
  min_iseer_3       numeric(4,2) NOT NULL,
  min_iseer_4       numeric(4,2) NOT NULL,
  min_iseer_5       numeric(4,2) NOT NULL,
  source_reference  text NOT NULL CHECK (char_length(btrim(source_reference)) BETWEEN 1 AND 300),
  reason            text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  proposed_by       uuid NOT NULL REFERENCES user_account (id),
  proposed_at       timestamptz NOT NULL DEFAULT now(),
  state             text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by        uuid REFERENCES user_account (id),
  decided_at        timestamptz,
  decision_note     text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  applied_scheme    text,
  CHECK (min_iseer_1 > 0 AND min_iseer_2 > min_iseer_1 AND min_iseer_3 > min_iseer_2 AND min_iseer_4 > min_iseer_3 AND min_iseer_5 > min_iseer_4),
  CHECK ((state = 'pending') = (decided_by IS NULL)),
  CHECK ((state = 'approved') = (applied_scheme IS NOT NULL))
);
CREATE INDEX rating_scheme_proposal_state ON rating_scheme_proposal (state, proposed_at);

-- Decides one proposal; a refusal is a result (first column), never an error, so the caller's transaction stays usable. Refusals:
-- not_found, not_pending, not_permitted, same_person, only_proposer, date_passed, rule_conflict.
CREATE FUNCTION rating_scheme_decide(p_proposal uuid, p_decider uuid, p_decision text, p_note text)
RETURNS TABLE (out_state text, out_scheme text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  p       rating_scheme_proposal%ROWTYPE;
  today   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  holds   boolean;
  v_key   text;
  v_n     integer;
BEGIN
  IF p_decision NOT IN ('approve', 'reject', 'withdraw') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'validation_failed';
  END IF;
  SELECT * INTO p FROM rating_scheme_proposal WHERE id = p_proposal FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text;
    RETURN;
  END IF;
  IF p.state <> 'pending' THEN
    RETURN QUERY SELECT 'not_pending'::text, NULL::text;
    RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM role_assignment ra JOIN capability_grant g ON g.role = ra.role AND g.capability = 'rating_scheme_manage'
                  WHERE ra.user_id = p_decider AND ra.active) INTO holds;
  IF NOT holds THEN
    RETURN QUERY SELECT 'not_permitted'::text, NULL::text;
    RETURN;
  END IF;

  IF p_decision = 'withdraw' THEN
    IF p_decider <> p.proposed_by THEN
      RETURN QUERY SELECT 'only_proposer'::text, NULL::text;
      RETURN;
    END IF;
    UPDATE rating_scheme_proposal SET state = 'withdrawn', decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
    RETURN QUERY SELECT 'withdrawn'::text, NULL::text;
    RETURN;
  END IF;

  IF p_decider = p.proposed_by THEN
    RETURN QUERY SELECT 'same_person'::text, NULL::text;
    RETURN;
  END IF;
  IF p_decision = 'reject' THEN
    UPDATE rating_scheme_proposal SET state = 'rejected', decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
    RETURN QUERY SELECT 'rejected'::text, NULL::text;
    RETURN;
  END IF;

  IF p.effective_from < today THEN
    RETURN QUERY SELECT 'date_passed'::text, NULL::text;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(current_schema() || '.rating_demo_band'), hashtext(p.category_code));
  IF NOT EXISTS (SELECT 1 FROM master_category c WHERE c.rule_key = p.category_code AND c.effective_from <= p.effective_from
                  AND (c.effective_to IS NULL OR c.effective_to > p.effective_from)) THEN
    RETURN QUERY SELECT 'rule_conflict'::text, NULL::text;
    RETURN;
  END IF;
  -- Schemes form a timeline by start date: the one in force is the one with the latest start on or before the day. Two schemes of
  -- one category may not start on the same day, or it would be ambiguous which applies.
  SELECT count(DISTINCT b.scheme_key) INTO v_n FROM rating_demo_band b WHERE b.category_code = p.category_code;
  IF EXISTS (SELECT 1 FROM rating_demo_band b WHERE b.category_code = p.category_code AND b.effective_from = p.effective_from) THEN
    RETURN QUERY SELECT 'rule_conflict'::text, NULL::text;
    RETURN;
  END IF;
  v_key := p.category_code || '-ISEER-' || (v_n + 1);
  BEGIN
    INSERT INTO rating_demo_band (scheme_key, category_code, effective_from, stars, min_iseer, source_reference, note)
    SELECT v_key, p.category_code, p.effective_from, x.stars, x.min_iseer, btrim(p.source_reference), btrim(p.reason)
      FROM (VALUES (1, p.min_iseer_1), (2, p.min_iseer_2), (3, p.min_iseer_3), (4, p.min_iseer_4), (5, p.min_iseer_5)) AS x (stars, min_iseer);
  EXCEPTION WHEN SQLSTATE '23505' OR SQLSTATE '23514' OR SQLSTATE '22023' THEN
    v_key := NULL;
  END;
  IF v_key IS NULL THEN
    RETURN QUERY SELECT 'rule_conflict'::text, NULL::text;
    RETURN;
  END IF;
  UPDATE rating_scheme_proposal SET state = 'approved', decided_by = p_decider, decided_at = now(), decision_note = p_note, applied_scheme = v_key WHERE id = p.id;
  RETURN QUERY SELECT 'approved'::text, v_key;
END $$;

REVOKE ALL ON FUNCTION rating_scheme_decide(uuid, uuid, text, text) FROM PUBLIC;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.rating_scheme_proposal TO bee_local_maint', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.rating_scheme_proposal TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.rating_scheme_decide(uuid, uuid, text, text) TO bee_runtime', home_schema);
    -- The runtime login changes a master or a rating scheme only through the decision functions, never by writing the tables:
    -- two people, never from the past. (Earlier it could still add a non-overlapping fee-rule version directly; that is closed.)
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I.master_category, %I.master_standard, %I.master_lab_accreditation, %I.master_fee_rule, '
                   '%I.master_rating_formula, %I.master_closure, %I.rating_demo_band FROM bee_runtime',
                   home_schema, home_schema, home_schema, home_schema, home_schema, home_schema, home_schema);
  END IF;
END $$;
