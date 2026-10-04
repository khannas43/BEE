-- Wave 1 / first slice step 3: the assigned IAME officer records a verification of the test report and recommends
-- forwarding (iame_scrutiny -> bee_scrutiny). One append-only record per recommendation, tied to the transition event
-- written in the same transaction. Provisional local rules, not BEE rules (decision B8).
CREATE TABLE model_application_iame_recommendation (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES model_application (id),
  transition_event_id   uuid NOT NULL UNIQUE REFERENCES model_application_transition_event (id),
  verification          text NOT NULL CHECK (verification IN ('verified', 'not_verified')),
  note                  text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 500),
  recommended_by_account_id uuid NOT NULL REFERENCES user_account (id),
  recommended_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_application_iame_recommendation_application
  ON model_application_iame_recommendation (application_id);

CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON model_application_iame_recommendation
  FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON model_application_iame_recommendation
  FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change();

DROP FUNCTION IF EXISTS app_disposable_model_cleanup(uuid[]);

CREATE FUNCTION app_disposable_model_cleanup(app_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  home_schema text := coalesce(nullif(current_setting('bee.cleanup_schema', true), ''), current_schema());
  missing boolean;
BEGIN
  IF session_user <> 'bee_local_maint' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'cleanup refused: maintenance role required';
  END IF;
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM unnest($1::uuid[]) AS u(id) '
      || 'WHERE NOT EXISTS (SELECT 1 FROM %I.local_disposable_application d WHERE d.application_id = u.id))',
    home_schema)
  INTO missing USING app_ids;
  IF missing THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'cleanup refused: unregistered application id';
  END IF;
  EXECUTE format('DELETE FROM %I.model_application_iame_recommendation WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_fee_confirmation WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_transition_event WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.assignment WHERE subject_type = ''model_application'' AND subject_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.model_application_document_version v USING %I.model_application_document d '
      || 'WHERE v.document_id = d.id AND d.application_id = ANY ($1)',
    home_schema, home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.model_application_document WHERE application_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.model_application_fee_snapshot WHERE application_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.model_application_submission_event WHERE application_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.local_disposable_application WHERE application_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application WHERE id = ANY ($1)', home_schema) USING app_ids;
END $$;

REVOKE ALL ON FUNCTION app_disposable_model_cleanup(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_disposable_model_cleanup(uuid[]) FROM bee_app;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.app_disposable_model_cleanup(uuid[]) TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, INSERT, DELETE ON %I.local_disposable_application TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application_iame_recommendation TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application_fee_confirmation TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application_transition_event TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.assignment TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application_document_version TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application_document TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application_fee_snapshot TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application_submission_event TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application TO bee_local_maint', home_schema);
  END IF;

  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.model_application_transition_event TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.model_application_fee_confirmation TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.model_application_iame_recommendation TO bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_transition_event FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_fee_confirmation FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_iame_recommendation FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM bee_runtime', home_schema);
  END IF;
END $$;

COMMENT ON TABLE model_application_iame_recommendation IS
  'Append-only IAME officer recommendation: the verification finding on the test report and a note. Provisional local rule (decision B8), not a BEE rule; the system itself makes no accreditation, authenticity or malware claim.';
