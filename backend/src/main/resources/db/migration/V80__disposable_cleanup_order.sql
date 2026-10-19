-- Test-support cleanup of disposable model applications (maintenance login only): delete notification_command and notification AFTER the
-- model_application_return rows that reference them. V72 deleted them before, so the cleanup failed for any disposable application that had
-- a return cycle (found by the live gate on the integration line). Same function, same privileges; only the order of two statements changes.

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
  EXECUTE format('DELETE FROM %I.model_return_response_wiring_evidence WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.model_return_response_cycle_return cr USING %I.model_return_response_cycle c '
      || 'WHERE c.application_id = ANY ($1) AND cr.cycle_id = c.id', home_schema, home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.workflow_discrepancy_disposition d USING %I.model_return_response_cycle c '
      || 'WHERE c.application_id = ANY ($1) AND d.discrepancy_id = c.discrepancy_id', home_schema, home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.workflow_discrepancy_response r USING %I.model_return_response_cycle c '
      || 'WHERE c.application_id = ANY ($1) AND r.discrepancy_id = c.discrepancy_id', home_schema, home_schema)
    USING app_ids;
  EXECUTE format('DELETE FROM %I.model_return_response_cycle WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.workflow_sla_clock_event e USING %I.workflow_sla_clock cl JOIN %I.workflow_task t ON t.id = cl.task_id '
      || 'WHERE t.subject_kind = ''model_application'' AND t.subject_id = ANY ($1) AND e.clock_id = cl.id',
    home_schema, home_schema, home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.workflow_sla_clock cl USING %I.workflow_task t '
      || 'WHERE t.subject_kind = ''model_application'' AND t.subject_id = ANY ($1) AND cl.task_id = t.id',
    home_schema, home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.workflow_task_event e USING %I.workflow_task t '
      || 'WHERE t.subject_kind = ''model_application'' AND t.subject_id = ANY ($1) AND e.task_id = t.id',
    home_schema, home_schema)
    USING app_ids;
  EXECUTE format('DELETE FROM %I.workflow_discrepancy WHERE subject_kind = ''model_application'' AND subject_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.workflow_task WHERE subject_kind = ''model_application'' AND subject_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.fee_reversal_proposal WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_rejection WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_resubmission WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_return WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_secretary_approval WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_director_recommendation WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_rating WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_reviewer_forward WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_iame_recommendation WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.certificate WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.fee_correction_proposal WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_fee_confirmation WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  -- notification_command is referenced by model_application_return (foundation_notify_command_id): delete it only after the returns are gone.
  EXECUTE format('DELETE FROM %I.notification_command WHERE subject_kind = ''model_application'' AND subject_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.notification WHERE subject_kind = ''model_application'' AND subject_id = ANY ($1)', home_schema)
    USING app_ids;
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
  END IF;
END $$;

-- A returned application whose rating inputs changed resumes at `rating`, a stage that has no assignment row, so the
-- officer lookup raised model_return_officer_ambiguous and the applicant's resubmission was refused with
-- assignee_unavailable. At `rating` the Programme officer who computed the earlier rating is the one told.
CREATE OR REPLACE FUNCTION model_return_response_resolve_officer(
  p_application_id uuid,
  p_return_id uuid,
  p_resumed_stage text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_recipient uuid;
  v_count integer;
BEGIN
  PERFORM workflow_validate_subject('model_application', p_application_id);
  IF NOT EXISTS (
    SELECT 1 FROM model_application_return r
     WHERE r.id = p_return_id AND r.application_id = p_application_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'model_return_response_return_mismatch';
  END IF;
  IF p_resumed_stage IN ('director_review', 'secretary_approval') THEN
    SELECT returned_by_account_id INTO v_recipient FROM model_application_return WHERE id = p_return_id;
  ELSIF p_resumed_stage = 'rating' THEN
    SELECT computed_by_account_id INTO v_recipient
      FROM model_application_rating
     WHERE application_id = p_application_id
     ORDER BY rating_version DESC LIMIT 1;
  ELSE
    SELECT count(*)::int INTO v_count
      FROM assignment
     WHERE subject_type = 'model_application' AND subject_id = p_application_id
       AND stage = p_resumed_stage AND active;
    IF v_count <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'model_return_officer_ambiguous';
    END IF;
    SELECT user_id INTO v_recipient
      FROM assignment
     WHERE subject_type = 'model_application' AND subject_id = p_application_id
       AND stage = p_resumed_stage AND active;
  END IF;
  IF v_recipient IS NULL OR NOT EXISTS (
    SELECT 1 FROM user_account u WHERE u.id = v_recipient AND u.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'notification_recipient_inactive';
  END IF;
  RETURN v_recipient;
END $$;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.model_return_response_resolve_officer(uuid, uuid, text) SET search_path = %I, pg_temp', home_schema, home_schema);
END $$;
