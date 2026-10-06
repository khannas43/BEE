-- BL-142 (owner's assumption B17, 6 October 2026, not BEE's decision): a fee confirmation recorded in error can be REVERSED, never edited or deleted.
-- A person who holds the fee_confirmation_correct permission (Finance today) proposes the reversal with a reason; a DIFFERENT holder approves.
-- Allowed only while nothing has happened to the application since the confirmation: it is in IAME scrutiny and the confirmation is the
-- latest step. If anyone has started work (a recommendation, a return, a resubmission) the reversal is refused and needs a manual decision.
-- On approval, in the same transaction: the application goes back from IAME scrutiny to fee due, a "reverse_fee" step is written to the
-- history, the IAME assignment is released, and the applicant's organisation is told the fee is due again. The confirmation stays exactly as
-- written (marked reversed by the approved reversal); Finance then confirms the fee again as a new confirmation. Provisional local rules.

CREATE TABLE fee_reversal_proposal (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES model_application (id),
  fee_confirmation_id   uuid NOT NULL REFERENCES model_application_fee_confirmation (id),
  reason                text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  proposed_by           uuid NOT NULL REFERENCES user_account (id),
  proposed_at           timestamptz NOT NULL DEFAULT now(),
  state                 text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by            uuid REFERENCES user_account (id),
  decided_at            timestamptz,
  decision_note         text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  -- the history step an approved reversal wrote
  transition_event_id   uuid UNIQUE REFERENCES model_application_transition_event (id),
  CHECK ((state = 'pending') = (decided_by IS NULL)),
  CHECK ((state = 'approved') = (transition_event_id IS NOT NULL))
);
-- One reversal waits per confirmation, and a confirmation is reversed at most once.
CREATE UNIQUE INDEX fee_reversal_one_pending ON fee_reversal_proposal (fee_confirmation_id) WHERE state = 'pending';
CREATE UNIQUE INDEX fee_reversal_one_approved ON fee_reversal_proposal (fee_confirmation_id) WHERE state = 'approved';
CREATE INDEX fee_reversal_state ON fee_reversal_proposal (state, proposed_at);

-- A proposal is born pending. The runtime login may insert one, so nothing it inserts may already be decided or carry a history step: only
-- fee_reversal_decide() moves a proposal on.
CREATE FUNCTION fee_reversal_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state <> 'pending' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_note IS NOT NULL OR NEW.transition_event_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'a fee reversal is proposed as pending and decided only through fee_reversal_decide';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER fee_reversal_born_pending BEFORE INSERT ON fee_reversal_proposal
  FOR EACH ROW EXECUTE FUNCTION fee_reversal_insert_guard();

