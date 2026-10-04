-- Wave 1 / first slice step 5: Programme computes and records a versioned star rating (rating -> director_review).
-- PROVISIONAL LOCAL DEMONSTRATION. Decision A2 (the approved formula, its inputs and thresholds) is unanswered, and the
-- master_rating_formula guard still refuses any computation from an unverified version. This step therefore does not use
-- that table: it reads the band table below, which is plainly a local demonstration scheme whose values are NOT BEE values,
-- and every rating it writes says so (basis = 'local_demo'). When BEE answers A2, a verified master formula replaces it.
CREATE TABLE rating_demo_band (
  scheme_key        text NOT NULL CHECK (scheme_key ~ '^[A-Z0-9-]{3,40}$'),
  category_code     text NOT NULL CHECK (category_code ~ '^[A-Z]{2,10}$'),
  effective_from    date NOT NULL,
  stars             smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  min_iseer         numeric(4, 2) NOT NULL CHECK (min_iseer > 0),
  source_reference  text NOT NULL CHECK (length(trim(source_reference)) > 0),
  note              text NOT NULL,
  PRIMARY KEY (scheme_key, stars)
);
CREATE INDEX rating_demo_band_resolve ON rating_demo_band (category_code, effective_from);

CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON rating_demo_band
  FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON rating_demo_band
  FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change();

-- Illustrative bands so the flow can be shown end to end. They are invented placeholders, not BEE thresholds.
INSERT INTO rating_demo_band (scheme_key, category_code, effective_from, stars, min_iseer, source_reference, note) VALUES
  ('RAC-ISEER-DEMO-1', 'RAC', DATE '2026-01-01', 1, 3.30, 'WP07.1d local demonstration scheme (decision A2 unanswered); not a BEE value', 'Placeholder band'),
  ('RAC-ISEER-DEMO-1', 'RAC', DATE '2026-01-01', 2, 3.50, 'WP07.1d local demonstration scheme (decision A2 unanswered); not a BEE value', 'Placeholder band'),
  ('RAC-ISEER-DEMO-1', 'RAC', DATE '2026-01-01', 3, 4.00, 'WP07.1d local demonstration scheme (decision A2 unanswered); not a BEE value', 'Placeholder band'),
  ('RAC-ISEER-DEMO-1', 'RAC', DATE '2026-01-01', 4, 4.50, 'WP07.1d local demonstration scheme (decision A2 unanswered); not a BEE value', 'Placeholder band'),
  ('RAC-ISEER-DEMO-1', 'RAC', DATE '2026-01-01', 5, 5.00, 'WP07.1d local demonstration scheme (decision A2 unanswered); not a BEE value', 'Placeholder band');

CREATE TABLE model_application_rating (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES model_application (id),
  transition_event_id   uuid NOT NULL UNIQUE REFERENCES model_application_transition_event (id),
  rating_version        integer NOT NULL CHECK (rating_version >= 1),
  basis                 text NOT NULL CHECK (basis IN ('local_demo')),
  scheme_key            text NOT NULL,
  declared_iseer        numeric(4, 2) NOT NULL CHECK (declared_iseer > 0),
  verified_iseer        numeric(4, 2) NOT NULL CHECK (verified_iseer > 0),
  stars                 smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  computed_by_account_id uuid NOT NULL REFERENCES user_account (id),
  computed_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, rating_version)
);

CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON model_application_rating
  FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON model_application_rating
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
    EXECUTE format('GRANT SELECT ON %I.rating_demo_band TO bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I.rating_demo_band FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_transition_event FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_fee_confirmation FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_iame_recommendation FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_reviewer_forward FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.model_application_rating FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM bee_runtime', home_schema);
  END IF;
END $$;

COMMENT ON TABLE rating_demo_band IS
  'LOCAL DEMONSTRATION star bands for the rating step. Invented placeholders, not BEE values (decision A2 unanswered); replaced by a verified master formula when BEE answers.';
COMMENT ON TABLE model_application_rating IS
  'Append-only, versioned rating record: scheme, the declared and the verified efficiency figure, the stars and who computed them. basis = local_demo marks a rating that is not a BEE rating.';
