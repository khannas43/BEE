-- SNL WP02B-2 (Brief 19B): durable model return/resubmit cycle linkage and officer notification command.

CREATE TABLE model_return_response_cycle (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id     uuid NOT NULL UNIQUE REFERENCES model_application (id),
  review_stage       text NOT NULL CHECK (char_length(review_stage) BETWEEN 1 AND 60),
  task_id            uuid NOT NULL REFERENCES workflow_task (id),
  discrepancy_id     uuid NOT NULL REFERENCES workflow_discrepancy (id),
  last_resumed_stage text CHECK (last_resumed_stage IS NULL OR char_length(last_resumed_stage) BETWEEN 1 AND 60),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_return_response_cycle_task ON model_return_response_cycle (task_id);

CREATE TABLE model_return_response_wiring_evidence (
  command_id       uuid PRIMARY KEY,
  application_id   uuid NOT NULL REFERENCES model_application (id),
  purpose          text NOT NULL CHECK (purpose IN ('model_return_wiring', 'model_resubmit_wiring', 'model_return_notify', 'model_resubmit_notify')),
  payload_hash     char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  completed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_return_response_wiring_evidence_app ON model_return_response_wiring_evidence (application_id);

CREATE FUNCTION model_return_response_wiring_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'model_return_response_wiring_evidence_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF session_user <> 'bee_local_maint' AND current_user <> 'bee_local_maint' THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'model_return_response_wiring_evidence_delete_refused';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER model_return_response_wiring_evidence_immutable_row
  BEFORE UPDATE OR DELETE ON model_return_response_wiring_evidence
  FOR EACH ROW EXECUTE FUNCTION model_return_response_wiring_evidence_guard();

CREATE OR REPLACE FUNCTION notify_on_return() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  IF coalesce(current_setting('bee.model_return_wired', true), '') = 'true' THEN
    RETURN NEW;
  END IF;
  PERFORM notify_application_organisation(NEW.application_id, 'returned', 'was returned to you: ' || NEW.reason || ' Edit it and send it again.');
  RETURN NEW;
END $$;

CREATE FUNCTION notification_foundation_deliver_recipient(
  p_command_id uuid,
  p_payload_hash char(64),
  p_subject_kind text,
  p_subject_id uuid,
  p_kind text,
  p_message_suffix text,
  p_recipient_account uuid,
  p_actor_account uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_row notification_command;
  v_full text;
BEGIN
  IF p_command_id IS NULL OR p_payload_hash IS NULL OR p_recipient_account IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification_command_id_hash_required';
  END IF;
  PERFORM workflow_validate_subject(p_subject_kind, p_subject_id);
  IF NOT EXISTS (
    SELECT 1 FROM user_account u WHERE u.id = p_recipient_account AND u.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'notification_recipient_inactive';
  END IF;
  v_full := notification_foundation_subject_message(p_subject_kind, p_subject_id, p_message_suffix);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text, 0));
  INSERT INTO notification_command (command_id, payload_hash, subject_kind, subject_id, kind, message, actor_account_id, recipient_count)
  VALUES (p_command_id, p_payload_hash, p_subject_kind, p_subject_id, p_kind, v_full, p_actor_account, 0)
  ON CONFLICT (command_id) DO NOTHING;
  SELECT * INTO v_row FROM notification_command WHERE command_id = p_command_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'notification_command_create_race_retry';
  END IF;
  IF v_row.delivered_at IS NOT NULL THEN
    IF NOT notification_idempotency_payload_matches(v_row, p_payload_hash, p_subject_kind, p_subject_id, p_kind, v_full) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'notification_idempotency_conflict';
    END IF;
    RETURN v_row.recipient_count;
  END IF;
  IF NOT notification_idempotency_payload_matches(v_row, p_payload_hash, p_subject_kind, p_subject_id, p_kind, v_full) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'notification_idempotency_conflict';
  END IF;
  INSERT INTO notification (recipient_account_id, application_id, subject_kind, subject_id, kind, message)
  VALUES (
    p_recipient_account,
    CASE WHEN p_subject_kind = 'model_application' THEN p_subject_id ELSE NULL END,
    p_subject_kind, p_subject_id, p_kind, v_full
  );
  UPDATE notification_command SET recipient_count = 1, delivered_at = now() WHERE command_id = p_command_id;
  RETURN 1;
END $$;

REVOKE ALL ON FUNCTION notification_foundation_deliver_recipient(uuid, char(64), text, uuid, text, text, uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION workflow_block_subject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  subj_kind text := TG_ARGV[0];
BEGIN
  IF EXISTS (SELECT 1 FROM model_return_response_cycle c WHERE c.application_id = OLD.id)
     OR EXISTS (SELECT 1 FROM workflow_task t WHERE t.subject_kind = subj_kind AND t.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM workflow_discrepancy d WHERE d.subject_kind = subj_kind AND d.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM workflow_sla_clock cl JOIN workflow_task t ON t.id = cl.task_id WHERE t.subject_kind = subj_kind AND t.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM notification n WHERE n.subject_kind = subj_kind AND n.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM notification_command nc WHERE nc.subject_kind = subj_kind AND nc.subject_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_has_foundation_rows';
  END IF;
  RETURN OLD;
END $$;

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
  EXECUTE format('DELETE FROM %I.notification_command WHERE subject_kind = ''model_application'' AND subject_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.notification WHERE subject_kind = ''model_application'' AND subject_id = ANY ($1)', home_schema)
    USING app_ids;
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
  EXECUTE format('ALTER FUNCTION %I.notification_foundation_deliver_recipient(uuid, char(64), text, uuid, text, text, uuid, uuid) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.notify_on_return() SET search_path = %I, pg_temp', home_schema, home_schema);
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.app_disposable_model_cleanup(uuid[]) TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_return_response_cycle TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.model_return_response_wiring_evidence TO bee_local_maint', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.notification_foundation_deliver_recipient(uuid, char(64), text, uuid, text, text, uuid, uuid) TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I.model_return_response_cycle TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.model_return_response_wiring_evidence TO bee_runtime', home_schema);
  END IF;
END $$;
