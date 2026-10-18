-- SNL WP02C (Brief 19C-A): registration return/resubmit trusted database boundary.

CREATE TABLE registration_application_return (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id             uuid NOT NULL REFERENCES registration_application (id),
  transition_event_id        uuid NOT NULL UNIQUE REFERENCES registration_transition_event (id),
  returned_from_state        text NOT NULL CHECK (returned_from_state IN ('programme_review', 'director_approval')),
  reason                     text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  returned_by_account_id     uuid NOT NULL REFERENCES user_account (id),
  returned_at                timestamptz NOT NULL,
  foundation_notify_command_id uuid NOT NULL REFERENCES notification_command (command_id)
);
CREATE INDEX registration_application_return_application ON registration_application_return (application_id, returned_at);

CREATE TABLE registration_application_resubmission (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id             uuid NOT NULL REFERENCES registration_application (id),
  return_id                  uuid NOT NULL UNIQUE REFERENCES registration_application_return (id),
  transition_event_id        uuid NOT NULL UNIQUE REFERENCES registration_transition_event (id),
  resumed_state              text NOT NULL CHECK (resumed_state = 'programme_review'),
  resubmitted_by_account_id  uuid NOT NULL REFERENCES user_account (id),
  resubmitted_at             timestamptz NOT NULL
);
CREATE INDEX registration_application_resubmission_application ON registration_application_resubmission (application_id);

CREATE TABLE registration_return_response_cycle (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id             uuid NOT NULL REFERENCES registration_application (id),
  cycle_seq                  integer NOT NULL CHECK (cycle_seq >= 1),
  status                     text NOT NULL CHECK (status IN ('open', 'closed')),
  review_stage               text NOT NULL CHECK (char_length(review_stage) BETWEEN 1 AND 60),
  task_id                    uuid NOT NULL UNIQUE REFERENCES workflow_task (id),
  discrepancy_id             uuid NOT NULL UNIQUE REFERENCES workflow_discrepancy (id),
  last_resumed_stage         text CHECK (last_resumed_stage IS NULL OR char_length(last_resumed_stage) BETWEEN 1 AND 60),
  closed_at                  timestamptz,
  closure_transition_event_id uuid REFERENCES registration_transition_event (id),
  closure_from_state         text CHECK (closure_from_state IS NULL OR char_length(closure_from_state) BETWEEN 1 AND 60),
  closure_to_state           text CHECK (closure_to_state IS NULL OR char_length(closure_to_state) BETWEEN 1 AND 60),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_return_response_cycle_application_id_cycle_seq_key UNIQUE (application_id, cycle_seq),
  CONSTRAINT registration_return_response_cycle_lifecycle_check CHECK (
    (status = 'open' AND closed_at IS NULL AND closure_transition_event_id IS NULL AND closure_from_state IS NULL AND closure_to_state IS NULL)
    OR (status = 'closed' AND closed_at IS NOT NULL AND closure_transition_event_id IS NOT NULL AND closure_from_state IS NOT NULL AND closure_to_state IS NOT NULL))
);

CREATE UNIQUE INDEX registration_return_response_cycle_one_open_per_app
  ON registration_return_response_cycle (application_id) WHERE status = 'open';

CREATE TABLE registration_return_response_cycle_return (
  cycle_id   uuid NOT NULL REFERENCES registration_return_response_cycle (id),
  return_id  uuid NOT NULL REFERENCES registration_application_return (id),
  bound_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cycle_id, return_id),
  CONSTRAINT registration_return_response_cycle_return_return_id_key UNIQUE (return_id)
);

