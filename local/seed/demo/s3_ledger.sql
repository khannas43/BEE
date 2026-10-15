-- DEMO S3 seed: SIMULATED ledger transactions (a local test network, not Hyperledger Fabric) for the first four certificates found.
-- Run after the demo frame has issued certificates. Idempotent: a certificate that already has ledger transactions is left alone.
--   1st certificate: issue committed                      -> active (amend / revoke can be shown live)
--   2nd certificate: issue pending                        -> a second person commits or fails it live
--   3rd certificate: issue failed, retry failed again     -> failed, with attempt history (retry live)
--   4th certificate: issue committed, hash SEEDED MISMATCH -> chain verification reports MISMATCH
-- Synthetic data. Submitted by the Secretary, decided by the Admin.
DO $$
DECLARE
  sec  uuid := '00000000-0000-4000-a000-000000000008';
  adm  uuid := '00000000-0000-4000-a000-000000000009';
  c    certificate%ROWTYPE;
  n    integer := 0;
  prev text;
  h    text;
BEGIN
  IF to_regclass('ledger_tx') IS NULL THEN
    RETURN;
  END IF;
  FOR c IN SELECT * FROM certificate ORDER BY issued_at, id LIMIT 4 LOOP
    n := n + 1;
    CONTINUE WHEN EXISTS (SELECT 1 FROM ledger_tx WHERE certificate_id = c.id);
    prev := repeat('0', 64);
    h := ledger_compute_hash(prev, c.registration_id, c.organisation_name, c.brand_name, c.model_number, c.category_code, c.stars, c.verified_iseer, c.valid_from, c.valid_to, 'issue', 1);
    IF n = 1 THEN
      INSERT INTO ledger_tx (certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, submitted_by, decided_by, created_at, committed_at)
      VALUES (c.id, 1, 1, 'issue', 'committed', prev, h, c.valid_to, sec, adm, now() - interval '3 hours', now() - interval '3 hours' + interval '2 seconds');
    ELSIF n = 2 THEN
      INSERT INTO ledger_tx (certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, submitted_by, created_at)
      VALUES (c.id, 1, 1, 'issue', 'pending', prev, h, c.valid_to, sec, now() - interval '20 minutes');
    ELSIF n = 3 THEN
      INSERT INTO ledger_tx (certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, failure_reason, submitted_by, decided_by, created_at)
      VALUES (c.id, 1, 1, 'issue', 'failed', prev, h, c.valid_to, 'Simulated peer timeout (seeded)', sec, adm, now() - interval '2 hours');
      prev := h;
      h := ledger_compute_hash(prev, c.registration_id, c.organisation_name, c.brand_name, c.model_number, c.category_code, c.stars, c.verified_iseer, c.valid_from, c.valid_to, 'issue', 2);
      INSERT INTO ledger_tx (certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, failure_reason, submitted_by, decided_by, created_at)
      VALUES (c.id, 2, 2, 'issue', 'failed', prev, h, c.valid_to, 'Simulated endorsement policy not met (seeded)', sec, adm, now() - interval '1 hour');
    ELSE
      -- seeded mismatch: the stored hash is not the hash of these certificate fields
      INSERT INTO ledger_tx (certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, submitted_by, decided_by, created_at, committed_at, seeded_note)
      VALUES (c.id, 1, 1, 'issue', 'committed', prev,
              encode(sha256(convert_to('tampered ' || c.registration_id, 'UTF8')), 'hex'), c.valid_to, sec, adm,
              now() - interval '5 hours', now() - interval '5 hours' + interval '2 seconds', 'seeded mismatch: the stored hash was altered for the demonstration');
    END IF;
    INSERT INTO ledger_event (certificate_id, tx_id, action, actor_account_id, reason)
      SELECT t.certificate_id, t.id, 'submit', t.submitted_by, 'seeded' FROM ledger_tx t WHERE t.certificate_id = c.id AND t.seq = 1;
  END LOOP;
END $$;

