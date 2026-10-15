-- Demo slice S4 (local demonstration on provisional rules, not BEE rules): quarterly production submission, rows, CA evidence, trail.
-- Shared names kept for other slices: production_submission(id, organisation_id, quarter, state), production_row(submission_id, model_application_id, units).

CREATE TABLE production_submission (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisation (id),
  quarter          text NOT NULL CHECK (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  state            text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'submitted', 'accepted', 'query')),
  version          integer NOT NULL DEFAULT 0,
  created_by       uuid NOT NULL REFERENCES user_account (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  submitted_by     uuid REFERENCES user_account (id),
  submitted_at     timestamptz,
  reviewed_by      uuid REFERENCES user_account (id),
  reviewed_at      timestamptz,
  review_note      text CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  UNIQUE (organisation_id, quarter)
);

CREATE TABLE production_row (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id         uuid NOT NULL REFERENCES production_submission (id),
  model_application_id  uuid NOT NULL REFERENCES model_application (id),
  units                 bigint NOT NULL CHECK (units > 0 AND units <= 10000000),
  period_start          date,
  period_end            date,
  registration_id       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (period_start IS NULL OR period_end IS NULL OR period_end >= period_start)
);
CREATE UNIQUE INDEX production_row_period ON production_row (submission_id, model_application_id, coalesce(period_start, 'epoch'::date), coalesce(period_end, 'epoch'::date));

-- CA evidence: the file is stored as given and never parsed; only its hash and the CA's own statement are kept. Recorded, not verified.
CREATE TABLE production_evidence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id     uuid NOT NULL REFERENCES production_submission (id),
  file_name         text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
  media_type        text NOT NULL CHECK (media_type ~ '^[a-z]+/[a-z0-9.+-]+$' AND char_length(media_type) <= 100),
  size_bytes        integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 1048576),
  sha256            text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content           bytea NOT NULL,
  ca_name           text NOT NULL CHECK (char_length(btrim(ca_name)) BETWEEN 1 AND 200),
  ca_membership_no  text NOT NULL CHECK (char_length(btrim(ca_membership_no)) BETWEEN 1 AND 60),
  statement         text NOT NULL CHECK (char_length(btrim(statement)) BETWEEN 1 AND 2000),
  uploaded_by       uuid NOT NULL REFERENCES user_account (id),
  uploaded_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX production_evidence_submission ON production_evidence (submission_id, uploaded_at);

CREATE TABLE production_event (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id     uuid NOT NULL REFERENCES production_submission (id),
  action            text NOT NULL CHECK (action ~ '^[a-z_]{3,40}$'),
  from_state        text,
  to_state          text,
  actor_account_id  uuid NOT NULL REFERENCES user_account (id),
  actor_role        text NOT NULL,
  note              text,
  occurred_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX production_event_submission ON production_event (submission_id, occurred_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['production_event', 'production_evidence'] LOOP
    EXECUTE format('CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION submission_reject_change()', t);
    EXECUTE format('CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change()', t);
  END LOOP;
END $$;

-- Rows and evidence are added only while the submission is editable (draft, or returned with a query); the database refuses otherwise.
CREATE FUNCTION production_editable_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM production_submission WHERE id = NEW.submission_id AND state IN ('draft', 'query')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'a production submission can be changed only while it is a draft or has a query';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER production_row_editable BEFORE INSERT ON production_row FOR EACH ROW EXECUTE FUNCTION production_editable_only();
CREATE TRIGGER production_evidence_editable BEFORE INSERT ON production_evidence FOR EACH ROW EXECUTE FUNCTION production_editable_only();

CREATE FUNCTION production_submission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organisation_id <> OLD.organisation_id OR NEW.quarter <> OLD.quarter THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'organisation and quarter of a submission cannot change';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state IN ('draft', 'query') AND NEW.state = 'submitted')
    OR (OLD.state = 'submitted' AND NEW.state IN ('accepted', 'query'))) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format('a production submission cannot move from %s to %s', OLD.state, NEW.state);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER production_submission_guard BEFORE UPDATE ON production_submission FOR EACH ROW EXECUTE FUNCTION production_submission_guard();

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.production_event, %I.production_evidence, %I.production_row, %I.production_submission TO bee_local_maint',
      home_schema, home_schema, home_schema, home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.production_row, %I.production_evidence, %I.production_event TO bee_runtime', home_schema, home_schema, home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.production_submission TO bee_runtime', home_schema);
    EXECUTE format('GRANT UPDATE (state, version, submitted_by, submitted_at, reviewed_by, reviewed_at, review_note) ON %I.production_submission TO bee_runtime', home_schema);
  END IF;
END $$;
