-- Wave 1: a stage owner returns an application to the applicant with a reason, the applicant edits and resubmits, and it
-- goes back to the stage that returned it (FIRST_SLICE.md section 4). Provisional local rules, not BEE rules; the
-- applicant may edit while the application is returned and never after resubmission (decision B7, the recommended default).
--
-- Two append-only records. A return keeps where it came from, why, and a fingerprint of the rating inputs at that moment
-- (declared efficiency, laboratory, test date and the number of test-report versions). A resubmission points at exactly one
-- return. An application is "returned and waiting" when its latest return has no resubmission. If a resubmission changes a
-- rating input after the rating exists, the rating is superseded: the application passes through rating again, and the
-- earlier rating stays in model_application_rating as an earlier version.
CREATE TABLE model_application_return (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES model_application (id),
  transition_event_id   uuid NOT NULL UNIQUE REFERENCES model_application_transition_event (id),
  returned_from_state   text NOT NULL CHECK (returned_from_state IN ('iame_scrutiny', 'bee_scrutiny', 'director_review', 'secretary_approval')),
  reason                text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  fp_declared_iseer     numeric(4, 2),
  fp_laboratory_code    text,
  fp_tested_on          date,
  fp_report_versions    integer NOT NULL CHECK (fp_report_versions >= 0),
  returned_by_account_id uuid NOT NULL REFERENCES user_account (id),
  returned_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_application_return_application ON model_application_return (application_id, returned_at);

CREATE TABLE model_application_resubmission (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES model_application (id),
  return_id             uuid NOT NULL UNIQUE REFERENCES model_application_return (id),
  transition_event_id   uuid NOT NULL UNIQUE REFERENCES model_application_transition_event (id),
  resumed_state         text NOT NULL CHECK (resumed_state IN ('iame_scrutiny', 'bee_scrutiny', 'rating', 'director_review', 'secretary_approval')),
  rating_superseded     boolean NOT NULL,
  note                  text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  resubmitted_by_account_id uuid NOT NULL REFERENCES user_account (id),
  resubmitted_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT rating_superseded OR resumed_state = 'rating')
);
CREATE INDEX model_application_resubmission_application ON model_application_resubmission (application_id);

CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON model_application_return
  FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON model_application_return
  FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON model_application_resubmission
  FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON model_application_resubmission
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
  EXECUTE format('DELETE FROM %I.model_application_resubmission WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_return WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_secretary_approval WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_director_recommendation WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_rating WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_reviewer_forward WHERE application_id = ANY ($1)', home_schema) USING app_ids;
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
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application_resubmission TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application_return TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application_secretary_approval TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application_director_recommendation TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application_rating TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_application_reviewer_forward TO bee_local_maint', home_schema);
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
    EXECUTE format('GRANT SELECT, INSERT ON %I.model_application_reviewer_forward TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.model_application_rating TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.model_application_director_recommendation TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.model_application_secretary_approval TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.model_application_return TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.model_application_resubmission TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.director_final_rule TO bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I.director_final_rule FROM bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.rating_demo_band TO bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I.rating_demo_band FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_transition_event FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_fee_confirmation FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_iame_recommendation FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_reviewer_forward FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_rating FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_director_recommendation FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_secretary_approval FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_return FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_resubmission FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM bee_runtime', home_schema);
  END IF;
END $$;

COMMENT ON TABLE model_application_return IS
  'Append-only return to the applicant: the stage it came from, the reason, who returned it, and a fingerprint of the rating inputs at that moment. Provisional local rule, not a BEE rule.';
COMMENT ON TABLE model_application_resubmission IS
  'Append-only resubmission of a returned application: exactly one per return, the stage it resumed at, and whether the rating was superseded because a rating input changed.';
