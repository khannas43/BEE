-- Demo slice S6 (local demonstration, not a BEE system): the AI framework. Five registered models (honest cards), stored runs with
-- evidence, and human dispositions. Everything here is ADVISORY: nothing in this slice writes to an application, certificate, fee or any
-- decision record. Runs and dispositions are append-only: a model's output is never changed, an override is stored beside it.

CREATE TABLE ai_model (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{3,60}$'),
  use_case     text NOT NULL UNIQUE CHECK (use_case IN ('compliance-risk', 'production-anomaly', 'rating-trends', 'helpdesk-assist', 'document-extraction')),
  name         text NOT NULL,
  version      text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('rules', 'statistical', 'retrieval', 'extraction')),
  description  text NOT NULL,
  limitations  text NOT NULL,
  trained_on   text NOT NULL,
  status       text NOT NULL CHECK (status IN ('registered', 'retired')),
  registered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_run (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  use_case       text NOT NULL REFERENCES ai_model (use_case),
  model_version  text NOT NULL,
  data_version   text NOT NULL CHECK (data_version ~ '^[0-9a-f]{12}$'),
  input_ref      text,
  output         jsonb NOT NULL,
  confidence     numeric(4, 3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL REFERENCES user_account (id)
);
CREATE INDEX ai_run_use_case ON ai_run (use_case, created_at DESC);

CREATE TABLE ai_disposition (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             uuid NOT NULL REFERENCES ai_run (id),
  actor_account_id   uuid NOT NULL REFERENCES user_account (id),
  actor_role         text NOT NULL,
  decision           text NOT NULL CHECK (decision IN ('accept', 'override', 'reject')),
  reason             text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  override_value     text CHECK (override_value IS NULL OR char_length(override_value) <= 2000),
  field_decisions    jsonb,
  at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_disposition_reason_required CHECK (decision = 'accept' OR (reason IS NOT NULL AND char_length(btrim(reason)) > 0))
);
CREATE INDEX ai_disposition_run ON ai_disposition (run_id, at);

CREATE TABLE ai_audit_event (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid NOT NULL REFERENCES ai_run (id),
  action            text NOT NULL CHECK (action IN ('run', 'disposition')),
  actor_account_id  uuid NOT NULL REFERENCES user_account (id),
  actor_role        text NOT NULL,
  detail            text NOT NULL,
  at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_audit_event_run ON ai_audit_event (run_id, at);

CREATE FUNCTION ai_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'bee_local_maint' AND TG_OP <> 'TRUNCATE' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = format('%s records are append-only (%s refused)', TG_TABLE_NAME, TG_OP);
END $$;

CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON ai_run FOR EACH ROW EXECUTE FUNCTION ai_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON ai_run FOR EACH STATEMENT EXECUTE FUNCTION ai_reject_change();
CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON ai_disposition FOR EACH ROW EXECUTE FUNCTION ai_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON ai_disposition FOR EACH STATEMENT EXECUTE FUNCTION ai_reject_change();
CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON ai_audit_event FOR EACH ROW EXECUTE FUNCTION ai_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON ai_audit_event FOR EACH STATEMENT EXECUTE FUNCTION ai_reject_change();

INSERT INTO ai_model (id, use_case, name, version, kind, description, limitations, trained_on, status) VALUES
  ('compliance-risk-rules', 'compliance-risk', 'Compliance review-priority rules', '1.0.0', 'rules',
   'Transparent weighted rules, not machine learning. Scores each manufacturer for review priority from returned and rejected counts, the gap between declared and verified efficiency, fee confirmation delay, resubmissions and production spikes. Every feature shows its weight, its contribution and the rows behind it.',
   'Weights and caps are the demonstration owner''s assumptions, not BEE rules. Small samples give low confidence. A high score means look first, never that anything is wrong. No labelled enforcement history exists.',
   'Not trained. Rules read live portal tables plus clearly labelled synthetic entities.', 'registered'),
  ('production-anomaly-stats', 'production-anomaly', 'Production spike detector', '1.0.0', 'statistical',
   'Plain statistics, not machine learning: z-score of the latest quarter against the series''s own earlier quarters, and Tukey fences (IQR) across the series. Where QR serial data exists, units are also compared with serials bound.',
   'Needs at least four quarters per series. Genuine business growth also looks like a spike. Uses synthetic rows when the production tables are absent or empty (the screen says so).',
   'Not trained. Computed from the series itself each time.', 'registered'),
  ('rating-trends-stats', 'rating-trends', 'Rating trend summary', '1.0.0', 'statistical',
   'Descriptive statistics, not machine learning: star distribution, monthly mean verified efficiency, an ordinary least squares line per category with a 95 per cent band, and a summary sentence filled from a template.',
   'Few months of data make the line unreliable; the band shows it. Real ratings are few in this local database, so synthetic history is added and counted separately.',
   'Not trained. Computed from rating records each time.', 'registered'),
  ('helpdesk-retrieval', 'helpdesk-assist', 'Helpdesk article retrieval', '1.0.0', 'retrieval',
   'Keyword retrieval, not a language model: TF-IDF cosine similarity between the question and 20 synthetic FAQ articles. Returns the top three articles with scores, a suggested category and a draft reply assembled from the best article.',
   'Knows only the 20 synthetic articles. No case data. Below the confidence threshold it says escalate to a person. The draft is never sent by the system.',
   'Not trained. Index is built from the article table each time.', 'registered'),
  ('document-extraction-regex', 'document-extraction', 'Test-report field extractor', '1.0.0', 'extraction',
   'Pattern matching, not machine learning: reads text from the stored PDF (simple text streams only) and finds laboratory, test date and efficiency with regular expressions, then compares them with what the application declares.',
   'Scanned or image PDFs yield no text. When the PDF has no readable text, a seeded sample report text is used and the output says so. A person confirms each field.',
   'Not trained. Patterns are written by hand.', 'registered');

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.ai_model TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.ai_run, %I.ai_disposition, %I.ai_audit_event TO bee_runtime', home_schema, home_schema, home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.ai_model, %I.ai_run, %I.ai_disposition, %I.ai_audit_event FROM bee_runtime', home_schema, home_schema, home_schema, home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.ai_run, %I.ai_disposition, %I.ai_audit_event TO bee_local_maint', home_schema, home_schema, home_schema);
  END IF;
END $$;

COMMENT ON TABLE ai_run IS 'Demo S6: one stored advisory run. output is never changed; evidence is inside output.';
COMMENT ON TABLE ai_disposition IS 'Demo S6: a person''s accept, override or reject of a run; override and reject need a reason.';