-- True while the confirmation can still be reversed: not reversed already, the application is in IAME scrutiny, and the confirmation is the
-- latest thing that happened to it.
CREATE FUNCTION fee_reversal_possible(p_application uuid, p_confirmation uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT COALESCE((
    SELECT a.state = 'iame_scrutiny'
       AND EXISTS (SELECT 1 FROM model_application_fee_confirmation fc
                    WHERE fc.id = p_confirmation AND fc.application_id = p_application
                      AND fc.transition_event_id = (SELECT e.id FROM model_application_transition_event e WHERE e.application_id = p_application
                                                      ORDER BY e.occurred_at DESC, e.version_after DESC LIMIT 1))
       AND NOT EXISTS (SELECT 1 FROM fee_reversal_proposal r WHERE r.fee_confirmation_id = p_confirmation AND r.state = 'approved')
      FROM model_application a WHERE a.id = p_application), false);
$$;

-- The same separation rule as a correction, except that a reversal step in the history does not bar its approver from confirming again:
-- reversing is part of the fee stage, not another stage.
CREATE OR REPLACE FUNCTION fee_correction_segregated(p_application uuid, p_account uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT EXISTS (SELECT 1 FROM organisation_membership m JOIN model_application a ON a.organisation_id = m.organisation_id
                  WHERE a.id = p_application AND m.user_id = p_account AND m.active)
      OR EXISTS (SELECT 1 FROM model_application_submission_event s WHERE s.application_id = p_application AND s.actor_account_id = p_account)
      OR EXISTS (SELECT 1 FROM model_application_transition_event t WHERE t.application_id = p_application AND t.actor_account_id = p_account
                                                                         AND t.from_state <> 'fee_due' AND t.action <> 'reverse_fee');
$$;

-- Decides one reversal; a refusal is a result (first column), never an error, so the caller's transaction stays usable. Refusals:
-- not_found, not_pending, not_permitted, same_person, only_proposer, segregated, not_possible (work has started, so nothing is changed).
CREATE FUNCTION fee_reversal_decide(p_proposal uuid, p_decider uuid, p_decision text, p_note text)
RETURNS TABLE (out_state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  p      fee_reversal_proposal%ROWTYPE;
  holds  boolean;
  r      text;
  v      integer;
  ev     uuid;
BEGIN
  IF p_decision NOT IN ('approve', 'reject', 'withdraw') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'validation_failed';
  END IF;
  SELECT * INTO p FROM fee_reversal_proposal WHERE id = p_proposal FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text;
    RETURN;
  END IF;
  IF p.state <> 'pending' THEN
    RETURN QUERY SELECT 'not_pending'::text;
    RETURN;
  END IF;
  SELECT ra.role INTO r FROM role_assignment ra JOIN capability_grant g ON g.role = ra.role AND g.capability = 'fee_confirmation_correct'
   WHERE ra.user_id = p_decider AND ra.active ORDER BY ra.role LIMIT 1;
  holds := r IS NOT NULL;
  IF NOT holds THEN
    RETURN QUERY SELECT 'not_permitted'::text;
    RETURN;
  END IF;
  IF p_decision = 'withdraw' THEN
    IF p_decider <> p.proposed_by THEN
      RETURN QUERY SELECT 'only_proposer'::text;
      RETURN;
    END IF;
    UPDATE fee_reversal_proposal SET state = 'withdrawn', decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
    RETURN QUERY SELECT 'withdrawn'::text;
    RETURN;
  END IF;
  IF p_decider = p.proposed_by THEN
    RETURN QUERY SELECT 'same_person'::text;
    RETURN;
  END IF;
  IF fee_correction_segregated(p.application_id, p_decider) THEN
    RETURN QUERY SELECT 'segregated'::text;
    RETURN;
  END IF;
  IF p_decision = 'reject' THEN
    UPDATE fee_reversal_proposal SET state = 'rejected', decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
    RETURN QUERY SELECT 'rejected'::text;
    RETURN;
  END IF;
  -- Approve: lock the application, and only then check that nothing has happened since the confirmation.
  PERFORM 1 FROM model_application WHERE id = p.application_id FOR UPDATE;
  IF NOT fee_reversal_possible(p.application_id, p.fee_confirmation_id) THEN
    RETURN QUERY SELECT 'not_possible'::text;
    RETURN;
  END IF;
  UPDATE model_application SET state = 'fee_due', version = version + 1 WHERE id = p.application_id RETURNING version INTO v;
  INSERT INTO model_application_transition_event (application_id, action, from_state, to_state, actor_account_id, actor_role, version_after)
  VALUES (p.application_id, 'reverse_fee', 'iame_scrutiny', 'fee_due', p_decider, r, v) RETURNING id INTO ev;
  UPDATE assignment SET active = false WHERE subject_type = 'model_application' AND subject_id = p.application_id AND stage = 'iame_scrutiny' AND active;
  UPDATE fee_reversal_proposal SET state = 'approved', decided_by = p_decider, decided_at = now(), decision_note = p_note, transition_event_id = ev WHERE id = p.id;
  RETURN QUERY SELECT 'approved'::text;
END $$;

REVOKE ALL ON FUNCTION fee_reversal_decide(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fee_reversal_possible(uuid, uuid) FROM PUBLIC;

-- The applicant's organisation is told the fee is due again. The reason is Finance's internal note and is not in the text.
CREATE FUNCTION notify_on_fee_reversal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  IF OLD.state = 'pending' AND NEW.state = 'approved' THEN
    PERFORM notify_application_organisation(NEW.application_id, 'fee_due',
      'has its fee due again: Finance reversed the confirmation of the fee. Finance confirms it again when it is received.');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION notify_on_fee_reversal() FROM PUBLIC;

CREATE TRIGGER notify_after_fee_reversal AFTER UPDATE ON fee_reversal_proposal
  FOR EACH ROW EXECUTE FUNCTION notify_on_fee_reversal();

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
  EXECUTE format('DELETE FROM %I.notification WHERE application_id = ANY ($1)', home_schema) USING app_ids;
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

REVOKE ALL ON FUNCTION app_disposable_model_cleanup(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_disposable_model_cleanup(uuid[]) FROM bee_app;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.app_disposable_model_cleanup(uuid[]) TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.fee_reversal_proposal TO bee_local_maint', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    -- The runtime login proposes a reversal and reads them; it decides only through the function, which moves the application.
    EXECUTE format('GRANT SELECT, INSERT ON %I.fee_reversal_proposal TO bee_runtime', home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.fee_reversal_proposal FROM bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.fee_reversal_decide(uuid, uuid, text, text) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.fee_reversal_possible(uuid, uuid) TO bee_runtime', home_schema);
  END IF;
END $$;
