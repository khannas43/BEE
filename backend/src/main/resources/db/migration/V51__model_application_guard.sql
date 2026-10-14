-- WP05 package review (14 October 2026): the database now refuses what the services never do, for the restricted runtime login.
--
-- Until now bee_runtime held UPDATE on model_application with nothing but a state-value CHECK behind it: code outside the services could set any
-- state, move an application backwards without an event, or change its brand, model number or category after submission. This trigger limits the
-- runtime login (the owner and the local maintenance login are not restricted, so tests and repairs still work) to:
--   * the moves the stage services make: draft to fee_due; fee_due to iame_scrutiny; iame_scrutiny to bee_scrutiny, returned or rejected;
--     bee_scrutiny to rating, returned or rejected; rating to director_review or rejected; director_review to secretary_approval, approved, returned
--     or rejected; secretary_approval to approved, returned or rejected; and returned back to the stage it left (rating when the rating is superseded);
--   * changes to the identity of the application (reference, organisations, brand, model number, category) only while it is a draft.
-- Provisional local rules, not BEE rules.

CREATE FUNCTION model_application_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'bee_runtime' THEN
    RETURN NEW;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'draft'              AND NEW.state = 'fee_due')
    OR (OLD.state = 'fee_due'            AND NEW.state = 'iame_scrutiny')
    OR (OLD.state = 'iame_scrutiny'      AND NEW.state IN ('bee_scrutiny', 'returned', 'rejected'))
    OR (OLD.state = 'bee_scrutiny'       AND NEW.state IN ('rating', 'returned', 'rejected'))
    OR (OLD.state = 'rating'             AND NEW.state IN ('director_review', 'rejected'))
    OR (OLD.state = 'director_review'    AND NEW.state IN ('secretary_approval', 'approved', 'returned', 'rejected'))
    OR (OLD.state = 'secretary_approval' AND NEW.state IN ('approved', 'returned', 'rejected'))
    OR (OLD.state = 'returned'           AND NEW.state IN ('iame_scrutiny', 'bee_scrutiny', 'rating', 'director_review', 'secretary_approval'))) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format('a model application cannot move from %s to %s', OLD.state, NEW.state);
  END IF;
  IF OLD.state <> 'draft' AND (NEW.reference IS DISTINCT FROM OLD.reference OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
       OR NEW.principal_organisation_id IS DISTINCT FROM OLD.principal_organisation_id OR NEW.brand_id IS DISTINCT FROM OLD.brand_id
       OR NEW.brand_name IS DISTINCT FROM OLD.brand_name OR NEW.category IS DISTINCT FROM OLD.category OR NEW.model_number IS DISTINCT FROM OLD.model_number) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'who, which brand and which model an application is for cannot change once it is submitted';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER model_application_guard BEFORE UPDATE ON model_application FOR EACH ROW EXECUTE FUNCTION model_application_guard();
