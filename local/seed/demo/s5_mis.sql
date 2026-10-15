-- Demo slice S5 (MIS dashboard): extra SYNTHETIC history so the charts have shape. Applied only for the demonstration (not part of
-- local/seed/seed.sql, so no existing seeded-row count changes). Idempotent: the whole block is skipped when SYN-MA-0001 exists.
-- Everything here is marked synthetic: organisations SYNTH-MFG-1..3, references SYN-MA-nnnn and SYN-REG-nnn, receipts SYN-RCPT-*,
-- certificates BEE/RAC/<year>/9nnnn (local demonstration, not issued by BEE). Dates are relative to the day the seed runs.
-- Requires local/seed/seed.sql first (people, the BEE organisation). Not BEE data and not BEE rules.
BEGIN;
DO $$
DECLARE
  applicant  uuid := '00000000-0000-4000-a000-000000000001';
  finance    uuid := '00000000-0000-4000-a000-000000000003';
  iame       uuid := '00000000-0000-4000-a000-000000000004';
  reviewer   uuid := '00000000-0000-4000-a000-000000000005';
  programme  uuid := '00000000-0000-4000-a000-000000000006';
  director   uuid := '00000000-0000-4000-a000-000000000007';
  secretary  uuid := '00000000-0000-4000-a000-000000000008';
  stage_state text[] := ARRAY['fee_due','iame_scrutiny','bee_scrutiny','rating','director_review','secretary_approval','approved'];
  stage_actor uuid[];
  stage_role  text[] := ARRAY['manufacturer','finance','iame','reviewer','reviewer','director','secretary'];
  org_ids uuid[] := ARRAY['00000000-0000-4000-b000-000000000501','00000000-0000-4000-b000-000000000502','00000000-0000-4000-b000-000000000503']::uuid[];
  org_names text[] := ARRAY['Synthetic Maker One (synthetic, MIS demo)','Synthetic Maker Two (synthetic, MIS demo)','Synthetic Maker Three (synthetic, MIS demo)'];
  n int; k int; level int; o int; app uuid; sub_ev uuid; snap uuid; ev uuid; ev4 uuid; ev_last uuid;
  submitted timestamptz; step interval; fate text; st text; days_ago numeric; total_days int; amount numeric; stars int; iseer numeric;
  last_ts timestamptz; yr int; approved_ts timestamptz; ref text;
  brand uuid; reg uuid; reg_ev uuid; reg_snap uuid; reg_state text; reg_sub timestamptz; reg_conf uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM model_application WHERE reference = 'SYN-MA-0001') THEN
    RAISE NOTICE 'S5 synthetic MIS history already present; skipped';
    RETURN;
  END IF;
  stage_actor := ARRAY[applicant, finance, iame, reviewer, reviewer, director, secretary];
  FOR o IN 1..3 LOOP
    INSERT INTO organisation (id, code, kind, legal_name) VALUES (org_ids[o], 'SYNTH-MFG-' || o, 'manufacturer', org_names[o]) ON CONFLICT (id) DO NOTHING;
    INSERT INTO brand (id, name, owner_organisation_id, status, source_reference, verification_status, note)
      VALUES (md5('s5-brand-' || o)::uuid, 'Synthetic Brand ' || o, org_ids[o], 'active', 'S5 MIS demo seed (synthetic)', 'synthetic', 'Synthetic MIS demo brand') ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR n IN 1..40 LOOP
    o := 1 + (n % 3);
    days_ago := CASE WHEN n <= 8 THEN 6 + n * 3 ELSE 30 + (n - 8) * 10 END;
    submitted := now() - make_interval(days => days_ago::int, hours => (n * 7) % 24);
    total_days := 6 + (n % 11);
    -- the fate: recent items wait at a stage; older ones are decided
    IF days_ago <= 30 THEN
      fate := 'wait'; level := n % 5;                                                            -- 0 = fee due, 1..4 = iame, bee, rating, director
      st := stage_state[1 + level];
    ELSIF n % 7 = 0 THEN
      fate := 'reject'; level := 2; st := 'rejected';
    ELSIF n % 9 = 0 THEN
      fate := 'return'; level := 1; st := 'returned';
    ELSE
      fate := 'approve'; level := 6; st := 'approved';
    END IF;
    step := make_interval(hours => (total_days * 24) / 6);
    app := md5('s5-ma-' || n)::uuid;
    ref := 'SYN-MA-' || lpad(n::text, 4, '0');
    INSERT INTO model_application (id, reference, organisation_id, brand_name, category, model_number, state, version, created_at, brand_id,
                                   principal_organisation_id, declared_iseer)
      VALUES (app, ref, org_ids[o], 'Synthetic Brand ' || o, 'RAC', 'SYN-RAC-' || lpad(n::text, 3, '0'), st, level + 1, submitted - interval '3 days',
              md5('s5-brand-' || o)::uuid, org_ids[o], 4.00 + (n % 10) / 10.0) ON CONFLICT (id) DO NOTHING;
    sub_ev := md5('s5-sub-' || n)::uuid;
    INSERT INTO model_application_submission_event (id, application_id, from_state, to_state, actor_account_id, actor_role, filing_organisation_id, occurred_at)
      VALUES (sub_ev, app, 'draft', 'fee_due', applicant, 'manufacturer', org_ids[o], submitted) ON CONFLICT (id) DO NOTHING;
    snap := md5('s5-snap-' || n)::uuid;
    amount := 25000 + (n % 4) * 2500;
    INSERT INTO model_application_fee_snapshot (id, application_id, submission_event_id, amount_inr, fee_rule_key, fee_rule_version, verification_status,
                                                source_reference, note, captured_at)
      VALUES (snap, app, sub_ev, amount, 'RAC:new_model', 2, 'synthetic', 'S5 MIS demo seed (synthetic)', 'Synthetic amount', submitted) ON CONFLICT (id) DO NOTHING;
    last_ts := submitted;
    ev4 := NULL; ev_last := NULL;
    FOR k IN 1..level LOOP
      ev := md5('s5-ev-' || n || '-' || k)::uuid;
      last_ts := submitted + step * k;
      INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
        VALUES (ev, app, CASE k WHEN 1 THEN 'confirm_fee' WHEN 2 THEN 'iame_forward' WHEN 3 THEN 'reviewer_forward' WHEN 4 THEN 'rate'
                                WHEN 5 THEN 'director_forward' WHEN 6 THEN 'approve' END,
                stage_state[k], stage_state[k + 1], stage_actor[k + 1], stage_role[k + 1], k, last_ts) ON CONFLICT (id) DO NOTHING;
      IF k = 1 THEN
        INSERT INTO model_application_fee_confirmation (id, application_id, transition_event_id, fee_snapshot_id, amount_inr, receipt_reference, received_on,
                                                        confirmed_by_account_id, confirmed_at)
          VALUES (md5('s5-fc-' || n)::uuid, app, ev, snap, amount, 'SYN-RCPT-M' || lpad(n::text, 4, '0'), (last_ts AT TIME ZONE 'Asia/Kolkata')::date, finance, last_ts)
          ON CONFLICT (id) DO NOTHING;
      END IF;
      IF k = 4 THEN ev4 := ev; END IF;
      ev_last := ev;
    END LOOP;
    stars := 2 + (n % 4);
    iseer := 4.00 + (n % 10) / 10.0;
    IF level >= 4 THEN
      INSERT INTO model_application_rating (id, application_id, transition_event_id, rating_version, basis, scheme_key, declared_iseer, verified_iseer, stars,
                                            computed_by_account_id, computed_at)
        VALUES (md5('s5-rt-' || n)::uuid, app, ev4, 1, 'local_demo', 'RAC-ISEER-DEMO-1', iseer, iseer, stars, reviewer, submitted + step * 4) ON CONFLICT (id) DO NOTHING;
    END IF;
    IF fate = 'approve' THEN
      approved_ts := last_ts;
      yr := extract(year FROM approved_ts AT TIME ZONE 'Asia/Kolkata')::int;
      INSERT INTO certificate (id, application_id, transition_event_id, registration_id, category_code, issue_year, sequence_no, valid_from, valid_to,
                               organisation_name, brand_name, model_number, stars, declared_iseer, verified_iseer, scheme_key, issued_by_account_id, issued_at)
        VALUES (md5('s5-cert-' || n)::uuid, app, ev_last, 'BEE/RAC/' || yr || '/' || (90000 + n), 'RAC', yr, 90000 + n,
                (approved_ts AT TIME ZONE 'Asia/Kolkata')::date, ((approved_ts AT TIME ZONE 'Asia/Kolkata')::date + interval '3 years' - interval '1 day')::date,
                org_names[o], 'Synthetic Brand ' || o, 'SYN-RAC-' || lpad(n::text, 3, '0'), stars, iseer, iseer, 'RAC-ISEER-DEMO-1', secretary, approved_ts)
        ON CONFLICT (id) DO NOTHING;
    ELSIF fate = 'reject' THEN
      ev := md5('s5-evx-' || n)::uuid;
      INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
        VALUES (ev, app, 'reject', 'bee_scrutiny', 'rejected', reviewer, 'reviewer', level + 1, last_ts + interval '2 days') ON CONFLICT (id) DO NOTHING;
      INSERT INTO model_application_rejection (id, application_id, transition_event_id, rejected_from_state, reason, rejected_by_account_id, rejected_at)
        VALUES (md5('s5-rj-' || n)::uuid, app, ev, 'bee_scrutiny', 'Synthetic MIS demo rejection', reviewer, last_ts + interval '2 days') ON CONFLICT (id) DO NOTHING;
    ELSIF fate = 'return' THEN
      ev := md5('s5-evx-' || n)::uuid;
      INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
        VALUES (ev, app, 'return', 'iame_scrutiny', 'returned', iame, 'iame', level + 1, last_ts + interval '2 days') ON CONFLICT (id) DO NOTHING;
      INSERT INTO model_application_return (id, application_id, transition_event_id, returned_from_state, reason, fp_report_versions, returned_by_account_id, returned_at)
        VALUES (md5('s5-rn-' || n)::uuid, app, ev, 'iame_scrutiny', 'Synthetic MIS demo return', 0, iame, last_ts + interval '2 days') ON CONFLICT (id) DO NOTHING;
    END IF;
  END LOOP;

  -- Registrations: brand requests of the synthetic manufacturers, for the registration charts and receipts.
  FOR n IN 1..9 LOOP
    o := 1 + (n % 3);
    reg := md5('s5-reg-' || n)::uuid;
    reg_state := (ARRAY['approved','approved','approved','approved','approved','programme_review','director_approval','returned','fee_due'])[n];
    reg_sub := now() - make_interval(days => 20 + n * 33);
    brand := CASE WHEN reg_state = 'approved' THEN md5('s5-regbrand-' || n)::uuid END;
    IF brand IS NOT NULL THEN
      INSERT INTO brand (id, name, owner_organisation_id, status, source_reference, verification_status, note)
        VALUES (brand, 'Synthetic Registered Brand ' || n, org_ids[o], 'active', 'S5 MIS demo seed (synthetic)', 'synthetic', 'Synthetic registered brand') ON CONFLICT (id) DO NOTHING;
    END IF;
    INSERT INTO registration_application (id, reference, kind, organisation_id, brand_name, state, version, created_at, registered_brand_id)
      VALUES (reg, 'SYN-REG-' || lpad(n::text, 3, '0'), 'brand', org_ids[o], 'Synthetic Registered Brand ' || n, reg_state, 3, reg_sub - interval '2 days', brand)
      ON CONFLICT (id) DO NOTHING;
    reg_ev := md5('s5-regsub-' || n)::uuid;
    INSERT INTO registration_submission_event (id, application_id, from_state, to_state, actor_account_id, actor_role, filing_organisation_id, occurred_at)
      VALUES (reg_ev, reg, 'draft', 'fee_due', applicant, 'manufacturer', org_ids[o], reg_sub) ON CONFLICT (id) DO NOTHING;
    reg_snap := md5('s5-regsnap-' || n)::uuid;
    INSERT INTO registration_fee_snapshot (id, application_id, submission_event_id, amount_inr, fee_rule_key, fee_rule_version, verification_status, note, captured_at)
      VALUES (reg_snap, reg, reg_ev, 5000, 'RAC:registration', 1, 'synthetic', 'Synthetic amount', reg_sub) ON CONFLICT (id) DO NOTHING;
    IF reg_state <> 'fee_due' THEN
      ev := md5('s5-regev1-' || n)::uuid;
      INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
        VALUES (ev, reg, 'confirm_fee', 'fee_due', 'programme_review', finance, 'finance', 1, reg_sub + interval '1 day') ON CONFLICT (id) DO NOTHING;
      INSERT INTO registration_fee_confirmation (id, application_id, transition_event_id, fee_snapshot_id, amount_inr, receipt_reference, received_on,
                                                 confirmed_by_account_id, confirmed_at)
        VALUES (md5('s5-regfc-' || n)::uuid, reg, ev, reg_snap, 5000, 'SYN-RCPT-R' || lpad(n::text, 3, '0'), ((reg_sub + interval '1 day') AT TIME ZONE 'Asia/Kolkata')::date,
                finance, reg_sub + interval '1 day') ON CONFLICT (id) DO NOTHING;
    END IF;
  END LOOP;
END $$;
COMMIT;
