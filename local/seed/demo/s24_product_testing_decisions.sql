-- DEMO: the Officer's decision on every product testing case, so the list shows each scenario: waiting for approval (s23), approved and in testing,
-- tested, and not approved. The five cases of s22 were approved after being shortlisted (remarks, a shortlisted event before the approval event),
-- and one more shortlisted product (SYN-RAC-076) was declined. Synthetic data only. Idempotent: a case that already has remarks is left alone.
DO $$
DECLARE
  officer uuid := '00000000-0000-4000-a000-000000000007';
  r record;
  old_at timestamptz;
  n int;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('TC-2026-0001', 'Approved. Nine complaints in a month, cooling raised repeatedly, and a retest last quarter: buy a unit from the market this week.'),
      ('TC-2026-0002', 'Approved. Repeated noise complaints; include it in this month''s testing round.'),
      ('TC-2026-0003', 'Approved from the random draw. No objection.'),
      ('TC-2026-0004', 'Approved from the random draw. No objection.'),
      ('TC-2026-0005', 'Approved: the certificate ends in November, so test before renewal.')
    ) AS v(ref, remarks)
  LOOP
    SELECT selected_at INTO old_at FROM test_case WHERE reference = r.ref AND approval_remarks IS NULL;
    CONTINUE WHEN old_at IS NULL;
    UPDATE test_case SET approval_remarks = r.remarks, approved_by = officer, approved_at = old_at, selected_at = old_at - interval '1 day' WHERE reference = r.ref;
    INSERT INTO test_case_event (case_id, stage, note, by_user, at)
    SELECT id, 'shortlisted', reason, officer, old_at - interval '1 day' FROM test_case WHERE reference = r.ref;
    UPDATE test_case_event SET note = r.remarks WHERE stage = 'selected' AND case_id = (SELECT id FROM test_case WHERE reference = r.ref);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM test_case WHERE stage = 'not_approved') THEN
    SELECT count(*) + 1 INTO n FROM test_case;
    INSERT INTO test_case (reference, registration_id, model_number, brand_name, organisation_id, basis, reason, risk_score, stage, rated_iseer, selected_by, selected_at, updated_at,
                           approval_remarks, approved_by, approved_at)
    SELECT format('TC-2026-%s', lpad(n::text, 4, '0')), c.registration_id, c.model_number, c.brand_name, a.organisation_id, 'random',
           'Drawn at random with weight 35 (risk score 30 plus a base of 5).', 30, 'not_approved', c.verified_iseer, officer, now() - interval '3 days', now() - interval '2 days',
           'Not approved. No complaint and no anomaly against this model, and the manufacturer has other models in the current round. Re-check next quarter.', officer, now() - interval '2 days'
    FROM certificate c JOIN model_application a ON a.id = c.application_id WHERE c.registration_id = 'BEE/RAC/2026/91076';
    INSERT INTO test_case_event (case_id, stage, note, by_user, at)
    SELECT id, 'shortlisted', reason, officer, selected_at FROM test_case WHERE reference = format('TC-2026-%s', lpad(n::text, 4, '0'));
    INSERT INTO test_case_event (case_id, stage, note, by_user, at)
    SELECT id, 'not_approved', approval_remarks, officer, approved_at FROM test_case WHERE reference = format('TC-2026-%s', lpad(n::text, 4, '0'));
  END IF;
END $$;
