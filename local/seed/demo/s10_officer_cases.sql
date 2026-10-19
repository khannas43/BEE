-- DEMO: gives the three model applications waiting with the BEE Officer (DEMO-Q-0001, -0002, -0004, written by s5_mis.sql) the evidence a
-- real application would carry by that stage: laboratory, test date, declared efficiency, the IAME finding, the BEE scrutiny forward and the
-- Programme rating, so the approval page shows a complete case. Synthetic data only. Idempotent (fixed ids, ON CONFLICT DO NOTHING).
-- The state and version of each application already say "director_review, version 4"; these rows are the trail that leads there.
BEGIN;
DO $$
DECLARE
  iame uuid := '00000000-0000-4000-a000-000000000004';
  reviewer uuid := '00000000-0000-4000-a000-000000000005';
  programme uuid := '00000000-0000-4000-a000-000000000006';
  q int;
  app uuid;
  labs text[] := ARRAY['LAB', 'LAB', 'LAB'];
  tested date[] := ARRAY[(current_date - 40), (current_date - 33), (current_date - 29)];
  declared numeric[] := ARRAY[4.62, 4.35, 5.05];
  stars int[] := ARRAY[4, 3, 5];
  qs int[] := ARRAY[1, 2, 4];
  i int;
  base timestamptz;
BEGIN
  FOR i IN 1..3 LOOP
    q := qs[i];
    app := ('00000000-0000-4000-c000-00000000d00' || q)::uuid;
    base := now() - (CASE q WHEN 1 THEN 14 WHEN 2 THEN 8 ELSE 5 END) * interval '1 day';
    UPDATE model_application SET laboratory_code = labs[i], tested_on = tested[i], declared_iseer = declared[i] WHERE id = app AND laboratory_code IS NULL;
    INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at) VALUES
      (md5('s10-iame-' || q)::uuid, app, 'iame_recommend', 'iame_scrutiny', 'bee_scrutiny', iame, 'iame', 2, base),
      (md5('s10-fwd-' || q)::uuid, app, 'reviewer_forward', 'bee_scrutiny', 'rating', reviewer, 'reviewer', 3, base + interval '1 day'),
      (md5('s10-rate-' || q)::uuid, app, 'compute_rating', 'rating', 'director_review', programme, 'programme', 4, base + interval '2 days')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO model_application_iame_recommendation (id, application_id, transition_event_id, verification, note, recommended_by_account_id, recommended_at)
      VALUES (md5('s10-iamerow-' || q)::uuid, app, md5('s10-iame-' || q)::uuid, 'verified',
              'Laboratory accreditation and test report checked against the declaration; no discrepancy found (synthetic).', iame, base)
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO model_application_reviewer_forward (id, application_id, transition_event_id, note, forwarded_by_account_id, forwarded_at)
      VALUES (md5('s10-fwdrow-' || q)::uuid, app, md5('s10-fwd-' || q)::uuid,
              'Evidence complete and consistent with the IAME finding; forwarded to rating (synthetic).', reviewer, base + interval '1 day')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO model_application_rating (id, application_id, transition_event_id, rating_version, basis, scheme_key, declared_iseer, verified_iseer, stars,
                                          computed_by_account_id, computed_at)
      VALUES (md5('s10-rating-' || q)::uuid, app, md5('s10-rate-' || q)::uuid, 1, 'local_demo', 'RAC-ISEER-DEMO-1', declared[i], declared[i], stars[i],
              programme, base + interval '2 days')
      ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;
COMMIT;
