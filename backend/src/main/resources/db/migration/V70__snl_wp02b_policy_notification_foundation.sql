-- SNL WP02B-1 (Brief 19A): provisional snl_return_response policy and replay-safe polymorphic in-portal notifications.

INSERT INTO workflow_sla_policy_version (policy_key, version, effective_from, effective_to, calendar_key, working_day_limit, pause_while_applicant, note)
SELECT 'snl_return_response', 1, DATE '2026-01-01', NULL, 'india_bee_default', 7, true, 'provisional A08 / BL-255; not confirmed by BEE'
WHERE NOT EXISTS (
  SELECT 1 FROM workflow_sla_policy_version WHERE policy_key = 'snl_return_response' AND version = 1
);

ALTER TABLE notification ADD COLUMN subject_kind text;
ALTER TABLE notification ADD COLUMN subject_id uuid;

UPDATE notification SET subject_kind = 'model_application', subject_id = application_id WHERE subject_kind IS NULL;

ALTER TABLE notification ALTER COLUMN subject_kind SET NOT NULL;
ALTER TABLE notification ALTER COLUMN subject_id SET NOT NULL;
ALTER TABLE notification ALTER COLUMN application_id DROP NOT NULL;

ALTER TABLE notification ADD CONSTRAINT notification_subject_kind_check
  CHECK (subject_kind IN ('registration_application', 'model_application'));
ALTER TABLE notification ADD CONSTRAINT notification_model_application_id_check
  CHECK (
    (subject_kind = 'model_application' AND application_id IS NOT NULL AND application_id = subject_id)
    OR (subject_kind = 'registration_application' AND application_id IS NULL)
  );

CREATE INDEX notification_subject ON notification (subject_kind, subject_id);

CREATE TRIGGER notification_subject_guard BEFORE INSERT ON notification
  FOR EACH ROW EXECUTE FUNCTION workflow_subject_guard();

