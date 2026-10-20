-- Demonstration: the Production details tab lets a manufacturer correct the units of a quarter while the submission is still a draft, as well as
-- while it has a query. The replace function (V67) allowed only a query; it now allows a draft too. The portal's bulk-rows screen still permits
-- "replace all" only for a query (that check is in the API). Local demonstration, not BEE rules.
CREATE OR REPLACE FUNCTION production_replace_rows(p_submission uuid, p_actor uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  st text;
  n integer;
BEGIN
  SELECT state INTO st FROM production_submission WHERE id = p_submission FOR UPDATE;
  IF st IS NULL OR st NOT IN ('draft', 'query') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'the rows of a production submission can be replaced only while it is a draft or has a query';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_account WHERE id = p_actor AND status = 'active') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'an active account is needed to replace rows';
  END IF;
  DELETE FROM production_row WHERE submission_id = p_submission;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
