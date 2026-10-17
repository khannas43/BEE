-- SNL WP2A: shared workflow tasks, discrepancies, SLA policy versions and working-day clock events.
-- Corrected in Brief 18A: atomic commands via DEFINER functions, payload-safe idempotency, audited mutation, multi-cycle discrepancies.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE workflow_calendar (
  calendar_key           text PRIMARY KEY,
  label                  text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  zone_id                text NOT NULL DEFAULT 'Asia/Kolkata' CHECK (zone_id = 'Asia/Kolkata'),
  non_working_weekdays   smallint[] NOT NULL CHECK (array_length(non_working_weekdays, 1) >= 1
    AND non_working_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[])
);

INSERT INTO workflow_calendar (calendar_key, label, non_working_weekdays)
VALUES ('india_bee_default', 'India BEE default (Sat–Sun non-working)', ARRAY[6,7]::smallint[]);

CREATE TABLE workflow_calendar_closure (
  calendar_key   text NOT NULL REFERENCES workflow_calendar (calendar_key),
  closure_date   date NOT NULL,
  reason         text CHECK (reason IS NULL OR char_length(reason) <= 300),
  PRIMARY KEY (calendar_key, closure_date)
);

CREATE TABLE workflow_sla_policy_version (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key                 text NOT NULL CHECK (policy_key ~ '^[a-z][a-z0-9_]{2,60}$'),
  version                    integer NOT NULL CHECK (version >= 1),
  effective_from             date NOT NULL,
  effective_to               date,
  calendar_key               text NOT NULL REFERENCES workflow_calendar (calendar_key),
  working_day_limit          integer NOT NULL CHECK (working_day_limit BETWEEN 1 AND 9999),
  pause_while_applicant      boolean NOT NULL DEFAULT true,
  note                       text CHECK (note IS NULL OR char_length(note) <= 500),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_key, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX workflow_sla_policy_key_dates ON workflow_sla_policy_version (policy_key, effective_from);

ALTER TABLE workflow_sla_policy_version ADD CONSTRAINT workflow_sla_policy_no_overlap
  EXCLUDE USING gist (
    policy_key WITH =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') WITH &&
  );

CREATE TABLE workflow_task (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind         text NOT NULL CHECK (subject_kind IN ('registration_application', 'model_application')),
  subject_id           uuid NOT NULL,
  stage                text NOT NULL CHECK (char_length(stage) BETWEEN 1 AND 60),
  action               text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 60),
  owner_role           text NOT NULL CHECK (char_length(owner_role) BETWEEN 1 AND 40),
  owner_account_id     uuid REFERENCES user_account (id),
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  due_at               timestamptz,
  version              integer NOT NULL DEFAULT 0,
  command_id           uuid,
  command_payload_hash char(64) CHECK (command_payload_hash IS NULL OR command_payload_hash ~ '^[0-9a-f]{64}$'),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((command_id IS NULL) = (command_payload_hash IS NULL))
);

CREATE UNIQUE INDEX workflow_task_one_open ON workflow_task (subject_kind, subject_id, stage, action)
  WHERE status = 'open';
CREATE UNIQUE INDEX workflow_task_command ON workflow_task (command_id) WHERE command_id IS NOT NULL;

CREATE TABLE workflow_task_event (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id            uuid NOT NULL REFERENCES workflow_task (id),
  kind               text NOT NULL CHECK (kind IN ('created', 'reassigned', 'completed', 'cancelled')),
  from_owner_role    text,
  from_owner_account uuid REFERENCES user_account (id),
  to_owner_role      text,
  to_owner_account   uuid REFERENCES user_account (id),
  actor_account_id   uuid NOT NULL REFERENCES user_account (id),
  actor_role         text NOT NULL,
  reason             text CHECK (reason IS NULL OR char_length(reason) <= 500),
  occurred_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_task_event_task ON workflow_task_event (task_id, occurred_at);

CREATE TABLE workflow_discrepancy (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind     text NOT NULL CHECK (subject_kind IN ('registration_application', 'model_application')),
  subject_id       uuid NOT NULL,
  line_code        text NOT NULL CHECK (line_code ~ '^[a-z][a-z0-9_]{1,40}$'),
  summary          text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 700),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awaiting_review', 'needs_more', 'closed')),
  opened_by        uuid NOT NULL REFERENCES user_account (id),
  opened_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_kind, subject_id, line_code)
);

