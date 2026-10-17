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
  kind               text NOT NULL CHECK (kind IN ('created', 'reassigned', 'completed', 'cancelled', 'due_changed')),
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

CREATE TABLE workflow_sla_clock_event (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind         text NOT NULL CHECK (subject_kind IN ('registration_application', 'model_application')),
  subject_id           uuid NOT NULL,
  policy_version_id    uuid NOT NULL REFERENCES workflow_sla_policy_version (id),
  event_kind           text NOT NULL CHECK (event_kind IN ('start', 'pause', 'resume', 'stop')),
  responsible_party    text NOT NULL CHECK (responsible_party IN ('applicant', 'bureau')),
  occurred_at          timestamptz NOT NULL,
  note                 text CHECK (note IS NULL OR char_length(note) <= 300)
);
CREATE INDEX workflow_sla_clock_subject ON workflow_sla_clock_event (subject_kind, subject_id, occurred_at);

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
CREATE TRIGGER workflow_sla_clock_subject BEFORE INSERT ON workflow_sla_clock_event
  FOR EACH ROW EXECUTE FUNCTION workflow_subject_guard();

CREATE FUNCTION workflow_block_subject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  kind text := TG_ARGV[0];
BEGIN
  IF EXISTS (SELECT 1 FROM workflow_task t WHERE t.subject_kind = kind AND t.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM workflow_discrepancy d WHERE d.subject_kind = kind AND d.subject_id = OLD.id)
     OR EXISTS (SELECT 1 FROM workflow_sla_clock_event c WHERE c.subject_kind = kind AND c.subject_id = OLD.id) THEN
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
    IF (NEW.subject_kind, NEW.subject_id, NEW.stage, NEW.action, NEW.command_id, NEW.command_payload_hash, NEW.created_at)
         IS DISTINCT FROM (OLD.subject_kind, OLD.subject_id, OLD.stage, OLD.action, OLD.command_id, OLD.command_payload_hash, OLD.created_at) THEN
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
    IF NEW.status IS DISTINCT FROM OLD.status AND current_setting('bee.workflow_discrepancy_status', true) <> 'allow' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_discrepancy_status_command_only';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER workflow_discrepancy_mutation BEFORE UPDATE ON workflow_discrepancy FOR EACH ROW EXECUTE FUNCTION workflow_discrepancy_mutation_guard();

CREATE FUNCTION workflow_sla_policy_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF session_user = 'bee_local_maint' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000',
    MESSAGE = format('%s records are append-only (%s refused for %s)', TG_TABLE_NAME, TG_OP, session_user);
END $$;

CREATE TRIGGER workflow_sla_policy_immutable_row BEFORE UPDATE OR DELETE ON workflow_sla_policy_version
  FOR EACH ROW EXECUTE FUNCTION workflow_sla_policy_immutable();

CREATE FUNCTION workflow_foundation_set_task_fields(
  p_task uuid, p_expected_version integer, p_owner_role text, p_owner_account uuid,
  p_status text, p_due_at timestamptz
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  n integer;
BEGIN
  UPDATE workflow_task
     SET owner_role = coalesce(p_owner_role, owner_role),
         owner_account_id = CASE WHEN p_owner_role IS NOT NULL THEN p_owner_account ELSE owner_account_id END,
         status = coalesce(p_status, status),
         due_at = coalesce(p_due_at, due_at),
         version = version + 1
   WHERE id = p_task AND version = p_expected_version AND status = 'open';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workflow_task_version_conflict';
  END IF;
  RETURN 'ok';
END $$;

REVOKE ALL ON FUNCTION workflow_foundation_set_task_fields(uuid, integer, text, uuid, text, timestamptz) FROM PUBLIC;

DO $$
DECLARE
  home_schema text := current_schema();
  f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = to_regnamespace(home_schema) AND p.prosecdef LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = %I, pg_temp', f, home_schema);
  END LOOP;
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
      || '%I.workflow_task, %I.workflow_discrepancy TO bee_local_maint', home_schema, home_schema, home_schema, home_schema, home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.workflow_task_event, %I.workflow_discrepancy_response, %I.workflow_discrepancy_disposition, '
      || '%I.workflow_sla_clock_event TO bee_local_maint', home_schema, home_schema, home_schema, home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.workflow_task TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I.workflow_discrepancy TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.workflow_task_event, %I.workflow_discrepancy_response, %I.workflow_discrepancy_disposition, '
      || '%I.workflow_sla_clock_event TO bee_runtime', home_schema, home_schema, home_schema, home_schema);
    EXECUTE format('GRANT SELECT ON %I.workflow_calendar, %I.workflow_calendar_closure, %I.workflow_sla_policy_version TO bee_runtime', home_schema, home_schema, home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.workflow_foundation_set_task_fields(uuid, integer, text, uuid, text, timestamptz) TO bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE ON %I.workflow_task, %I.workflow_sla_policy_version, %I.workflow_calendar, '
      || '%I.workflow_calendar_closure FROM bee_runtime', home_schema, home_schema, home_schema, home_schema);
    EXECUTE format('REVOKE DELETE, TRUNCATE ON %I.workflow_task_event, %I.workflow_discrepancy_response, %I.workflow_discrepancy_disposition, '
      || '%I.workflow_sla_clock_event FROM bee_runtime', home_schema, home_schema, home_schema, home_schema);
  END IF;
END $$;
