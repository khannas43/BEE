-- WP05.1c review: submission event and fee snapshot are append-only at runtime.
-- Local disposable cleanup uses app_disposable_model_cleanup() (sets bee.test_cleanup for the transaction).

CREATE FUNCTION submission_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('bee.test_cleanup', true) = 'allow' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000',
    MESSAGE = format('%s records are append-only (%s refused)', TG_TABLE_NAME, TG_OP);
END $$;

CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON model_application_submission_event
  FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON model_application_submission_event
  FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change();

CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON model_application_fee_snapshot
  FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON model_application_fee_snapshot
  FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change();

CREATE OR REPLACE FUNCTION app_disposable_model_cleanup(app_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app AS $$
BEGIN
  PERFORM set_config('bee.test_cleanup', 'allow', true);
  DELETE FROM model_application_fee_snapshot WHERE application_id = ANY(app_ids);
  DELETE FROM model_application_submission_event WHERE application_id = ANY(app_ids);
  DELETE FROM model_application WHERE id = ANY(app_ids);
END $$;

COMMENT ON FUNCTION app_disposable_model_cleanup IS
  'Local checks only: remove throwaway model applications and their submission rows; not exposed to Spring.';
