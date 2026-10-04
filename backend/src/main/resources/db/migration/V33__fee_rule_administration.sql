-- Fee-rule administration (owner's assumptions A1 and C1, 4 October 2026, not BEE's decisions): an authorised person proposes a
-- fee rule from a date, a DIFFERENT authorised person approves it, and only then does it take over. Provisional local rules.
--
-- 1. A capability is a permission that a role holds, so "who may enter a fee rule" can move to another role by adding a row
--    (the Administrator holds it now; nothing in the code names the role).
-- 2. The fee rule gets a separate tax line: a rate in percent (0 where not set). It is recorded and shown; adding it to the fee
--    an applicant pays is a later step (BL-132), so the amount an applicant sees is unchanged.
-- 3. Application types a fee can be set for (only new_model is filed today).
-- 4. Proposals, and ONE function that decides them. The two-person rule, the not-in-the-past rule and the capability check live
--    in the database function, which is the only way the runtime login can change a fee rule at all.

CREATE TABLE capability_grant (
  capability  text NOT NULL CHECK (capability ~ '^[a-z_]{3,60}$'),
  role        text NOT NULL CHECK (role ~ '^[a-z_]{2,40}$'),
  PRIMARY KEY (capability, role)
);
INSERT INTO capability_grant (capability, role) VALUES ('fee_rule_manage', 'admin');

ALTER TABLE master_fee_rule ADD COLUMN tax_rate_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate_percent BETWEEN 0 AND 100);

-- A successor made by master_supersede() is built from a JSON object, which does not apply column defaults: a successor without a
-- tax rate would be NULL. An unset tax rate means 0, whichever way the row is written.
CREATE FUNCTION fee_rule_tax_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.tax_rate_percent := coalesce(NEW.tax_rate_percent, 0);
  RETURN NEW;
END $$;
CREATE TRIGGER fee_rule_tax_default BEFORE INSERT ON master_fee_rule FOR EACH ROW EXECUTE FUNCTION fee_rule_tax_default();

CREATE TABLE fee_application_type (
  code   text PRIMARY KEY CHECK (code ~ '^[a-z_]{2,40}$'),
  label  text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80)
);
INSERT INTO fee_application_type (code, label) VALUES ('new_model', 'New model');

CREATE TABLE fee_rule_proposal (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code     text NOT NULL CHECK (category_code ~ '^[A-Z]{2,10}$'),
  application_type  text NOT NULL REFERENCES fee_application_type (code),
  amount_inr        numeric(12,2) NOT NULL CHECK (amount_inr >= 0),
  tax_rate_percent  numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate_percent BETWEEN 0 AND 100),
  effective_from    date NOT NULL,
  source_reference  text NOT NULL CHECK (char_length(btrim(source_reference)) BETWEEN 1 AND 300),
  reason            text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  proposed_by       uuid NOT NULL REFERENCES user_account (id),
  proposed_at       timestamptz NOT NULL DEFAULT now(),
  state             text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by        uuid REFERENCES user_account (id),
  decided_at        timestamptz,
  decision_note     text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  applied_version   integer,
  CHECK ((state = 'pending') = (decided_by IS NULL)),
  CHECK ((state = 'approved') = (applied_version IS NOT NULL))
);
CREATE INDEX fee_rule_proposal_state ON fee_rule_proposal (state, proposed_at);

