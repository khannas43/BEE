-- Wave 1 / first slice step 6: the Program Director reviews the rating and recommends approval (director_review ->
-- secretary_approval, or -> approved when the Director's recommendation is final for the category).
-- PROVISIONAL LOCAL ASSUMPTION (decision D1, answered by the owner on 4 October 2026 as an assumption, not by BEE):
-- the Director's recommendation CAN be final for some categories. Which categories is data, in the append-only
-- director_final_rule table (the latest row that has started for a category wins; a change is a new row). The only
-- seeded rule is RAC = not final, so the Secretary step is still exercised end to end; nothing is final until a rule row says so.
CREATE TABLE director_final_rule (
  category_code     text NOT NULL CHECK (category_code ~ '^[A-Z]{2,10}$'),
  effective_from    date NOT NULL,
  director_final    boolean NOT NULL,
  source_reference  text NOT NULL CHECK (length(trim(source_reference)) > 0),
  note              text NOT NULL,
  PRIMARY KEY (category_code, effective_from)
);

CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON director_final_rule
  FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON director_final_rule
  FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change();

INSERT INTO director_final_rule (category_code, effective_from, director_final, source_reference, note) VALUES
  ('RAC', DATE '2026-01-01', false, 'WP07.1e owner assumption on decision D1 (4 October 2026); not a BEE rule',
   'Local default: the Secretary still gives final approval for RAC. A later row can make the Director final.');

CREATE TABLE model_application_director_recommendation (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES model_application (id),
  transition_event_id   uuid NOT NULL UNIQUE REFERENCES model_application_transition_event (id),
  note                  text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 500),
  director_final        boolean NOT NULL,
  resulting_state       text NOT NULL CHECK (resulting_state IN ('secretary_approval', 'approved')),
  recommended_by_account_id uuid NOT NULL REFERENCES user_account (id),
  recommended_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((director_final AND resulting_state = 'approved') OR (NOT director_final AND resulting_state = 'secretary_approval'))
);
CREATE INDEX model_application_director_recommendation_application
  ON model_application_director_recommendation (application_id);

CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON model_application_director_recommendation
  FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON model_application_director_recommendation
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
    EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM bee_runtime', home_schema);
  END IF;
END $$;

COMMENT ON TABLE director_final_rule IS
  'PROVISIONAL assumption (decision D1): whether the Director''s recommendation is final for a category. Append-only; the latest row that has started wins. Not a BEE rule.';
COMMENT ON TABLE model_application_director_recommendation IS
  'Append-only Director recommendation: the note, whether it was final for the category, and the state it led to (secretary_approval or approved).';
