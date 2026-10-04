-- WP05.1c re-review: runtime (bee_app) must not bypass append-only or delete arbitrary submissions.
-- Maintenance role bee_local_maint (created by local postgres init / scripts/local/ensure-maint-role.sh)
-- registers disposable applications and runs app_disposable_model_cleanup only.

CREATE TABLE IF NOT EXISTS local_disposable_application (
  application_id uuid PRIMARY KEY REFERENCES model_application(id) ON DELETE CASCADE,
  registered_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE local_disposable_application IS
  'Local checks only: ids eligible for app_disposable_model_cleanup; not writable by bee_app.';

CREATE OR REPLACE FUNCTION submission_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'bee_local_maint' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000',
    MESSAGE = format('%s records are append-only (%s refused for %s)', TG_TABLE_NAME, TG_OP, current_user);
END $$;

CREATE OR REPLACE FUNCTION app_disposable_model_cleanup(app_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app AS $$
BEGIN
  IF current_user <> 'bee_local_maint' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'cleanup refused: maintenance role required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(app_ids) AS u(id)
    WHERE NOT EXISTS (SELECT 1 FROM local_disposable_application d WHERE d.application_id = u.id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'cleanup refused: unregistered application id';
  END IF;
  DELETE FROM model_application_fee_snapshot WHERE application_id = ANY(app_ids);
  DELETE FROM model_application_submission_event WHERE application_id = ANY(app_ids);
  DELETE FROM local_disposable_application WHERE application_id = ANY(app_ids);
  DELETE FROM model_application WHERE id = ANY(app_ids);
END $$;

REVOKE ALL ON FUNCTION app_disposable_model_cleanup(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_disposable_model_cleanup(uuid[]) FROM bee_app;

COMMENT ON FUNCTION app_disposable_model_cleanup IS
  'Local maintenance only (bee_local_maint): remove registered disposable applications and their submission rows.';