-- Decides one proposal. p_decision is 'approve', 'reject' or 'withdraw'. Returns the new state ('approved', 'rejected',
-- 'withdrawn') and, for an approval, the version of the rule that now applies; OR a refusal as the first column, one of
-- not_found, not_pending, not_permitted, same_person, only_proposer, date_passed, rule_conflict. A refusal is a result, not an
-- error, so the caller's transaction stays usable and nothing has changed.
CREATE FUNCTION fee_rule_decide(p_proposal uuid, p_decider uuid, p_decision text, p_note text)
RETURNS TABLE (out_state text, out_version integer, out_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  p        fee_rule_proposal%ROWTYPE;
  today    date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  holds    boolean;
  v_key    text;
  v_open   record;
  v_next   integer;
  v_json   jsonb;
BEGIN
  IF p_decision NOT IN ('approve', 'reject', 'withdraw') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'validation_failed';
  END IF;
  SELECT * INTO p FROM fee_rule_proposal WHERE id = p_proposal FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;
  IF p.state <> 'pending' THEN
    RETURN QUERY SELECT 'not_pending'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM role_assignment ra JOIN capability_grant g ON g.role = ra.role AND g.capability = 'fee_rule_manage'
                  WHERE ra.user_id = p_decider AND ra.active) INTO holds;
  IF NOT holds THEN
    RETURN QUERY SELECT 'not_permitted'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;

  IF p_decision = 'withdraw' THEN
    IF p_decider <> p.proposed_by THEN
      RETURN QUERY SELECT 'only_proposer'::text, NULL::integer, NULL::text;
    RETURN;
    END IF;
    UPDATE fee_rule_proposal SET state = 'withdrawn', decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
    RETURN QUERY SELECT 'withdrawn'::text, NULL::integer, (p.category_code || ':' || p.application_type)::text;
    RETURN;
  END IF;

  -- Approving or rejecting is the second person's step, never the proposer's own.
  IF p_decider = p.proposed_by THEN
    RETURN QUERY SELECT 'same_person'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;
  IF p_decision = 'reject' THEN
    UPDATE fee_rule_proposal SET state = 'rejected', decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
    RETURN QUERY SELECT 'rejected'::text, NULL::integer, (p.category_code || ':' || p.application_type)::text;
    RETURN;
  END IF;

  -- Approve: the rule may not start in the past, however long the proposal waited.
  IF p.effective_from < today THEN
    RETURN QUERY SELECT 'date_passed'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;
  v_key := p.category_code || ':' || p.application_type;
  PERFORM pg_advisory_xact_lock(hashtext(current_schema() || '.master_fee_rule'), hashtext(v_key));
  IF NOT EXISTS (SELECT 1 FROM master_category c WHERE c.rule_key = p.category_code AND c.effective_from <= p.effective_from
                  AND (c.effective_to IS NULL OR c.effective_to > p.effective_from)) THEN
    RETURN QUERY SELECT 'rule_conflict'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;

  v_json := jsonb_build_object('category_code', p.category_code, 'application_type', p.application_type, 'amount_inr', p.amount_inr,
                               'tax_rate_percent', p.tax_rate_percent, 'source_reference', btrim(p.source_reference),
                               'verification_status', 'provisional', 'note', btrim(p.reason));
  SELECT t.version, t.effective_from INTO v_open FROM master_fee_rule t
    LEFT JOIN master_closure c ON c.master_table = 'master_fee_rule' AND c.rule_key = t.rule_key AND c.version = t.version
   WHERE t.rule_key = v_key AND coalesce(c.effective_to, t.effective_to) IS NULL;
  BEGIN
    IF v_open.version IS NOT NULL THEN
      -- The rule in force (or already queued) is open-ended: end it on the new date and start the successor, in one step.
      v_next := master_supersede('master_fee_rule', v_key, v_open.version, p.effective_from, p_decider::text,
                                 btrim(p.source_reference), btrim(p.reason), v_json);
    ELSE
      -- Nothing open (no rule yet, or the last one has ended): start version max + 1, refused if it would overlap.
      SELECT coalesce(max(f.version), 0) + 1 INTO v_next FROM master_fee_rule f WHERE f.rule_key = v_key;
      INSERT INTO master_fee_rule SELECT * FROM jsonb_populate_record(NULL::master_fee_rule,
        v_json || jsonb_build_object('id', gen_random_uuid(), 'rule_key', v_key, 'version', v_next, 'effective_from', p.effective_from,
                                     'legacy_id', NULL, 'recorded_at', now()));
    END IF;
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '23P01' OR SQLSTATE '23505' THEN
    -- Everything the block did is rolled back; report the clash as a refusal.
    v_next := NULL;
  END;
  IF v_next IS NULL THEN
    RETURN QUERY SELECT 'rule_conflict'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;
  UPDATE fee_rule_proposal SET state = 'approved', decided_by = p_decider, decided_at = now(), decision_note = p_note, applied_version = v_next
   WHERE id = p.id;
  RETURN QUERY SELECT 'approved'::text, v_next, v_key::text;
END $$;

REVOKE ALL ON FUNCTION fee_rule_decide(uuid, uuid, text, text) FROM PUBLIC;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.fee_rule_proposal TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, INSERT, DELETE ON %I.capability_grant TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, INSERT, DELETE ON %I.fee_application_type TO bee_local_maint', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    -- The runtime login may add a proposal and read; every change to a decided state goes through fee_rule_decide().
    EXECUTE format('GRANT SELECT, INSERT ON %I.fee_rule_proposal TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.capability_grant TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.fee_application_type TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.fee_rule_decide(uuid, uuid, text, text) TO bee_runtime', home_schema);
  END IF;
END $$;
