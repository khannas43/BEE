-- DEMO: two Nova certificates that show the validity states, so the register and the quarterly screens are not all "valid":
--   BEE/RAC/2023/10050 (NC-RAC-09K): three years ended on 2026-10-04, so it is EXPIRED;
--   BEE/RAC/2023/10051 (NC-RAC-12K): three years end on 2026-11-12, so it EXPIRES SOON.
-- Each is an approved model application with a rating, a certificate and a committed ledger chain (the chain verifies as MATCH).
-- Certificates cannot be edited once issued, so these are new ones. Synthetic data only. Idempotent.
-- The empty evidence, fee and product-detail fields are filled by s17_approved_model_details.sql, which runs after this file.
DO $$
DECLARE
  nova uuid := '00000000-0000-4000-b000-000000000001';
  filer uuid := '00000000-0000-4000-a000-000000000001';
  reviewer uuid := '00000000-0000-4000-a000-000000000005';
  sec uuid := '00000000-0000-4000-a000-000000000008';
  adm uuid := '00000000-0000-4000-a000-000000000009';
  org_name text := 'Nova Cool Appliances Pvt Ltd (synthetic)';
  brand_id uuid;
  v RECORD;
  app uuid; rate_ev uuid; ok_ev uuid; cert uuid; tx uuid; h text; prev text := repeat('0', 64);
BEGIN
  IF to_regclass('ledger_tx') IS NULL THEN
    RETURN;
  END IF;
  SELECT id INTO brand_id FROM brand WHERE owner_organisation_id = nova AND name = 'Nova Cool' LIMIT 1;
  FOR v IN SELECT * FROM (VALUES
      (1, 'DEMO-OLD-0001', 'NC-RAC-09K', 'BEE/RAC/2023/10050', 10050, date '2023-10-05', date '2026-10-04', 3, 3.85),
      (2, 'DEMO-OLD-0002', 'NC-RAC-12K', 'BEE/RAC/2023/10051', 10051, date '2023-11-13', date '2026-11-12', 4, 4.20)
    ) AS t(n, ref, model, reg, seq, valid_from, valid_to, stars, iseer)
  LOOP
    app := md5('s18-app-' || v.n)::uuid;
    CONTINUE WHEN EXISTS (SELECT 1 FROM model_application WHERE id = app);
    rate_ev := md5('s18-rate-' || v.n)::uuid; ok_ev := md5('s18-ok-' || v.n)::uuid; cert := md5('s18-cert-' || v.n)::uuid; tx := md5('s18-tx-' || v.n)::uuid;
    INSERT INTO model_application (id, reference, organisation_id, brand_id, brand_name, category, model_number, state, version, created_at)
      VALUES (app, v.ref, nova, brand_id, 'Nova Cool', 'RAC', v.model, 'approved', 2, (v.valid_from - 40)::timestamptz);
    INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
      VALUES (rate_ev, app, 'rate', 'rating', 'director_review', reviewer, 'reviewer', 1, (v.valid_from - 1)::timestamptz);
    INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
      VALUES (ok_ev, app, 'approve', 'secretary_approval', 'approved', sec, 'director', 2, v.valid_from::timestamptz);
    INSERT INTO model_application_rating (id, application_id, transition_event_id, rating_version, basis, scheme_key, declared_iseer, verified_iseer, stars, computed_by_account_id)
      VALUES (md5('s18-rt-' || v.n)::uuid, app, rate_ev, 1, 'local_demo', 'rac_demo', v.iseer, v.iseer, v.stars, reviewer);
    INSERT INTO certificate (id, application_id, transition_event_id, registration_id, category_code, issue_year, sequence_no, valid_from, valid_to,
                             organisation_name, brand_name, model_number, stars, declared_iseer, verified_iseer, scheme_key, issued_by_account_id, issued_at)
      VALUES (cert, app, ok_ev, v.reg, 'RAC', 2023, v.seq, v.valid_from, v.valid_to, org_name, 'Nova Cool', v.model, v.stars, v.iseer, v.iseer, 'rac_demo', sec, v.valid_from::timestamptz);
    h := ledger_compute_hash(prev, v.reg, org_name, 'Nova Cool', v.model, 'RAC', v.stars, v.iseer, v.valid_from, v.valid_to, 'issue', 1);
    INSERT INTO ledger_tx (id, certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, submitted_by, decided_by, created_at, committed_at)
      VALUES (tx, cert, 1, 1, 'issue', 'committed', prev, h, v.valid_to, sec, adm, v.valid_from::timestamptz + interval '2 hours', v.valid_from::timestamptz + interval '2 hours 5 seconds');
    INSERT INTO ledger_event (id, certificate_id, tx_id, action, actor_account_id, reason, occurred_at)
      VALUES (md5('s18-ev-' || v.n)::uuid, cert, tx, 'commit', adm, 'seeded', v.valid_from::timestamptz + interval '2 hours 5 seconds');
  END LOOP;
END $$;