CREATE OR REPLACE FUNCTION notification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'bee_local_maint' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.read_at IS NULL AND NEW.read_at IS NOT NULL
     AND (NEW.id, NEW.recipient_account_id, NEW.application_id, NEW.subject_kind, NEW.subject_id, NEW.kind, NEW.message, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.recipient_account_id, OLD.application_id, OLD.subject_kind, OLD.subject_id, OLD.kind, OLD.message, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000',
    MESSAGE = format('%s records are append-only (%s refused for %s)', TG_TABLE_NAME, TG_OP, current_user);
END $$;

ALTER TABLE notification DROP CONSTRAINT IF EXISTS notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check
  CHECK (kind IN ('returned', 'rejected', 'fee_due', 'approved', 'applicant_resubmitted'));

CREATE OR REPLACE FUNCTION notify_application_organisation(p_application uuid, p_kind text, p_text text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO notification (recipient_account_id, application_id, subject_kind, subject_id, kind, message)
  SELECT DISTINCT m.user_id, a.id, 'model_application', a.id, p_kind, a.reference || ' (' || a.brand_name || ' ' || a.model_number || ') ' || p_text
    FROM model_application a
    JOIN organisation_membership m ON m.organisation_id = a.organisation_id
    JOIN organisation o ON o.id = m.organisation_id
    JOIN user_account u ON u.id = m.user_id
   WHERE a.id = p_application AND m.active AND o.status = 'active' AND u.status = 'active'
     AND now() >= m.valid_from AND now() < m.valid_to;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE TABLE notification_command (
  command_id           uuid PRIMARY KEY,
  payload_hash         char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  subject_kind         text NOT NULL CHECK (subject_kind IN ('registration_application', 'model_application')),
  subject_id           uuid NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('returned', 'rejected', 'fee_due', 'approved', 'applicant_resubmitted')),
  message              text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 700),
  actor_account_id     uuid NOT NULL REFERENCES user_account (id),
  recipient_count      integer NOT NULL CHECK (recipient_count >= 0),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION notification_command_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.recipient_count = 0 AND NEW.recipient_count >= 0
       AND (NEW.command_id, NEW.payload_hash, NEW.subject_kind, NEW.subject_id, NEW.kind, NEW.message, NEW.actor_account_id, NEW.created_at)
           IS NOT DISTINCT FROM (OLD.command_id, OLD.payload_hash, OLD.subject_kind, OLD.subject_id, OLD.kind, OLD.message, OLD.actor_account_id, OLD.created_at) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'notification_command_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF session_user <> 'bee_local_maint' AND current_user <> 'bee_local_maint' THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'notification_command_delete_refused';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER notification_command_immutable_row BEFORE UPDATE OR DELETE ON notification_command
  FOR EACH ROW EXECUTE FUNCTION notification_command_immutable();

CREATE FUNCTION notification_foundation_subject_message(p_kind text, p_id uuid, p_suffix text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE
  prefix text;
BEGIN
  IF p_kind = 'model_application' THEN
    SELECT a.reference || ' (' || a.brand_name || ' ' || a.model_number || ') ' INTO prefix FROM model_application a WHERE a.id = p_id;
  ELSIF p_kind = 'registration_application' THEN
    SELECT a.reference || ' (' || a.brand_name || ') ' INTO prefix FROM registration_application a WHERE a.id = p_id;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workflow_subject_kind_invalid';
  END IF;
  IF prefix IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_missing';
  END IF;
  RETURN prefix || p_suffix;
END $$;

CREATE FUNCTION notification_foundation_fan_out(
  p_subject_kind text, p_subject_id uuid, p_kind text, p_message text
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  n integer;
  org_id uuid;
BEGIN
  IF p_subject_kind = 'model_application' THEN
    SELECT organisation_id INTO org_id FROM model_application WHERE id = p_subject_id;
  ELSE
    SELECT organisation_id INTO org_id FROM registration_application WHERE id = p_subject_id;
  END IF;
  IF org_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_missing';
  END IF;
  INSERT INTO notification (recipient_account_id, application_id, subject_kind, subject_id, kind, message)
  SELECT DISTINCT m.user_id,
         CASE WHEN p_subject_kind = 'model_application' THEN p_subject_id ELSE NULL END,
         p_subject_kind, p_subject_id, p_kind, p_message
    FROM organisation_membership m
    JOIN organisation o ON o.id = m.organisation_id
    JOIN user_account u ON u.id = m.user_id
   WHERE m.organisation_id = org_id AND m.active AND o.status = 'active' AND u.status = 'active'
     AND now() >= m.valid_from AND now() < m.valid_to;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE FUNCTION notification_idempotency_payload_matches(
  p_row notification_command, p_hash char(64), p_kind text, p_subject uuid, p_notif_kind text, p_message text
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_row.payload_hash IS NOT DISTINCT FROM p_hash
     AND p_row.subject_kind = p_kind AND p_row.subject_id = p_subject
     AND p_row.kind = p_notif_kind AND p_row.message = p_message;
$$;

CREATE FUNCTION notification_foundation_deliver(
  p_command_id uuid,
  p_payload_hash char(64),
  p_subject_kind text,
  p_subject_id uuid,
  p_kind text,
  p_message_suffix text,
  p_actor_account uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_row notification_command;
  v_full text;
  v_count integer;
BEGIN
  IF p_command_id IS NULL OR p_payload_hash IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification_command_id_hash_required';
  END IF;
  PERFORM workflow_validate_subject(p_subject_kind, p_subject_id);
  v_full := notification_foundation_subject_message(p_subject_kind, p_subject_id, p_message_suffix);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text, 0));
  INSERT INTO notification_command (command_id, payload_hash, subject_kind, subject_id, kind, message, actor_account_id, recipient_count)
  VALUES (p_command_id, p_payload_hash, p_subject_kind, p_subject_id, p_kind, v_full, p_actor_account, 0)
  ON CONFLICT (command_id) DO NOTHING;
  SELECT * INTO v_row FROM notification_command WHERE command_id = p_command_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'notification_command_create_race_retry';
  END IF;
  IF v_row.recipient_count > 0 THEN
    IF NOT notification_idempotency_payload_matches(v_row, p_payload_hash, p_subject_kind, p_subject_id, p_kind, v_full) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'notification_idempotency_conflict';
    END IF;
    RETURN v_row.recipient_count;
  END IF;
  IF NOT notification_idempotency_payload_matches(v_row, p_payload_hash, p_subject_kind, p_subject_id, p_kind, v_full) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'notification_idempotency_conflict';
  END IF;
  v_count := notification_foundation_fan_out(p_subject_kind, p_subject_id, p_kind, v_full);
  UPDATE notification_command SET recipient_count = v_count WHERE command_id = p_command_id;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION notification_foundation_deliver(uuid, char(64), text, uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_foundation_subject_message(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_foundation_fan_out(text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_idempotency_payload_matches(notification_command, char(64), text, uuid, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION workflow_block_subject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  subj_kind text := TG_ARGV[0];
BEGIN
  IF EXISTS (SELECT 1 FROM workflow_task t WHERE t.subject_kind = subj_kind AND t.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM workflow_discrepancy d WHERE d.subject_kind = subj_kind AND d.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM workflow_sla_clock c JOIN workflow_task t ON t.id = c.task_id WHERE t.subject_kind = subj_kind AND t.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM notification n WHERE n.subject_kind = subj_kind AND n.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM notification_command nc WHERE nc.subject_kind = subj_kind AND nc.subject_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_has_foundation_rows';
  END IF;
  RETURN OLD;
END $$;

CREATE TABLE IF NOT EXISTS local_disposable_registration (
  application_id uuid PRIMARY KEY REFERENCES registration_application (id)
);
COMMENT ON TABLE local_disposable_registration IS
  'Registration applications created only for automated DB tests; maint cleanup may delete them.';

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

CREATE FUNCTION app_disposable_registration_cleanup(app_ids uuid[])
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
      || 'WHERE NOT EXISTS (SELECT 1 FROM %I.local_disposable_registration d WHERE d.application_id = u.id))',
    home_schema)
  INTO missing USING app_ids;
  IF missing THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'cleanup refused: unregistered registration id';
  END IF;
  EXECUTE format('DELETE FROM %I.notification_command WHERE subject_kind = ''registration_application'' AND subject_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.notification WHERE subject_kind = ''registration_application'' AND subject_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format('DELETE FROM %I.local_disposable_registration WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.registration_application WHERE id = ANY ($1)', home_schema) USING app_ids;
END $$;

REVOKE ALL ON FUNCTION app_disposable_model_cleanup(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_disposable_model_cleanup(uuid[]) FROM bee_app;
REVOKE ALL ON FUNCTION app_disposable_registration_cleanup(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_disposable_registration_cleanup(uuid[]) FROM bee_app;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.notification_foundation_deliver(uuid, char(64), text, uuid, text, text, uuid) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.notify_application_organisation(uuid, text, text) SET search_path = %I, pg_temp', home_schema, home_schema);
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.app_disposable_model_cleanup(uuid[]) TO bee_local_maint', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.app_disposable_registration_cleanup(uuid[]) TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.notification TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.notification_command TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, INSERT, DELETE ON %I.local_disposable_registration TO bee_local_maint', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.notification TO bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I.notification FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE ALL ON %I.notification_command FROM bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.notification_mark_read(uuid, uuid), %I.notification_mark_all_read(uuid) TO bee_runtime', home_schema, home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.notification_foundation_deliver(uuid, char(64), text, uuid, text, text, uuid) TO bee_runtime', home_schema);
  END IF;
END $$;
