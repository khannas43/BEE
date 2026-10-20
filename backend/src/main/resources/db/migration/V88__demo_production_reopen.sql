-- Demonstration: a manufacturer may reopen a submitted or accepted production quarter to correct it (the Production details tab, "Edit"), with a
-- reason on record; the quarter goes back to a draft and has to be submitted again for BEE's review. The state guard (V59) allowed only
-- draft or query to submitted, and submitted to accepted or query. Local demonstration on the owner's assumption, not a BEE rule.
CREATE OR REPLACE FUNCTION production_submission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organisation_id <> OLD.organisation_id OR NEW.quarter <> OLD.quarter THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'organisation and quarter of a submission cannot change';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state IN ('draft', 'query') AND NEW.state = 'submitted')
    OR (OLD.state = 'submitted' AND NEW.state IN ('accepted', 'query'))
    OR (OLD.state IN ('submitted', 'accepted') AND NEW.state = 'draft')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format('a production submission cannot move from %s to %s', OLD.state, NEW.state);
  END IF;
  RETURN NEW;
END $$;
