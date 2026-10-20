-- DEMO: five products on the shortlist for random testing, waiting for the BEE Officer's approval. NC-RAC-S2B (Nova) is there on risk and grievances
-- (4 complaints, never tested); the other four come from one risk-weighted random draw. Synthetic data only.
-- Idempotent: skipped when a shortlisted case exists.
DO $$
DECLARE
  officer uuid := '00000000-0000-4000-a000-000000000007';
  draw uuid := gen_random_uuid();
  r record;
  n int;
  picks text := '';
  w int;
BEGIN
  IF EXISTS (SELECT 1 FROM test_case WHERE stage = 'shortlisted') THEN
    RETURN;
  END IF;
  SELECT count(*) INTO n FROM test_case;
  FOR r IN
    SELECT c.registration_id, c.model_number, c.brand_name, c.verified_iseer, a.organisation_id, x.score, x.basis, x.k
    FROM (VALUES ('BEE/RAC/2026/10902', 36, 'risk', 1), ('BEE/RAC/2026/10303', 31, 'random', 2), ('BEE/RAC/2026/10801', 30, 'random', 3),
                 ('BEE/RAC/2026/10806', 30, 'random', 4), ('BEE/RAC/2026/91052', 30, 'random', 5)) AS x(reg, score, basis, k)
    JOIN certificate c ON c.registration_id = x.reg JOIN model_application a ON a.id = c.application_id ORDER BY x.k
  LOOP
    n := n + 1;
    w := r.score + 5;
    IF r.basis = 'random' THEN
      picks := picks || r.registration_id || ':' || w || ';';
    END IF;
    INSERT INTO test_case (reference, registration_id, model_number, brand_name, organisation_id, basis, reason, risk_score, stage, rated_iseer, selected_by, selected_at, updated_at, draw_id)
    VALUES (format('TC-2026-%s', lpad(n::text, 4, '0')), r.registration_id, r.model_number, r.brand_name, r.organisation_id, r.basis,
            CASE WHEN r.basis = 'risk' THEN 'Shortlisted from the risk ranking: 4 grievances in 90 days (cooling twice) and never tested by BEE.'
                 ELSE 'Drawn at random with weight ' || w || ' (risk score ' || r.score || ' plus a base of 5).' END,
            r.score, 'shortlisted', r.verified_iseer, officer, now() - make_interval(hours => 2 + r.k), now() - make_interval(hours => 2 + r.k),
            CASE WHEN r.basis = 'random' THEN draw END);
    INSERT INTO test_case_event (case_id, stage, note, by_user, at)
    SELECT id, 'shortlisted', reason, officer, selected_at FROM test_case WHERE reference = format('TC-2026-%s', lpad(n::text, 4, '0'));
  END LOOP;
  INSERT INTO selection_draw (id, by_user, seed, size, picks, at) VALUES (draw, officer, 4711, 4, picks, now() - interval '4 hours');
END $$;