CREATE TABLE workflow_discrepancy_response (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discrepancy_id   uuid NOT NULL REFERENCES workflow_discrepancy (id),
  response_seq     integer NOT NULL CHECK (response_seq >= 1),
  body             text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  responded_by     uuid NOT NULL REFERENCES user_account (id),
  responded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (discrepancy_id, response_seq)
);

CREATE TABLE workflow_discrepancy_disposition (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discrepancy_id   uuid NOT NULL REFERENCES workflow_discrepancy (id),
  response_seq     integer NOT NULL CHECK (response_seq >= 1),
  outcome          text NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'needs_more')),
  note             text CHECK (note IS NULL OR char_length(note) <= 1000),
  disposed_by      uuid NOT NULL REFERENCES user_account (id),
  disposed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (discrepancy_id, response_seq),
  FOREIGN KEY (discrepancy_id, response_seq) REFERENCES workflow_discrepancy_response (discrepancy_id, response_seq)
);

CREATE TABLE workflow_sla_clock (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id              uuid NOT NULL UNIQUE REFERENCES workflow_task (id),
  policy_version_id    uuid NOT NULL REFERENCES workflow_sla_policy_version (id),
  policy_anchor_at     timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_sla_clock_event (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clock_id             uuid NOT NULL REFERENCES workflow_sla_clock (id),
  event_kind           text NOT NULL CHECK (event_kind IN ('start', 'pause', 'resume', 'stop')),
  responsible_party    text NOT NULL CHECK (responsible_party IN ('applicant', 'bureau')),
  occurred_at          timestamptz NOT NULL,
  note                 text CHECK (note IS NULL OR char_length(note) <= 300)
);
CREATE INDEX workflow_sla_clock_event_clock ON workflow_sla_clock_event (clock_id, occurred_at);

CREATE FUNCTION workflow_validate_subject(p_kind text, p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_kind = 'registration_application' THEN
    IF NOT EXISTS (SELECT 1 FROM registration_application WHERE id = p_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_missing';
    END IF;
  ELSIF p_kind = 'model_application' THEN
    IF NOT EXISTS (SELECT 1 FROM model_application WHERE id = p_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_missing';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workflow_subject_kind_invalid';
  END IF;
END $$;

CREATE FUNCTION workflow_subject_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM workflow_validate_subject(NEW.subject_kind, NEW.subject_id);
  RETURN NEW;
END $$;

CREATE TRIGGER workflow_task_subject BEFORE INSERT ON workflow_task
  FOR EACH ROW EXECUTE FUNCTION workflow_subject_guard();
CREATE TRIGGER workflow_discrepancy_subject BEFORE INSERT ON workflow_discrepancy
  FOR EACH ROW EXECUTE FUNCTION workflow_subject_guard();
CREATE FUNCTION workflow_sla_clock_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.task_id, NEW.policy_version_id, NEW.policy_anchor_at, NEW.created_at)
         IS DISTINCT FROM (OLD.task_id, OLD.policy_version_id, OLD.policy_anchor_at, OLD.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_sla_clock_identity_immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER workflow_sla_clock_identity BEFORE UPDATE ON workflow_sla_clock
  FOR EACH ROW EXECUTE FUNCTION workflow_sla_clock_identity_guard();

CREATE FUNCTION workflow_block_subject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  kind text := TG_ARGV[0];
BEGIN
  IF EXISTS (SELECT 1 FROM workflow_task t WHERE t.subject_kind = kind AND t.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM workflow_discrepancy d WHERE d.subject_kind = kind AND d.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM workflow_sla_clock c JOIN workflow_task t ON t.id = c.task_id WHERE t.subject_kind = kind AND t.subject_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_has_foundation_rows';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER workflow_registration_delete_guard BEFORE DELETE ON registration_application
  FOR EACH ROW EXECUTE FUNCTION workflow_block_subject_delete('registration_application');
CREATE TRIGGER workflow_model_delete_guard BEFORE DELETE ON model_application
  FOR EACH ROW EXECUTE FUNCTION workflow_block_subject_delete('model_application');

CREATE FUNCTION workflow_task_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.subject_kind, NEW.subject_id, NEW.stage, NEW.action, NEW.command_id, NEW.command_payload_hash, NEW.due_at, NEW.created_at)
         IS DISTINCT FROM (OLD.subject_kind, OLD.subject_id, OLD.stage, OLD.action, OLD.command_id, OLD.command_payload_hash, OLD.due_at, OLD.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_task_identity_immutable';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_task_version_conflict';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER workflow_task_identity BEFORE UPDATE ON workflow_task FOR EACH ROW EXECUTE FUNCTION workflow_task_identity_guard();

CREATE FUNCTION workflow_discrepancy_mutation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.subject_kind, NEW.subject_id, NEW.line_code, NEW.summary, NEW.opened_by, NEW.opened_at)
         IS DISTINCT FROM (OLD.subject_kind, OLD.subject_id, OLD.line_code, OLD.summary, OLD.opened_by, OLD.opened_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_discrepancy_identity_immutable';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND current_user = 'bee_runtime' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_discrepancy_status_command_only';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER workflow_discrepancy_mutation BEFORE UPDATE ON workflow_discrepancy FOR EACH ROW EXECUTE FUNCTION workflow_discrepancy_mutation_guard();

CREATE FUNCTION workflow_sla_policy_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'workflow_sla_policy_version_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM workflow_sla_clock c WHERE c.policy_version_id = OLD.id) THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_sla_policy_version_referenced';
    END IF;
    IF session_user <> 'bee_local_maint' AND current_user <> 'bee_local_maint' THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'workflow_sla_policy_delete_refused';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER workflow_sla_policy_immutable_row BEFORE UPDATE OR DELETE ON workflow_sla_policy_version
  FOR EACH ROW EXECUTE FUNCTION workflow_sla_policy_immutable();

CREATE FUNCTION workflow_assert_policy_applicable(p_policy_version uuid, p_anchor timestamptz) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_from date;
  v_to date;
BEGIN
  SELECT effective_from, effective_to INTO v_from, v_to FROM workflow_sla_policy_version WHERE id = p_policy_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_policy_version_missing';
  END IF;
  IF (p_anchor AT TIME ZONE 'Asia/Kolkata')::date < v_from
     OR (v_to IS NOT NULL AND (p_anchor AT TIME ZONE 'Asia/Kolkata')::date >= v_to) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_policy_version_not_applicable';
  END IF;
END $$;

CREATE FUNCTION workflow_idempotency_payload_matches(
  p_row workflow_task, p_hash char(64), p_kind text, p_subject uuid, p_stage text, p_action text,
  p_due timestamptz, p_policy uuid, p_anchor timestamptz
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_row.command_payload_hash IS NOT DISTINCT FROM p_hash
     AND p_row.subject_kind = p_kind AND p_row.subject_id = p_subject
     AND p_row.stage = p_stage AND p_row.action = p_action
     AND p_row.due_at IS NOT DISTINCT FROM p_due;
$$;

CREATE FUNCTION workflow_idempotency_clock_matches(
  p_task uuid, p_policy uuid, p_anchor timestamptz
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_policy IS NULL THEN NOT EXISTS (SELECT 1 FROM workflow_sla_clock c WHERE c.task_id = p_task)
    ELSE EXISTS (
      SELECT 1 FROM workflow_sla_clock c
       WHERE c.task_id = p_task AND c.policy_version_id = p_policy AND c.policy_anchor_at = p_anchor)
  END;
$$;

CREATE FUNCTION workflow_foundation_create_task(
  p_subject_kind text, p_subject_id uuid, p_stage text, p_action text,
  p_owner_role text, p_owner_account uuid,
  p_command_id uuid, p_command_payload_hash char(64),
  p_due_at timestamptz, p_policy_version_id uuid, p_policy_anchor_at timestamptz,
  p_actor_account uuid, p_actor_role text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_id uuid;
  v_row workflow_task;
  v_sla integer;
BEGIN
  PERFORM workflow_validate_subject(p_subject_kind, p_subject_id);
  v_sla := (p_due_at IS NOT NULL)::integer + (p_policy_version_id IS NOT NULL)::integer + (p_policy_anchor_at IS NOT NULL)::integer;
  IF v_sla NOT IN (0, 3) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_sla_fields_inconsistent';
  END IF;
  IF p_policy_version_id IS NOT NULL THEN
    PERFORM workflow_assert_policy_applicable(p_policy_version_id, p_policy_anchor_at);
  END IF;
  IF p_command_id IS NOT NULL THEN
    IF p_command_payload_hash IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_command_hash_required';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text, 0));
    INSERT INTO workflow_task (subject_kind, subject_id, stage, action, owner_role, owner_account_id, due_at, command_id, command_payload_hash)
    VALUES (p_subject_kind, p_subject_id, p_stage, p_action, p_owner_role, p_owner_account, p_due_at, p_command_id, p_command_payload_hash)
    ON CONFLICT (command_id) WHERE command_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT * INTO v_row FROM workflow_task WHERE command_id = p_command_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'workflow_command_create_race_retry';
      END IF;
      IF NOT workflow_idempotency_payload_matches(v_row, p_command_payload_hash, p_subject_kind, p_subject_id, p_stage, p_action, p_due_at, p_policy_version_id, p_policy_anchor_at)
         OR NOT workflow_idempotency_clock_matches(v_row.id, p_policy_version_id, p_policy_anchor_at) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'workflow_idempotency_conflict';
      END IF;
      RETURN v_row.id;
    END IF;
  ELSE
    INSERT INTO workflow_task (subject_kind, subject_id, stage, action, owner_role, owner_account_id, due_at)
    VALUES (p_subject_kind, p_subject_id, p_stage, p_action, p_owner_role, p_owner_account, p_due_at)
    RETURNING id INTO v_id;
  END IF;
  IF p_policy_version_id IS NOT NULL THEN
    INSERT INTO workflow_sla_clock (task_id, policy_version_id, policy_anchor_at)
    VALUES (v_id, p_policy_version_id, p_policy_anchor_at);
  END IF;
  INSERT INTO workflow_task_event (task_id, kind, to_owner_role, to_owner_account, actor_account_id, actor_role)
  VALUES (v_id, 'created', p_owner_role, p_owner_account, p_actor_account, p_actor_role);
  RETURN v_id;
END $$;

CREATE FUNCTION workflow_foundation_reassign_task(
  p_task uuid, p_expected_version integer, p_to_role text, p_to_account uuid,
  p_actor_account uuid, p_actor_role text, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_from_role text;
  v_from_account uuid;
  n integer;
BEGIN
  SELECT owner_role, owner_account_id INTO v_from_role, v_from_account FROM workflow_task WHERE id = p_task FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_task_missing';
  END IF;
  UPDATE workflow_task
     SET owner_role = p_to_role, owner_account_id = p_to_account, version = version + 1
   WHERE id = p_task AND version = p_expected_version AND status = 'open';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_task_version_conflict';
  END IF;
  INSERT INTO workflow_task_event (task_id, kind, from_owner_role, from_owner_account, to_owner_role, to_owner_account, actor_account_id, actor_role, reason)
  VALUES (p_task, 'reassigned', v_from_role, v_from_account, p_to_role, p_to_account, p_actor_account, p_actor_role, p_reason);
END $$;

CREATE FUNCTION workflow_foundation_terminal_task(
  p_task uuid, p_expected_version integer, p_status text,
  p_actor_account uuid, p_actor_role text, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  n integer;
  v_kind text;
BEGIN
  IF p_status NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workflow_task_terminal_status_invalid';
  END IF;
  v_kind := CASE WHEN p_status = 'completed' THEN 'completed' ELSE 'cancelled' END;
  PERFORM 1 FROM workflow_task WHERE id = p_task FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_task_missing';
  END IF;
  UPDATE workflow_task SET status = p_status, version = version + 1
   WHERE id = p_task AND version = p_expected_version AND status = 'open';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_task_version_conflict';
  END IF;
  INSERT INTO workflow_task_event (task_id, kind, actor_account_id, actor_role, reason)
  VALUES (p_task, v_kind, p_actor_account, p_actor_role, p_reason);
END $$;

CREATE FUNCTION workflow_foundation_discrepancy_respond(
  p_discrepancy uuid, p_response_seq integer, p_body text, p_responded_by uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_status text;
  v_next integer;
BEGIN
  SELECT status INTO v_status FROM workflow_discrepancy WHERE id = p_discrepancy FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_discrepancy_missing';
  END IF;
  IF v_status NOT IN ('open', 'needs_more') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_discrepancy_not_accepting_response';
  END IF;
  SELECT coalesce(max(response_seq), 0) + 1 INTO v_next FROM workflow_discrepancy_response WHERE discrepancy_id = p_discrepancy;
  IF p_response_seq <> v_next THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_discrepancy_response_seq_gap';
  END IF;
  INSERT INTO workflow_discrepancy_response (discrepancy_id, response_seq, body, responded_by)
  VALUES (p_discrepancy, p_response_seq, p_body, p_responded_by);
  UPDATE workflow_discrepancy SET status = 'awaiting_review' WHERE id = p_discrepancy;
END $$;

CREATE FUNCTION workflow_foundation_discrepancy_dispose(
  p_discrepancy uuid, p_response_seq integer, p_outcome text, p_note text, p_disposed_by uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_status text;
  v_target integer;
BEGIN
  SELECT status INTO v_status FROM workflow_discrepancy WHERE id = p_discrepancy FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_discrepancy_missing';
  END IF;
  IF v_status <> 'awaiting_review' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_discrepancy_not_awaiting_review';
  END IF;
  SELECT r.response_seq INTO v_target
    FROM workflow_discrepancy_response r
    LEFT JOIN workflow_discrepancy_disposition d ON d.discrepancy_id = r.discrepancy_id AND d.response_seq = r.response_seq
   WHERE r.discrepancy_id = p_discrepancy AND d.id IS NULL
   ORDER BY r.response_seq DESC LIMIT 1;
  IF v_target IS NULL OR p_response_seq <> v_target THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_discrepancy_disposition_target';
  END IF;
  INSERT INTO workflow_discrepancy_disposition (discrepancy_id, response_seq, outcome, note, disposed_by)
  VALUES (p_discrepancy, p_response_seq, p_outcome, p_note, p_disposed_by);
  IF p_outcome = 'needs_more' THEN
    UPDATE workflow_discrepancy SET status = 'needs_more' WHERE id = p_discrepancy;
  ELSE
    UPDATE workflow_discrepancy SET status = 'closed' WHERE id = p_discrepancy;
  END IF;
END $$;

CREATE FUNCTION workflow_foundation_append_clock_event(
  p_clock_id uuid, p_event_kind text, p_responsible_party text, p_occurred_at timestamptz, p_note text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  r record;
  v_started boolean := false;
  v_paused boolean := false;
  v_stopped boolean := false;
  v_last_at timestamptz;
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workflow_sla_clock WHERE id = p_clock_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_sla_clock_missing';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_clock_id::text, 0));
  FOR r IN
    SELECT event_kind, responsible_party, occurred_at FROM workflow_sla_clock_event
     WHERE clock_id = p_clock_id
     ORDER BY occurred_at, id
  LOOP
    IF v_last_at IS NOT NULL AND r.occurred_at <= v_last_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_not_monotonic';
    END IF;
    v_last_at := r.occurred_at;
    IF v_stopped THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_after_stop';
    END IF;
    CASE r.event_kind
      WHEN 'start' THEN
        IF v_started THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_duplicate_start'; END IF;
        IF r.responsible_party <> 'bureau' THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_start_party'; END IF;
        v_started := true;
      WHEN 'pause' THEN
        IF NOT v_started OR v_paused THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_pause_invalid'; END IF;
        IF r.responsible_party <> 'applicant' THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_pause_party'; END IF;
        v_paused := true;
      WHEN 'resume' THEN
        IF NOT v_paused THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_resume_invalid'; END IF;
        IF r.responsible_party <> 'applicant' THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_resume_party'; END IF;
        v_paused := false;
      WHEN 'stop' THEN
        IF NOT v_started OR v_paused THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_stop_invalid'; END IF;
        IF r.responsible_party <> 'bureau' THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_stop_party'; END IF;
        v_stopped := true;
      ELSE
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workflow_clock_unknown_kind';
    END CASE;
  END LOOP;
  IF v_last_at IS NOT NULL AND p_occurred_at <= v_last_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_not_monotonic';
  END IF;
  IF v_stopped THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_after_stop';
  END IF;
  CASE p_event_kind
    WHEN 'start' THEN
      IF v_started THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_duplicate_start'; END IF;
      IF p_responsible_party <> 'bureau' THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_start_party'; END IF;
    WHEN 'pause' THEN
      IF NOT v_started OR v_paused THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_pause_invalid'; END IF;
      IF p_responsible_party <> 'applicant' THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_pause_party'; END IF;
    WHEN 'resume' THEN
      IF NOT v_paused THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_resume_invalid'; END IF;
      IF p_responsible_party <> 'applicant' THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_resume_party'; END IF;
    WHEN 'stop' THEN
      IF NOT v_started OR v_paused THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_stop_invalid'; END IF;
      IF p_responsible_party <> 'bureau' THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_clock_stop_party'; END IF;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workflow_clock_unknown_kind';
  END CASE;
  INSERT INTO workflow_sla_clock_event (clock_id, event_kind, responsible_party, occurred_at, note)
  VALUES (p_clock_id, p_event_kind, p_responsible_party, p_occurred_at, p_note)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION workflow_foundation_create_task(text, uuid, text, text, text, uuid, uuid, char(64), timestamptz, uuid, timestamptz, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION workflow_foundation_reassign_task(uuid, integer, text, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION workflow_foundation_terminal_task(uuid, integer, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION workflow_foundation_discrepancy_respond(uuid, integer, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION workflow_foundation_discrepancy_dispose(uuid, integer, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION workflow_foundation_append_clock_event(uuid, text, text, timestamptz, text) FROM PUBLIC;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION %I.workflow_foundation_create_task(text, uuid, text, text, text, uuid, uuid, char(64), timestamptz, uuid, timestamptz, uuid, text) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.workflow_foundation_reassign_task(uuid, integer, text, uuid, uuid, text, text) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.workflow_foundation_terminal_task(uuid, integer, text, uuid, text, text) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.workflow_foundation_discrepancy_respond(uuid, integer, text, uuid) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.workflow_foundation_discrepancy_dispose(uuid, integer, text, text, uuid) SET search_path = %I, pg_temp', home_schema, home_schema);
  EXECUTE format('ALTER FUNCTION %I.workflow_foundation_append_clock_event(uuid, text, text, timestamptz, text) SET search_path = %I, pg_temp', home_schema, home_schema);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workflow_task_event', 'workflow_discrepancy_response', 'workflow_discrepancy_disposition', 'workflow_sla_clock_event'] LOOP
    EXECUTE format('CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION submission_reject_change()', t);
    EXECUTE format('CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change()', t);
  END LOOP;
END $$;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.workflow_calendar, %I.workflow_calendar_closure, %I.workflow_sla_policy_version, '
      || '%I.workflow_task, %I.workflow_discrepancy, %I.workflow_sla_clock TO bee_local_maint', home_schema, home_schema, home_schema, home_schema, home_schema, home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.workflow_task_event, %I.workflow_discrepancy_response, %I.workflow_discrepancy_disposition, '
      || '%I.workflow_sla_clock_event TO bee_local_maint', home_schema, home_schema, home_schema, home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.workflow_task, %I.workflow_discrepancy, %I.workflow_sla_clock TO bee_runtime', home_schema, home_schema, home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.workflow_discrepancy TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.workflow_task_event, %I.workflow_discrepancy_response, %I.workflow_discrepancy_disposition, '
      || '%I.workflow_sla_clock_event TO bee_runtime', home_schema, home_schema, home_schema, home_schema);
    EXECUTE format('GRANT SELECT ON %I.workflow_calendar, %I.workflow_calendar_closure, %I.workflow_sla_policy_version TO bee_runtime', home_schema, home_schema, home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.workflow_foundation_create_task(text, uuid, text, text, text, uuid, uuid, char(64), timestamptz, uuid, timestamptz, uuid, text) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.workflow_foundation_reassign_task(uuid, integer, text, uuid, uuid, text, text) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.workflow_foundation_terminal_task(uuid, integer, text, uuid, text, text) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.workflow_foundation_discrepancy_respond(uuid, integer, text, uuid) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.workflow_foundation_discrepancy_dispose(uuid, integer, text, text, uuid) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.workflow_foundation_append_clock_event(uuid, text, text, timestamptz, text) TO bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE ON %I.workflow_task, %I.workflow_task_event, %I.workflow_discrepancy_response, %I.workflow_discrepancy_disposition, '
      || '%I.workflow_sla_clock, %I.workflow_sla_clock_event, %I.workflow_sla_policy_version, %I.workflow_calendar, %I.workflow_calendar_closure FROM bee_runtime',
      home_schema, home_schema, home_schema, home_schema, home_schema, home_schema, home_schema, home_schema, home_schema);
    EXECUTE format('REVOKE UPDATE ON %I.workflow_discrepancy FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE DELETE, TRUNCATE ON %I.workflow_task_event, %I.workflow_discrepancy_response, %I.workflow_discrepancy_disposition, '
      || '%I.workflow_sla_clock_event FROM bee_runtime', home_schema, home_schema, home_schema, home_schema);
  END IF;
END $$;