CREATE TABLE registration_return_response_wiring_evidence (
  command_id       uuid PRIMARY KEY,
  application_id   uuid NOT NULL REFERENCES registration_application (id),
  purpose          text NOT NULL CHECK (purpose IN ('registration_return_wiring', 'registration_resubmit_wiring', 'registration_return_notify', 'registration_resubmit_notify')),
  payload_hash     char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  completed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX registration_return_response_wiring_evidence_app ON registration_return_response_wiring_evidence (application_id);

CREATE FUNCTION registration_return_response_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'bee_local_maint' OR session_user = 'bee_local_maint' THEN
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

CREATE TRIGGER registration_application_return_append_only BEFORE UPDATE OR DELETE ON registration_application_return
  FOR EACH ROW EXECUTE FUNCTION registration_return_response_append_only_guard();
CREATE TRIGGER registration_application_resubmission_append_only BEFORE UPDATE OR DELETE ON registration_application_resubmission
  FOR EACH ROW EXECUTE FUNCTION registration_return_response_append_only_guard();

CREATE FUNCTION registration_return_response_wiring_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'registration_return_response_wiring_evidence_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF session_user <> 'bee_local_maint' AND current_user <> 'bee_local_maint' THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'registration_return_response_wiring_evidence_delete_refused';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER registration_return_response_wiring_evidence_immutable_row
  BEFORE UPDATE OR DELETE ON registration_return_response_wiring_evidence
  FOR EACH ROW EXECUTE FUNCTION registration_return_response_wiring_evidence_guard();

CREATE FUNCTION registration_return_response_cycle_return_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'registration_return_response_cycle_return_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF session_user <> 'bee_local_maint' AND current_user <> 'bee_local_maint' THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'registration_return_response_cycle_return_delete_refused';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER registration_return_response_cycle_return_immutable_row
  BEFORE UPDATE OR DELETE ON registration_return_response_cycle_return
  FOR EACH ROW EXECUTE FUNCTION registration_return_response_cycle_return_guard();

CREATE FUNCTION registration_return_response_cycle_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.review_stage IS DISTINCT FROM OLD.review_stage
       OR NEW.task_id IS DISTINCT FROM OLD.task_id
       OR NEW.discrepancy_id IS DISTINCT FROM OLD.discrepancy_id
       OR NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.cycle_seq IS DISTINCT FROM OLD.cycle_seq THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'registration_return_response_cycle_identity_immutable';
    END IF;
    IF OLD.status = 'closed' AND (
         NEW.status IS DISTINCT FROM OLD.status
         OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
         OR NEW.closure_transition_event_id IS DISTINCT FROM OLD.closure_transition_event_id
         OR NEW.closure_from_state IS DISTINCT FROM OLD.closure_from_state
         OR NEW.closure_to_state IS DISTINCT FROM OLD.closure_to_state
         OR NEW.last_resumed_stage IS DISTINCT FROM OLD.last_resumed_stage) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'registration_return_response_cycle_closed_immutable';
    END IF;
    IF OLD.status = 'open' AND NEW.status = 'closed' THEN
      IF NEW.closed_at IS NULL OR NEW.closure_transition_event_id IS NULL
         OR NEW.closure_from_state IS NULL OR NEW.closure_to_state IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_cycle_closure_incomplete';
      END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_cycle_status_invalid';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER registration_return_response_cycle_identity_immutable_row
  BEFORE UPDATE ON registration_return_response_cycle
  FOR EACH ROW EXECUTE FUNCTION registration_return_response_cycle_identity_guard();

CREATE FUNCTION registration_return_response_require_open_cycle(p_discrepancy_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM registration_return_response_cycle c WHERE c.discrepancy_id = p_discrepancy_id AND c.status = 'open'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_cycle_not_open';
  END IF;
END $$;

CREATE FUNCTION registration_return_response_assert_return_transition(
  p_application_id uuid,
  p_transition_event_id uuid,
  p_from_stage text,
  p_reason text,
  p_returned_by uuid,
  p_returned_at timestamptz,
  p_actor_role text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_te registration_transition_event%ROWTYPE;
BEGIN
  SELECT * INTO v_te FROM registration_transition_event WHERE id = p_transition_event_id AND application_id = p_application_id;
  IF NOT FOUND
     OR v_te.action <> 'return'
     OR v_te.to_state <> 'returned'
     OR v_te.from_state NOT IN ('programme_review', 'director_approval')
     OR v_te.from_state IS DISTINCT FROM p_from_stage
     OR v_te.note IS DISTINCT FROM p_reason
     OR v_te.actor_account_id IS DISTINCT FROM p_returned_by
     OR v_te.actor_role IS DISTINCT FROM p_actor_role
     OR v_te.occurred_at IS DISTINCT FROM p_returned_at THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_transition_mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM registration_application a WHERE a.id = p_application_id AND a.state = 'returned') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_application_state_mismatch';
  END IF;
END $$;

CREATE FUNCTION registration_return_response_assert_resubmit_transition(
  p_application_id uuid,
  p_transition_event_id uuid,
  p_responded_by uuid,
  p_resubmitted_at timestamptz,
  p_responded_role text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_te registration_transition_event%ROWTYPE;
BEGIN
  SELECT * INTO v_te FROM registration_transition_event WHERE id = p_transition_event_id AND application_id = p_application_id;
  IF NOT FOUND
     OR v_te.action <> 'resubmit'
     OR v_te.from_state <> 'returned'
     OR v_te.to_state <> 'programme_review'
     OR v_te.actor_account_id IS DISTINCT FROM p_responded_by
     OR v_te.actor_role IS DISTINCT FROM p_responded_role
     OR v_te.occurred_at IS DISTINCT FROM p_resubmitted_at THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_resubmit_transition_mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM registration_application a WHERE a.id = p_application_id AND a.state = 'programme_review') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_application_state_mismatch';
  END IF;
END $$;

CREATE FUNCTION registration_return_response_assert_policy(
  p_policy_version_id uuid,
  p_anchor timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_date date := (p_anchor AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workflow_sla_policy_version
     WHERE id = p_policy_version_id
       AND policy_key = 'snl_return_response'
       AND v_date >= effective_from
       AND (effective_to IS NULL OR v_date < effective_to)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_policy_mismatch';
  END IF;
END $$;

CREATE FUNCTION registration_return_response_resolve_officer(
  p_application_id uuid,
  p_return_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_recipient uuid;
BEGIN
  PERFORM workflow_validate_subject('registration_application', p_application_id);
  IF NOT EXISTS (
    SELECT 1 FROM registration_application_return r
     WHERE r.id = p_return_id AND r.application_id = p_application_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_return_mismatch';
  END IF;
  SELECT returned_by_account_id INTO v_recipient FROM registration_application_return WHERE id = p_return_id;
  IF v_recipient IS NULL OR NOT EXISTS (
    SELECT 1 FROM user_account u WHERE u.id = v_recipient AND u.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'notification_recipient_inactive';
  END IF;
  RETURN v_recipient;
END $$;

CREATE FUNCTION registration_return_response_officer_resubmit_notify(
  p_command_id uuid,
  p_application_id uuid,
  p_return_id uuid,
  p_resubmission_id uuid,
  p_resumed_stage text,
  p_actor_account uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_row notification_command;
  v_recipient uuid;
  v_subject_kind text := 'registration_application';
  v_kind text := 'applicant_resubmitted';
  v_suffix text := 'was resubmitted by the applicant.';
  v_full text;
  v_hash char(64);
BEGIN
  IF p_command_id IS NULL OR p_resubmission_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification_command_id_hash_required';
  END IF;
  PERFORM workflow_validate_subject(v_subject_kind, p_application_id);
  IF p_resumed_stage <> 'programme_review' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_resumed_stage_invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM registration_application_resubmission s
     WHERE s.id = p_resubmission_id
       AND s.application_id = p_application_id
       AND s.return_id = p_return_id
       AND s.resumed_state = p_resumed_stage
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_resubmission_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM registration_return_response_cycle c
     JOIN registration_return_response_cycle_return cr ON cr.cycle_id = c.id
     WHERE c.application_id = p_application_id AND c.status = 'open' AND cr.return_id = p_return_id
       AND cr.return_id = registration_return_response_latest_cycle_return(c.id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_return_cycle_mismatch';
  END IF;
  v_recipient := registration_return_response_resolve_officer(p_application_id, p_return_id);
  v_hash := encode(
    sha256(convert_to(v_subject_kind || '|' || p_application_id::text || '|' || v_kind || '|' || p_return_id::text || '|' || p_resumed_stage || '|' || v_recipient::text, 'UTF8')),
    'hex');
  v_full := notification_foundation_subject_message(v_subject_kind, p_application_id, v_suffix);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text, 0));
  INSERT INTO notification_command (command_id, payload_hash, subject_kind, subject_id, kind, message, actor_account_id, recipient_count)
  VALUES (p_command_id, v_hash, v_subject_kind, p_application_id, v_kind, v_full, p_actor_account, 0)
  ON CONFLICT (command_id) DO NOTHING;
  SELECT * INTO v_row FROM notification_command WHERE command_id = p_command_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'notification_command_create_race_retry';
  END IF;
  IF v_row.delivered_at IS NOT NULL THEN
    IF NOT notification_idempotency_payload_matches(v_row, v_hash, v_subject_kind, p_application_id, v_kind, v_full) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'notification_idempotency_conflict';
    END IF;
    RETURN v_row.recipient_count;
  END IF;
  IF NOT notification_idempotency_payload_matches(v_row, v_hash, v_subject_kind, p_application_id, v_kind, v_full) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'notification_idempotency_conflict';
  END IF;
  INSERT INTO notification (recipient_account_id, application_id, subject_kind, subject_id, kind, message)
  VALUES (v_recipient, NULL, v_subject_kind, p_application_id, v_kind, v_full);
  UPDATE notification_command SET recipient_count = 1, delivered_at = now() WHERE command_id = p_command_id;
  RETURN 1;
END $$;

CREATE FUNCTION registration_return_response_latest_cycle_return(p_cycle_id uuid) RETURNS uuid
  LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE
  v_return_id uuid;
BEGIN
  SELECT cr.return_id INTO v_return_id
    FROM registration_return_response_cycle_return cr
    JOIN registration_application_return r ON r.id = cr.return_id
   WHERE cr.cycle_id = p_cycle_id
   ORDER BY r.returned_at DESC, r.id DESC
   LIMIT 1;
  RETURN v_return_id;
END $$;

CREATE FUNCTION registration_return_response_bind_cycle_return(p_cycle_id uuid, p_return_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM registration_return_response_cycle c
      JOIN registration_application_return r ON r.id = p_return_id
     WHERE c.id = p_cycle_id AND c.application_id = r.application_id AND c.status = 'open'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_return_cycle_bind_invalid';
  END IF;
  INSERT INTO registration_return_response_cycle_return (cycle_id, return_id) VALUES (p_cycle_id, p_return_id);
END $$;

CREATE FUNCTION registration_return_response_link_cycle(
  p_application_id uuid,
  p_review_stage text,
  p_task_id uuid,
  p_discrepancy_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_id uuid;
  v_seq integer;
BEGIN
  PERFORM workflow_validate_subject('registration_application', p_application_id);
  IF EXISTS (SELECT 1 FROM registration_return_response_cycle WHERE application_id = p_application_id AND status = 'open') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_open_cycle_exists';
  END IF;
  IF p_review_stage NOT IN ('programme_review', 'director_approval') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_review_stage_invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM workflow_task t
     WHERE t.id = p_task_id
       AND t.subject_kind = 'registration_application'
       AND t.subject_id = p_application_id
       AND t.stage = p_review_stage
       AND t.action = 'review'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_task_link_invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM workflow_discrepancy d
     WHERE d.id = p_discrepancy_id
       AND d.subject_kind = 'registration_application'
       AND d.subject_id = p_application_id
       AND d.line_code = 'return_response'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_discrepancy_link_invalid';
  END IF;
  SELECT coalesce(max(cycle_seq), 0) + 1 INTO v_seq FROM registration_return_response_cycle WHERE application_id = p_application_id;
  INSERT INTO registration_return_response_cycle (application_id, review_stage, task_id, discrepancy_id, cycle_seq, status)
  VALUES (p_application_id, p_review_stage, p_task_id, p_discrepancy_id, v_seq, 'open')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION registration_return_response_update_last_resumed_stage(
  p_application_id uuid,
  p_resubmission_id uuid,
  p_stage text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM workflow_validate_subject('registration_application', p_application_id);
  IF p_stage <> 'programme_review' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_resumed_stage_invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM registration_application_resubmission s
     WHERE s.id = p_resubmission_id AND s.application_id = p_application_id AND s.resumed_state = p_stage
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_resubmission_stage_mismatch';
  END IF;
  UPDATE registration_return_response_cycle SET last_resumed_stage = p_stage
   WHERE application_id = p_application_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_cycle_missing';
  END IF;
END $$;

CREATE FUNCTION registration_return_response_record_wiring_evidence(
  p_command_id uuid,
  p_application_id uuid,
  p_purpose text,
  p_payload_hash char(64)
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_row registration_return_response_wiring_evidence;
BEGIN
  IF p_command_id IS NULL OR p_payload_hash IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_wiring_command_required';
  END IF;
  PERFORM workflow_validate_subject('registration_application', p_application_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text, 0));
  INSERT INTO registration_return_response_wiring_evidence (command_id, application_id, purpose, payload_hash)
  VALUES (p_command_id, p_application_id, p_purpose, p_payload_hash)
  ON CONFLICT (command_id) DO NOTHING;
  SELECT * INTO v_row FROM registration_return_response_wiring_evidence WHERE command_id = p_command_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'registration_return_response_wiring_evidence_race_retry';
  END IF;
  IF v_row.payload_hash IS DISTINCT FROM p_payload_hash
     OR v_row.application_id IS DISTINCT FROM p_application_id
     OR v_row.purpose IS DISTINCT FROM p_purpose THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'registration_return_response_wiring_idempotency_conflict';
  END IF;
END $$;

CREATE FUNCTION registration_return_response_append_response(
  p_discrepancy_id uuid,
  p_body text,
  p_responded_by uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_seq integer;
BEGIN
  PERFORM registration_return_response_require_open_cycle(p_discrepancy_id);
  PERFORM 1 FROM workflow_discrepancy WHERE id = p_discrepancy_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_discrepancy_missing';
  END IF;
  SELECT coalesce(max(response_seq), 0) + 1 INTO v_seq
    FROM workflow_discrepancy_response WHERE discrepancy_id = p_discrepancy_id;
  PERFORM workflow_foundation_discrepancy_respond(p_discrepancy_id, v_seq, p_body, p_responded_by);
  RETURN v_seq;
END $$;

CREATE FUNCTION registration_return_response_insert_return(
  p_return_id uuid,
  p_application_id uuid,
  p_transition_event_id uuid,
  p_from_stage text,
  p_reason text,
  p_returned_by uuid,
  p_foundation_notify_command_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_te registration_transition_event%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_foundation_notify_command_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_foundation_notify_required';
  END IF;
  PERFORM workflow_validate_subject('registration_application', p_application_id);
  SELECT * INTO v_te FROM registration_transition_event WHERE id = p_transition_event_id AND application_id = p_application_id;
  IF NOT FOUND
     OR v_te.action <> 'return'
     OR v_te.to_state <> 'returned'
     OR v_te.from_state IS DISTINCT FROM p_from_stage
     OR v_te.from_state NOT IN ('programme_review', 'director_approval')
     OR v_te.note IS DISTINCT FROM p_reason
     OR v_te.actor_account_id IS DISTINCT FROM p_returned_by THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_transition_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM notification_command nc
     WHERE nc.command_id = p_foundation_notify_command_id
       AND nc.delivered_at IS NOT NULL
       AND nc.subject_kind = 'registration_application'
       AND nc.subject_id = p_application_id
       AND nc.kind = 'returned'
       AND position(p_reason in nc.message) > 0
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_foundation_notify_undelivered';
  END IF;
  INSERT INTO registration_application_return (
    id, application_id, transition_event_id, returned_from_state, reason, returned_by_account_id, returned_at, foundation_notify_command_id)
  VALUES (p_return_id, p_application_id, p_transition_event_id, p_from_stage, p_reason, p_returned_by, v_te.occurred_at, p_foundation_notify_command_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION registration_return_response_insert_resubmission(
  p_resubmission_id uuid,
  p_application_id uuid,
  p_transition_event_id uuid,
  p_return_id uuid,
  p_responded_by uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_te registration_transition_event%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM workflow_validate_subject('registration_application', p_application_id);
  SELECT * INTO v_te FROM registration_transition_event WHERE id = p_transition_event_id AND application_id = p_application_id;
  IF NOT FOUND
     OR v_te.action <> 'resubmit'
     OR v_te.from_state <> 'returned'
     OR v_te.to_state <> 'programme_review'
     OR v_te.actor_account_id IS DISTINCT FROM p_responded_by THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_resubmit_transition_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM registration_application_return r WHERE r.id = p_return_id AND r.application_id = p_application_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_return_mismatch';
  END IF;
  INSERT INTO registration_application_resubmission (
    id, application_id, return_id, transition_event_id, resumed_state, resubmitted_by_account_id, resubmitted_at)
  VALUES (p_resubmission_id, p_application_id, p_return_id, p_transition_event_id, 'programme_review', p_responded_by, v_te.occurred_at)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION registration_return_response_orchestrate_wired_return(
  p_return_id uuid,
  p_application_id uuid,
  p_transition_event_id uuid,
  p_from_stage text,
  p_reason text,
  p_returned_by uuid,
  p_returned_at timestamptz,
  p_actor_role text,
  p_notify_command_id uuid,
  p_notify_payload_hash char(64),
  p_notify_message_suffix text,
  p_task_command_id uuid,
  p_task_payload_hash char(64),
  p_task_owner_role text,
  p_task_owner_account uuid,
  p_due_at timestamptz,
  p_policy_version_id uuid,
  p_wiring_command_id uuid,
  p_wiring_payload_hash char(64),
  p_actor_account uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_prior registration_return_response_wiring_evidence;
  v_cycle registration_return_response_cycle;
  v_cycle_id uuid;
  v_task_id uuid;
  v_discrepancy_id uuid;
  v_clock_id uuid;
  v_status text;
  v_seq integer;
BEGIN
  PERFORM workflow_validate_subject('registration_application', p_application_id);
  PERFORM registration_return_response_assert_return_transition(
    p_application_id, p_transition_event_id, p_from_stage, p_reason, p_returned_by, p_returned_at, p_actor_role);
  PERFORM registration_return_response_assert_policy(p_policy_version_id, p_returned_at);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_wiring_command_id::text, 0));
  SELECT * INTO v_prior FROM registration_return_response_wiring_evidence WHERE command_id = p_wiring_command_id;
  IF FOUND THEN
    IF v_prior.payload_hash IS DISTINCT FROM p_wiring_payload_hash
       OR v_prior.application_id IS DISTINCT FROM p_application_id
       OR v_prior.purpose IS DISTINCT FROM 'registration_return_wiring' THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'registration_return_response_wiring_idempotency_conflict';
    END IF;
    RETURN p_return_id;
  END IF;
  PERFORM notification_foundation_deliver(
    p_notify_command_id, p_notify_payload_hash, 'registration_application', p_application_id, 'returned', p_notify_message_suffix, p_actor_account);
  PERFORM registration_return_response_insert_return(
    p_return_id, p_application_id, p_transition_event_id, p_from_stage, p_reason, p_returned_by, p_notify_command_id);
  SELECT * INTO v_cycle FROM registration_return_response_cycle WHERE application_id = p_application_id AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN
    v_task_id := workflow_foundation_create_task(
      'registration_application', p_application_id, p_from_stage, 'review', p_task_owner_role, p_task_owner_account,
      p_task_command_id, p_task_payload_hash, p_due_at, p_policy_version_id, p_returned_at, p_actor_account, p_actor_role);
    INSERT INTO workflow_discrepancy (subject_kind, subject_id, line_code, summary, opened_by)
    VALUES ('registration_application', p_application_id, 'return_response', p_reason, p_returned_by)
    RETURNING id INTO v_discrepancy_id;
    v_cycle_id := registration_return_response_link_cycle(p_application_id, p_from_stage, v_task_id, v_discrepancy_id);
    PERFORM registration_return_response_bind_cycle_return(v_cycle_id, p_return_id);
    SELECT id INTO v_clock_id FROM workflow_sla_clock WHERE task_id = v_task_id;
    PERFORM workflow_foundation_append_clock_event(v_clock_id, 'start', 'bureau', p_returned_at, NULL);
    PERFORM workflow_foundation_append_clock_event(v_clock_id, 'pause', 'applicant', p_returned_at + interval '1 millisecond', NULL);
  ELSE
    SELECT status INTO v_status FROM workflow_discrepancy WHERE id = v_cycle.discrepancy_id;
    IF v_status = 'awaiting_review' THEN
      SELECT r.response_seq INTO v_seq
        FROM workflow_discrepancy_response r
        LEFT JOIN workflow_discrepancy_disposition d ON d.discrepancy_id = r.discrepancy_id AND d.response_seq = r.response_seq
       WHERE r.discrepancy_id = v_cycle.discrepancy_id AND d.id IS NULL
       ORDER BY r.response_seq DESC LIMIT 1;
      IF v_seq IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_unexpected_discrepancy_status';
      END IF;
      PERFORM workflow_foundation_discrepancy_dispose(v_cycle.discrepancy_id, v_seq, 'needs_more', p_reason, p_returned_by);
    ELSIF v_status NOT IN ('needs_more', 'open') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'registration_return_response_unexpected_discrepancy_status';
    END IF;
    SELECT id INTO v_clock_id FROM workflow_sla_clock WHERE task_id = v_cycle.task_id;
    PERFORM workflow_foundation_append_clock_event(v_clock_id, 'pause', 'applicant', p_returned_at + interval '1 millisecond', NULL);
    PERFORM registration_return_response_bind_cycle_return(v_cycle.id, p_return_id);
  END IF;
  PERFORM registration_return_response_record_wiring_evidence(p_wiring_command_id, p_application_id, 'registration_return_wiring', p_wiring_payload_hash);
  PERFORM registration_return_response_record_wiring_evidence(p_notify_command_id, p_application_id, 'registration_return_notify', p_notify_payload_hash);
  RETURN p_return_id;
END $$;

CREATE FUNCTION registration_return_response_orchestrate_resubmit(
  p_application_id uuid,
  p_return_id uuid,
  p_resubmission_id uuid,
  p_transition_event_id uuid,
  p_returned_from_stage text,
  p_returned_at timestamptz,
  p_return_reason text,
  p_resumed_stage text,
  p_response_body text,
  p_resubmitted_at timestamptz,
  p_responded_by uuid,
  p_responded_role text,
  p_wiring_command_id uuid,
  p_wiring_payload_hash char(64),
  p_notify_command_id uuid,
  p_task_command_id uuid,
  p_task_payload_hash char(64),
  p_task_owner_role text,
  p_task_owner_account uuid,
  p_due_at timestamptz,
  p_policy_version_id uuid,
  p_actor_account uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_prior registration_return_response_wiring_evidence;
  v_cycle registration_return_response_cycle;
  v_task_id uuid;
  v_discrepancy_id uuid;
  v_clock_id uuid;
  v_notify_hash char(64);
  v_recipient uuid;
BEGIN
  PERFORM workflow_validate_subject('registration_application', p_application_id);
  PERFORM registration_return_response_assert_resubmit_transition(
    p_application_id, p_transition_event_id, p_responded_by, p_resubmitted_at, p_responded_role);
  PERFORM registration_return_response_assert_policy(p_policy_version_id, p_returned_at);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_wiring_command_id::text, 0));
  SELECT * INTO v_prior FROM registration_return_response_wiring_evidence WHERE command_id = p_wiring_command_id;
  IF FOUND THEN
    IF v_prior.payload_hash IS DISTINCT FROM p_wiring_payload_hash
       OR v_prior.application_id IS DISTINCT FROM p_application_id
       OR v_prior.purpose IS DISTINCT FROM 'registration_resubmit_wiring' THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'registration_return_response_wiring_idempotency_conflict';
    END IF;
    RETURN;
  END IF;
  SELECT * INTO v_cycle FROM registration_return_response_cycle WHERE application_id = p_application_id AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN
    v_task_id := workflow_foundation_create_task(
      'registration_application', p_application_id, p_returned_from_stage, 'review', p_task_owner_role, p_task_owner_account,
      p_task_command_id, p_task_payload_hash, p_due_at, p_policy_version_id, p_returned_at, p_actor_account, p_responded_role);
    INSERT INTO workflow_discrepancy (subject_kind, subject_id, line_code, summary, opened_by)
    VALUES ('registration_application', p_application_id, 'return_response', p_return_reason, p_task_owner_account)
    RETURNING id INTO v_discrepancy_id;
    PERFORM registration_return_response_link_cycle(p_application_id, p_returned_from_stage, v_task_id, v_discrepancy_id);
    SELECT id INTO v_clock_id FROM workflow_sla_clock WHERE task_id = v_task_id;
    PERFORM workflow_foundation_append_clock_event(v_clock_id, 'start', 'bureau', p_returned_at, NULL);
    PERFORM workflow_foundation_append_clock_event(v_clock_id, 'pause', 'applicant', p_returned_at + interval '1 millisecond', NULL);
    SELECT * INTO v_cycle FROM registration_return_response_cycle WHERE application_id = p_application_id AND status = 'open';
    IF NOT EXISTS (SELECT 1 FROM registration_return_response_cycle_return WHERE cycle_id = v_cycle.id AND return_id = p_return_id) THEN
      PERFORM registration_return_response_bind_cycle_return(v_cycle.id, p_return_id);
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM registration_return_response_cycle_return WHERE cycle_id = v_cycle.id AND return_id = p_return_id) THEN
    IF EXISTS (SELECT 1 FROM registration_return_response_cycle_return WHERE return_id = p_return_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_return_cycle_mismatch';
    END IF;
    PERFORM registration_return_response_bind_cycle_return(v_cycle.id, p_return_id);
  END IF;
  IF p_return_id IS DISTINCT FROM registration_return_response_latest_cycle_return(v_cycle.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_return_cycle_mismatch';
  END IF;
  PERFORM registration_return_response_insert_resubmission(
    p_resubmission_id, p_application_id, p_transition_event_id, p_return_id, p_responded_by);
  PERFORM registration_return_response_update_last_resumed_stage(p_application_id, p_resubmission_id, p_resumed_stage);
  PERFORM registration_return_response_append_response(v_cycle.discrepancy_id, p_response_body, p_responded_by);
  SELECT id INTO v_clock_id FROM workflow_sla_clock WHERE task_id = v_cycle.task_id;
  PERFORM workflow_foundation_append_clock_event(v_clock_id, 'resume', 'applicant', p_resubmitted_at + interval '1 millisecond', NULL);
  PERFORM registration_return_response_officer_resubmit_notify(
    p_notify_command_id, p_application_id, p_return_id, p_resubmission_id, p_resumed_stage, p_actor_account);
  v_recipient := registration_return_response_resolve_officer(p_application_id, p_return_id);
  v_notify_hash := encode(
    sha256(convert_to('registration_application|' || p_application_id::text || '|applicant_resubmitted|' || p_return_id::text || '|' || p_resumed_stage || '|' || v_recipient::text, 'UTF8')),
    'hex');
  PERFORM registration_return_response_record_wiring_evidence(p_wiring_command_id, p_application_id, 'registration_resubmit_wiring', p_wiring_payload_hash);
  PERFORM registration_return_response_record_wiring_evidence(p_notify_command_id, p_application_id, 'registration_resubmit_notify', v_notify_hash);
END $$;

CREATE FUNCTION registration_return_response_maint_close_cycle(
  p_application_id uuid,
  p_transition_event_id uuid,
  p_from_state text,
  p_to_state text,
  p_closed_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_cycle registration_return_response_cycle;
  v_response_seq integer;
  v_task_version integer;
  v_clock_id uuid;
BEGIN
  IF session_user <> 'bee_local_maint' AND current_user <> 'bee_local_maint' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'registration_return_response_maint_close_refused';
  END IF;
  SELECT * INTO v_cycle FROM registration_return_response_cycle WHERE application_id = p_application_id AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'registration_return_response_cycle_missing';
  END IF;
  SELECT r.response_seq INTO v_response_seq
    FROM workflow_discrepancy_response r
    LEFT JOIN workflow_discrepancy_disposition d ON d.discrepancy_id = r.discrepancy_id AND d.response_seq = r.response_seq
   WHERE r.discrepancy_id = v_cycle.discrepancy_id AND d.id IS NULL
   ORDER BY r.response_seq DESC LIMIT 1;
  IF v_response_seq IS NOT NULL THEN
    PERFORM workflow_foundation_discrepancy_dispose(v_cycle.discrepancy_id, v_response_seq, 'accepted', NULL,
      (SELECT actor_account_id FROM registration_transition_event WHERE id = p_transition_event_id));
  END IF;
  SELECT version INTO v_task_version FROM workflow_task WHERE id = v_cycle.task_id FOR UPDATE;
  SELECT id INTO v_clock_id FROM workflow_sla_clock WHERE task_id = v_cycle.task_id;
  IF v_clock_id IS NOT NULL THEN
    PERFORM workflow_foundation_append_clock_event(v_clock_id, 'stop', 'bureau', p_closed_at + interval '1 millisecond', NULL);
  END IF;
  IF v_task_version IS NOT NULL THEN
    PERFORM workflow_foundation_terminal_task(v_cycle.task_id, v_task_version, 'completed',
      (SELECT actor_account_id FROM registration_transition_event WHERE id = p_transition_event_id), 'programme', 'maint_test_forward_closure');
  END IF;
  UPDATE registration_return_response_cycle
     SET status = 'closed',
         closed_at = p_closed_at,
         closure_transition_event_id = p_transition_event_id,
         closure_from_state = p_from_state,
         closure_to_state = p_to_state
   WHERE id = v_cycle.id AND status = 'open';
END $$;

REVOKE ALL ON FUNCTION registration_return_response_resolve_officer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_officer_resubmit_notify(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_latest_cycle_return(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_bind_cycle_return(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_link_cycle(uuid, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_update_last_resumed_stage(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_record_wiring_evidence(uuid, uuid, text, char(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_append_response(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_insert_return(uuid, uuid, uuid, text, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_insert_resubmission(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_assert_return_transition(uuid, uuid, text, text, uuid, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_assert_resubmit_transition(uuid, uuid, uuid, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_assert_policy(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_require_open_cycle(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_maint_close_cycle(uuid, uuid, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_orchestrate_wired_return(
  uuid, uuid, uuid, text, text, uuid, timestamptz, text, uuid, char(64), text, uuid, char(64), text, uuid, timestamptz, uuid, uuid, char(64), uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_return_response_orchestrate_resubmit(
  uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, timestamptz, uuid, text, uuid, char(64), uuid, uuid, char(64), text, uuid, timestamptz, uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION workflow_block_subject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  subj_kind text := TG_ARGV[0];
BEGIN
  IF subj_kind = 'registration_application' AND EXISTS (SELECT 1 FROM registration_return_response_cycle c WHERE c.application_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_has_foundation_rows';
  END IF;
  IF subj_kind = 'model_application' AND EXISTS (SELECT 1 FROM model_return_response_cycle c WHERE c.application_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_has_foundation_rows';
  END IF;
  IF EXISTS (SELECT 1 FROM workflow_task t WHERE t.subject_kind = subj_kind AND t.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM workflow_discrepancy d WHERE d.subject_kind = subj_kind AND d.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM workflow_sla_clock cl JOIN workflow_task t ON t.id = cl.task_id WHERE t.subject_kind = subj_kind AND t.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM notification n WHERE n.subject_kind = subj_kind AND n.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM notification_command nc WHERE nc.subject_kind = subj_kind AND nc.subject_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_has_foundation_rows';
  END IF;
  RETURN OLD;
END $$;

DROP FUNCTION IF EXISTS app_disposable_registration_cleanup(uuid[]);

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
  EXECUTE format('DELETE FROM %I.registration_return_response_wiring_evidence WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.registration_return_response_cycle_return cr USING %I.registration_return_response_cycle c '
      || 'WHERE c.application_id = ANY ($1) AND cr.cycle_id = c.id', home_schema, home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.workflow_discrepancy_disposition d USING %I.registration_return_response_cycle c '
      || 'WHERE c.application_id = ANY ($1) AND d.discrepancy_id = c.discrepancy_id', home_schema, home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.workflow_discrepancy_response r USING %I.registration_return_response_cycle c '
      || 'WHERE c.application_id = ANY ($1) AND r.discrepancy_id = c.discrepancy_id', home_schema, home_schema)
    USING app_ids;
  EXECUTE format('DELETE FROM %I.registration_return_response_cycle WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.workflow_sla_clock_event e USING %I.workflow_sla_clock cl JOIN %I.workflow_task t ON t.id = cl.task_id '
      || 'WHERE t.subject_kind = ''registration_application'' AND t.subject_id = ANY ($1) AND e.clock_id = cl.id',
    home_schema, home_schema, home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.workflow_sla_clock cl USING %I.workflow_task t '
      || 'WHERE t.subject_kind = ''registration_application'' AND t.subject_id = ANY ($1) AND cl.task_id = t.id',
    home_schema, home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.workflow_task_event e USING %I.workflow_task t '
      || 'WHERE t.subject_kind = ''registration_application'' AND t.subject_id = ANY ($1) AND e.task_id = t.id',
    home_schema, home_schema)
    USING app_ids;
  EXECUTE format('DELETE FROM %I.workflow_discrepancy WHERE subject_kind = ''registration_application'' AND subject_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.workflow_task WHERE subject_kind = ''registration_application'' AND subject_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.registration_application_resubmission WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.registration_application_return WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.notification_command WHERE subject_kind = ''registration_application'' AND subject_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.notification WHERE subject_kind = ''registration_application'' AND subject_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format('DELETE FROM %I.registration_fee_confirmation WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.registration_transition_event WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.registration_fee_snapshot WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.registration_submission_event WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.registration_document_version v USING %I.registration_document d '
      || 'WHERE v.document_id = d.id AND d.application_id = ANY ($1)',
    home_schema, home_schema)
    USING app_ids;
  EXECUTE format('DELETE FROM %I.registration_document WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.local_disposable_registration WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.registration_application WHERE id = ANY ($1)', home_schema) USING app_ids;
END $$;

REVOKE ALL ON FUNCTION app_disposable_registration_cleanup(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_disposable_registration_cleanup(uuid[]) FROM bee_app;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_resolve_officer(uuid, uuid) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_officer_resubmit_notify(uuid, uuid, uuid, uuid, text, uuid) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_link_cycle(uuid, text, uuid, uuid) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_bind_cycle_return(uuid, uuid) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_update_last_resumed_stage(uuid, uuid, text) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_record_wiring_evidence(uuid, uuid, text, char(64)) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_append_response(uuid, text, uuid) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_insert_return(uuid, uuid, uuid, text, text, uuid, uuid) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_insert_resubmission(uuid, uuid, uuid, uuid, uuid) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_assert_return_transition(uuid, uuid, text, text, uuid, timestamptz, text) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_assert_resubmit_transition(uuid, uuid, uuid, timestamptz, text) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_assert_policy(uuid, timestamptz) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_orchestrate_wired_return(uuid, uuid, uuid, text, text, uuid, timestamptz, text, uuid, char(64), text, uuid, char(64), text, uuid, timestamptz, uuid, uuid, char(64), uuid) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_orchestrate_resubmit(uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, timestamptz, uuid, text, uuid, char(64), uuid, uuid, char(64), text, uuid, timestamptz, uuid, uuid) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.registration_return_response_maint_close_cycle(uuid, uuid, text, text, timestamptz) SET search_path = %I, pg_temp', home_schema, home_schema);

  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.app_disposable_registration_cleanup(uuid[]) TO bee_local_maint', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.registration_return_response_maint_close_cycle(uuid, uuid, text, text, timestamptz) TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.registration_return_response_cycle TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.registration_return_response_cycle_return TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.registration_return_response_wiring_evidence TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.registration_application_return TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.registration_application_resubmission TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, UPDATE ON %I.registration_transition_event TO bee_local_maint', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I.registration_return_response_cycle FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I.registration_return_response_wiring_evidence FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I.registration_return_response_cycle_return FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT ON %I.registration_application_return FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT ON %I.registration_application_resubmission FROM bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.registration_return_response_cycle TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.registration_return_response_wiring_evidence TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.registration_return_response_cycle_return TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.registration_return_response_orchestrate_wired_return(uuid, uuid, uuid, text, text, uuid, timestamptz, text, uuid, char(64), text, uuid, char(64), text, uuid, timestamptz, uuid, uuid, char(64), uuid) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.registration_return_response_orchestrate_resubmit(uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, timestamptz, uuid, text, uuid, char(64), uuid, uuid, char(64), text, uuid, timestamptz, uuid, uuid) TO bee_runtime', home_schema);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.registration_return_response_bind_cycle_return(uuid, uuid) FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.registration_return_response_link_cycle(uuid, text, uuid, uuid) FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.registration_return_response_update_last_resumed_stage(uuid, uuid, text) FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.registration_return_response_append_response(uuid, text, uuid) FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.registration_return_response_officer_resubmit_notify(uuid, uuid, uuid, uuid, text, uuid) FROM bee_runtime', home_schema);
  END IF;
END $$;
