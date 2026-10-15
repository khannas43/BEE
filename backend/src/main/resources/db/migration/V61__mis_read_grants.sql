-- Demo slice S5 (MIS dashboard): the runtime login may read the tables the read-only MIS panels aggregate. SELECT only, nothing else changes.
-- Local demonstration on provisional rules, not BEE rules.
DO $$
DECLARE
  home_schema text := current_schema();
  t text;
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    FOREACH t IN ARRAY ARRAY['organisation', 'model_application', 'model_application_submission_event', 'model_application_transition_event',
        'model_application_return', 'model_application_rating', 'model_application_fee_confirmation', 'certificate', 'registration_application',
        'registration_fee_confirmation', 'fee_correction_proposal', 'fee_reversal_proposal', 'delegation'] LOOP
      IF to_regclass(format('%I.%I', home_schema, t)) IS NOT NULL THEN
        EXECUTE format('GRANT SELECT ON %I.%I TO bee_runtime', home_schema, t);
      END IF;
    END LOOP;
  END IF;
END $$;
