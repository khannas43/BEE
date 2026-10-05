-- BL-133 (owner's assumption B11, 4 October 2026, not BEE's decision): a fee confirmation can be CORRECTED, never edited or undone.
-- Finance confirms the receipt reference and the date the money was received by hand; if either is wrong, a person who holds the
-- fee_confirmation_correct permission proposes the right values with a reason, and a DIFFERENT holder approves (the "second Finance
-- approver"). The original confirmation stays exactly as written; the effective values are the latest approved correction. Provisional
-- local rules. Out of scope: reversing a confirmation (moving the application back to fee_due), and the amount (it must equal the fee).

INSERT INTO capability_grant (capability, role) VALUES ('fee_confirmation_correct', 'finance');

CREATE TABLE fee_correction_proposal (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id            uuid NOT NULL REFERENCES model_application (id),
  fee_confirmation_id       uuid NOT NULL REFERENCES model_application_fee_confirmation (id),
  -- what the confirmation said when this was proposed (the latest approved correction, or the original)
  previous_receipt_reference text NOT NULL,
  previous_received_on      date NOT NULL,
  receipt_reference         text NOT NULL CHECK (char_length(receipt_reference) BETWEEN 1 AND 64),
  received_on               date NOT NULL,
  reason                    text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  proposed_by               uuid NOT NULL REFERENCES user_account (id),
  proposed_at               timestamptz NOT NULL DEFAULT now(),
  state                     text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by                uuid REFERENCES user_account (id),
  decided_at                timestamptz,
  decision_note             text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  CHECK ((state = 'pending') = (decided_by IS NULL)),
  CHECK (receipt_reference <> previous_receipt_reference OR received_on <> previous_received_on)
);
-- One correction waits for a decision per confirmation, so two people cannot approve competing corrections.
CREATE UNIQUE INDEX fee_correction_one_pending ON fee_correction_proposal (fee_confirmation_id) WHERE state = 'pending';
CREATE INDEX fee_correction_state ON fee_correction_proposal (state, proposed_at);

-- True when the person may NOT propose or decide a correction on this application: they belong to the paying organisation, or they
-- acted on the application at a stage other than the fee (the same separation rule as the confirmation itself).
CREATE FUNCTION fee_correction_segregated(p_application uuid, p_account uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT EXISTS (SELECT 1 FROM organisation_membership m JOIN model_application a ON a.organisation_id = m.organisation_id
                  WHERE a.id = p_application AND m.user_id = p_account AND m.active)
      OR EXISTS (SELECT 1 FROM model_application_submission_event s WHERE s.application_id = p_application AND s.actor_account_id = p_account)
      OR EXISTS (SELECT 1 FROM model_application_transition_event t WHERE t.application_id = p_application AND t.actor_account_id = p_account AND t.from_state <> 'fee_due');
$$;

-- Decides one proposal; a refusal is a result (first column), never an error, so the caller's transaction stays usable. Refusals:
-- not_found, not_pending, not_permitted, same_person, only_proposer, segregated.
CREATE FUNCTION fee_correction_decide(p_proposal uuid, p_decider uuid, p_decision text, p_note text)
RETURNS TABLE (out_state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  p      fee_correction_proposal%ROWTYPE;
  holds  boolean;
BEGIN
  IF p_decision NOT IN ('approve', 'reject', 'withdraw') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'validation_failed';
  END IF;
  SELECT * INTO p FROM fee_correction_proposal WHERE id = p_proposal FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text;
    RETURN;
  END IF;
  IF p.state <> 'pending' THEN
    RETURN QUERY SELECT 'not_pending'::text;
    RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM role_assignment ra JOIN capability_grant g ON g.role = ra.role AND g.capability = 'fee_confirmation_correct'
                  WHERE ra.user_id = p_decider AND ra.active) INTO holds;
  IF NOT holds THEN
    RETURN QUERY SELECT 'not_permitted'::text;
    RETURN;
  END IF;
  IF p_decision = 'withdraw' THEN
    IF p_decider <> p.proposed_by THEN
      RETURN QUERY SELECT 'only_proposer'::text;
      RETURN;
    END IF;
    UPDATE fee_correction_proposal SET state = 'withdrawn', decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
    RETURN QUERY SELECT 'withdrawn'::text;
    RETURN;
  END IF;
  -- Approving or rejecting is the second person's step, and that person must be someone who may touch this application's fee at all.
  IF p_decider = p.proposed_by THEN
    RETURN QUERY SELECT 'same_person'::text;
    RETURN;
  END IF;
  IF fee_correction_segregated(p.application_id, p_decider) THEN
    RETURN QUERY SELECT 'segregated'::text;
    RETURN;
  END IF;
  UPDATE fee_correction_proposal SET state = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
         decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
  RETURN QUERY SELECT CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END::text;
END $$;

REVOKE ALL ON FUNCTION fee_correction_decide(uuid, uuid, text, text) FROM PUBLIC;

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
  EXECUTE format('DELETE FROM %I.model_application_rejection WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_resubmission WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_return WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_secretary_approval WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_director_recommendation WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_rating WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_reviewer_forward WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_iame_recommendation WHERE application_id = ANY ($1)', home_schema) USING app_ids;
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
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.app_disposable_model_cleanup(uuid[]) TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.fee_correction_proposal TO bee_local_maint', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.fee_correction_proposal TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.fee_correction_decide(uuid, uuid, text, text) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.fee_correction_segregated(uuid, uuid) TO bee_runtime', home_schema);
  END IF;
END $$;