-- About 30 further ledger certificates: the eight production models as active, plus 22 of mixed states.
-- Issued recently, so they sort after 90037..90040 and do not replace those seeded outcomes. 10101..10104 and 10901..10902 are not included.
DO $$
DECLARE
  sec uuid := '00000000-0000-4000-a000-000000000008';
  adm uuid := '00000000-0000-4000-a000-000000000009';
  reviewer uuid := '00000000-0000-4000-a000-000000000005';
  c certificate%ROWTYPE;
  n int;
  app uuid;
  rate_ev uuid;
  ok_ev uuid;
  cert uuid;
  issued timestamptz;
  yr int;
  seq int;
  reg text;
  org_name text;
  brand text;
  model text;
  stars int;
  iseer numeric;
  valid_from date;
  valid_to date;
  amended date;
  prev text;
  h text;
  h2 text;
  tx1 uuid;
  tx2 uuid;
  kind text;
  org uuid;
BEGIN
  IF to_regclass('ledger_tx') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO organisation (id, code, kind, legal_name) VALUES
    ('00000000-0000-4000-b000-000000000504', 'SYNTH-MFG-4', 'manufacturer', 'Harbor Breeze Cooling Pvt Ltd (synthetic)'),
    ('00000000-0000-4000-b000-000000000505', 'SYNTH-MFG-5', 'manufacturer', 'Lumen Frost Appliances Pvt Ltd (synthetic)'),
    ('00000000-0000-4000-b000-000000000506', 'SYNTH-MFG-6', 'manufacturer', 'Cinder Peak Cooling Pvt Ltd (synthetic)'),
    ('00000000-0000-4000-b000-000000000507', 'SYNTH-MFG-7', 'manufacturer', 'Marigold Air Systems Pvt Ltd (synthetic)'),
    ('00000000-0000-4000-b000-000000000508', 'SYNTH-MFG-8', 'manufacturer', 'Northwind Comforts Pvt Ltd (synthetic)')
  ON CONFLICT (id) DO NOTHING;

  FOR c IN
    SELECT * FROM certificate WHERE application_id IN (
      '00000000-0000-4000-c000-000000001101','00000000-0000-4000-c000-000000001102',
      '00000000-0000-4000-c000-000000001111','00000000-0000-4000-c000-000000001112',
      '00000000-0000-4000-c000-000000001121','00000000-0000-4000-c000-000000001122',
      '00000000-0000-4000-c000-000000001131','00000000-0000-4000-c000-000000001132')
    ORDER BY registration_id
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM ledger_tx WHERE certificate_id = c.id);
    prev := repeat('0', 64);
    h := ledger_compute_hash(prev, c.registration_id, c.organisation_name, c.brand_name, c.model_number, c.category_code, c.stars, c.verified_iseer, c.valid_from, c.valid_to, 'issue', 1);
    tx1 := md5('ldg-prod-' || c.registration_id)::uuid;
    INSERT INTO ledger_tx (id, certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, submitted_by, decided_by, created_at, committed_at)
      VALUES (tx1, c.id, 1, 1, 'issue', 'committed', prev, h, c.valid_to, sec, adm, c.issued_at + interval '1 day', c.issued_at + interval '1 day' + interval '4 seconds')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO ledger_event (id, certificate_id, tx_id, action, actor_account_id, reason, occurred_at)
      VALUES (md5('ldg-prod-ev-' || c.registration_id)::uuid, c.id, tx1, 'submit', sec, 'seeded', c.issued_at + interval '1 day')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO ledger_event (id, certificate_id, tx_id, action, actor_account_id, reason, occurred_at)
      VALUES (md5('ldg-prod-ok-' || c.registration_id)::uuid, c.id, tx1, 'commit', adm, 'seeded', c.issued_at + interval '1 day' + interval '4 seconds')
      ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR n IN 1..22 LOOP
    app := md5('ldg-app-' || n)::uuid;
    CONTINUE WHEN EXISTS (SELECT 1 FROM ledger_tx t JOIN certificate crt ON crt.id = t.certificate_id WHERE crt.application_id = app);
    issued := now() - make_interval(days => 12 + n, hours => n);
    yr := extract(year FROM issued AT TIME ZONE 'Asia/Kolkata')::int;
    seq := 10800 + n;
    reg := 'BEE/RAC/' || yr || '/' || seq;
    org := ('00000000-0000-4000-b000-00000000050' || (4 + ((n - 1) % 5)))::uuid;
    org_name := (ARRAY['Harbor Breeze Cooling Pvt Ltd (synthetic)','Lumen Frost Appliances Pvt Ltd (synthetic)','Cinder Peak Cooling Pvt Ltd (synthetic)',
                       'Marigold Air Systems Pvt Ltd (synthetic)','Northwind Comforts Pvt Ltd (synthetic)'])[1 + ((n - 1) % 5)];
    brand := (ARRAY['Harbor Breeze (synthetic)','Lumen Frost (synthetic)','Cinder Peak (synthetic)','Marigold Air (synthetic)','Northwind Comfort (synthetic)'])[1 + ((n - 1) % 5)];
    model := 'LDG-RAC-' || lpad(n::text, 2, '0');
    iseer := round((3.50 + (n % 15) * 0.10)::numeric, 2);
    stars := CASE WHEN iseer >= 5 THEN 5 WHEN iseer >= 4.50 THEN 4 WHEN iseer >= 4.00 THEN 3 WHEN iseer >= 3.50 THEN 2 ELSE 1 END;
    valid_from := (issued AT TIME ZONE 'Asia/Kolkata')::date;
    valid_to := (valid_from + interval '3 years' - interval '1 day')::date;
    amended := valid_to - 40;
    rate_ev := md5('ldg-rate-' || n)::uuid;
    ok_ev := md5('ldg-ok-' || n)::uuid;
    cert := md5('ldg-cert-' || n)::uuid;
    INSERT INTO model_application (id, reference, organisation_id, brand_name, category, model_number, state, version, created_at)
      VALUES (app, 'DEMO-LDG-' || lpad(n::text, 4, '0'), org, brand, 'RAC', model, 'approved', 2, issued - interval '20 days')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
      VALUES (rate_ev, app, 'rate', 'rating', 'director_review', reviewer, 'reviewer', 1, issued - interval '1 day') ON CONFLICT (id) DO NOTHING;
    INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
      VALUES (ok_ev, app, 'approve', 'secretary_approval', 'approved', sec, 'secretary', 2, issued) ON CONFLICT (id) DO NOTHING;
    INSERT INTO model_application_rating (id, application_id, transition_event_id, rating_version, basis, scheme_key, declared_iseer, verified_iseer, stars, computed_by_account_id)
      VALUES (md5('ldg-rt-' || n)::uuid, app, rate_ev, 1, 'local_demo', 'rac_demo', iseer, iseer, stars, reviewer) ON CONFLICT (id) DO NOTHING;
    INSERT INTO certificate (id, application_id, transition_event_id, registration_id, category_code, issue_year, sequence_no, valid_from, valid_to,
                             organisation_name, brand_name, model_number, stars, declared_iseer, verified_iseer, scheme_key, issued_by_account_id, issued_at)
      VALUES (cert, app, ok_ev, reg, 'RAC', yr, seq, valid_from, valid_to, org_name, brand, model, stars, iseer, iseer, 'rac_demo', sec, issued)
      ON CONFLICT (id) DO NOTHING;

    prev := repeat('0', 64);
    h := ledger_compute_hash(prev, reg, org_name, brand, model, 'RAC', stars, iseer, valid_from, valid_to, 'issue', 1);
    tx1 := md5('ldg-tx-' || n || '-1')::uuid;
    kind := CASE WHEN n BETWEEN 15 AND 16 THEN 'pending' WHEN n BETWEEN 17 AND 18 THEN 'failed' ELSE 'committed' END;
    IF kind = 'pending' THEN
      INSERT INTO ledger_tx (id, certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, submitted_by, created_at)
        VALUES (tx1, cert, 1, 1, 'issue', 'pending', prev, h, valid_to, sec, issued + interval '2 hours') ON CONFLICT (id) DO NOTHING;
    ELSIF kind = 'failed' THEN
      INSERT INTO ledger_tx (id, certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, failure_reason, submitted_by, decided_by, created_at)
        VALUES (tx1, cert, 1, 1, 'issue', 'failed', prev, h, valid_to, 'Simulated peer timeout (seeded)', sec, adm, issued + interval '2 hours')
        ON CONFLICT (id) DO NOTHING;
      h2 := ledger_compute_hash(h, reg, org_name, brand, model, 'RAC', stars, iseer, valid_from, valid_to, 'issue', 2);
      tx2 := md5('ldg-tx-' || n || '-2')::uuid;
      INSERT INTO ledger_tx (id, certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, failure_reason, submitted_by, decided_by, created_at)
        VALUES (tx2, cert, 2, 2, 'issue', 'failed', h, h2, valid_to, 'Simulated endorsement policy not met (seeded)', sec, adm, issued + interval '1 day')
        ON CONFLICT (id) DO NOTHING;
      INSERT INTO ledger_event (id, certificate_id, tx_id, action, actor_account_id, reason, occurred_at)
        VALUES (md5('ldg-ev-' || n || '-retry')::uuid, cert, tx2, 'retry', sec, 'seeded retry', issued + interval '1 day') ON CONFLICT (id) DO NOTHING;
    ELSE
      INSERT INTO ledger_tx (id, certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, submitted_by, decided_by, created_at, committed_at)
        VALUES (tx1, cert, 1, 1, 'issue', 'committed', prev, h, valid_to, sec, adm, issued + interval '2 hours', issued + interval '2 hours' + interval '5 seconds')
        ON CONFLICT (id) DO NOTHING;
      INSERT INTO ledger_event (id, certificate_id, tx_id, action, actor_account_id, reason, occurred_at)
        VALUES (md5('ldg-ev-' || n || '-commit')::uuid, cert, tx1, 'commit', adm, 'seeded', issued + interval '2 hours' + interval '5 seconds')
        ON CONFLICT (id) DO NOTHING;
      IF n BETWEEN 19 AND 20 THEN
        h2 := ledger_compute_hash(h, reg, org_name, brand, model, 'RAC', stars, iseer, valid_from, amended, 'amend', 2);
        tx2 := md5('ldg-tx-' || n || '-2')::uuid;
        INSERT INTO ledger_tx (id, certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, reason, submitted_by, decided_by, created_at, committed_at)
          VALUES (tx2, cert, 2, 1, 'amend', 'committed', h, h2, amended, 'Validity shortened after a model change (synthetic)', sec, adm,
                  issued + interval '5 days', issued + interval '5 days' + interval '5 seconds')
          ON CONFLICT (id) DO NOTHING;
        INSERT INTO ledger_event (id, certificate_id, tx_id, action, actor_account_id, reason, occurred_at)
          VALUES (md5('ldg-ev-' || n || '-amend')::uuid, cert, tx2, 'amend', sec, 'Validity shortened after a model change (synthetic)', issued + interval '5 days')
          ON CONFLICT (id) DO NOTHING;
      ELSIF n >= 21 THEN
        h2 := ledger_compute_hash(h, reg, org_name, brand, model, 'RAC', stars, iseer, valid_from, valid_to, 'revoke', 2);
        tx2 := md5('ldg-tx-' || n || '-2')::uuid;
        INSERT INTO ledger_tx (id, certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, reason, submitted_by, decided_by, created_at, committed_at)
          VALUES (tx2, cert, 2, 1, 'revoke', 'committed', h, h2, valid_to, 'Model withdrawn by the manufacturer (synthetic)', sec, adm,
                  issued + interval '6 days', issued + interval '6 days' + interval '5 seconds')
          ON CONFLICT (id) DO NOTHING;
        INSERT INTO ledger_event (id, certificate_id, tx_id, action, actor_account_id, reason, occurred_at)
          VALUES (md5('ldg-ev-' || n || '-revoke')::uuid, cert, tx2, 'revoke', sec, 'Model withdrawn by the manufacturer (synthetic)', issued + interval '6 days')
          ON CONFLICT (id) DO NOTHING;
      END IF;
    END IF;
    INSERT INTO ledger_event (id, certificate_id, tx_id, action, actor_account_id, reason, occurred_at)
      VALUES (md5('ldg-ev-' || n || '-submit')::uuid, cert, tx1, 'submit', sec, 'seeded', issued + interval '2 hours')
      ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;
