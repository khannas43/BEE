-- BL-151: a proposal is born pending, on every table that holds one.
--
-- The runtime login may INSERT into the fee-rule, rating-scheme and fee-correction proposal tables (it records the proposal), and nothing
-- forced a new row to be pending. A row inserted already approved, or already decided by someone, would have skipped the second person.
-- Only the decision functions (fee_rule_decide, rating_scheme_decide, fee_correction_decide) move a proposal on, and they UPDATE. This is
-- the same guard the fee-reversal table has had since V40, applied to the three older tables. No existing row or code path changes.

CREATE FUNCTION proposal_born_pending() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  j jsonb := to_jsonb(NEW);
BEGIN
  IF j->>'state' IS DISTINCT FROM 'pending' OR j->>'decided_by' IS NOT NULL OR j->>'decided_at' IS NOT NULL OR j->>'decision_note' IS NOT NULL
     OR j->>'applied_version' IS NOT NULL OR j->>'applied_scheme' IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = format('a %s row is proposed as pending and decided only through its decision function', TG_TABLE_NAME);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER proposal_born_pending BEFORE INSERT ON fee_rule_proposal FOR EACH ROW EXECUTE FUNCTION proposal_born_pending();
CREATE TRIGGER proposal_born_pending BEFORE INSERT ON rating_scheme_proposal FOR EACH ROW EXECUTE FUNCTION proposal_born_pending();
CREATE TRIGGER proposal_born_pending BEFORE INSERT ON fee_correction_proposal FOR EACH ROW EXECUTE FUNCTION proposal_born_pending();
