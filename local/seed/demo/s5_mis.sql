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

-- Richer MIS history (synthetic). Separate from the block above so a database that already has SYN-MA-0001 still receives it.
-- Idempotent: fixed ids, ON CONFLICT DO NOTHING. Approved certificates are dated within about eight months, so they stay newer than
-- the 90037..90040 ledger certificates and do not take their seeded ledger states. Category stays RAC: model_application only allows RAC.
BEGIN;
DO $$
DECLARE
  applicant uuid := '00000000-0000-4000-a000-000000000001';
  finance   uuid := '00000000-0000-4000-a000-000000000003';
  iame      uuid := '00000000-0000-4000-a000-000000000004';
  reviewer  uuid := '00000000-0000-4000-a000-000000000005';
  director  uuid := '00000000-0000-4000-a000-000000000007';
  secretary uuid := '00000000-0000-4000-a000-000000000008';
  admin     uuid := '00000000-0000-4000-a000-000000000009';
  programme uuid := '00000000-0000-4000-a000-000000000006';
  helpdesk  uuid := '00000000-0000-4000-a000-000000000010';
  nova      uuid := '00000000-0000-4000-b000-000000000001';
  pixel     uuid := '00000000-0000-4000-b000-000000000002';
  org_ids uuid[] := ARRAY[
    '00000000-0000-4000-b000-000000000501','00000000-0000-4000-b000-000000000502','00000000-0000-4000-b000-000000000503',
    '00000000-0000-4000-b000-000000000504','00000000-0000-4000-b000-000000000505','00000000-0000-4000-b000-000000000506',
    '00000000-0000-4000-b000-000000000507','00000000-0000-4000-b000-000000000508']::uuid[];
  org_names text[] := ARRAY[
    'Synthetic Maker One (synthetic, MIS demo)','Synthetic Maker Two (synthetic, MIS demo)','Synthetic Maker Three (synthetic, MIS demo)',
    'Harbor Breeze Cooling Pvt Ltd (synthetic)','Lumen Frost Appliances Pvt Ltd (synthetic)','Cinder Peak Cooling Pvt Ltd (synthetic)',
    'Marigold Air Systems Pvt Ltd (synthetic)','Northwind Comforts Pvt Ltd (synthetic)'];
  brand_names text[] := ARRAY[
    'Synthetic Brand 1','Synthetic Brand 2','Synthetic Brand 3',
    'Harbor Breeze (synthetic)','Lumen Frost (synthetic)','Cinder Peak (synthetic)',
    'Marigold Air (synthetic)','Northwind Comfort (synthetic)'];
  n int; o int; bucket int; month_back int; app uuid; brand uuid; sub_ev uuid; snap uuid; ev uuid; rate_ev uuid;
  submitted timestamptz; approved_ts timestamptz; st text; amount numeric; iseer numeric; stars int; days int; yr int;
BEGIN
  FOR o IN 4..8 LOOP
    INSERT INTO organisation (id, code, kind, legal_name) VALUES (org_ids[o], 'SYNTH-MFG-' || o, 'manufacturer', org_names[o]) ON CONFLICT (id) DO NOTHING;
    -- Harbor, Lumen and Cinder already have these names from the production seed. A second id would break UNIQUE (owner, name).
    INSERT INTO brand (id, name, owner_organisation_id, status, source_reference, verification_status, note)
      SELECT md5('s5b-brand-' || o)::uuid, brand_names[o], org_ids[o], 'active', 'S5 MIS demo seed (synthetic)', 'synthetic', 'Synthetic MIS demo brand'
      WHERE NOT EXISTS (SELECT 1 FROM brand b WHERE b.owner_organisation_id = org_ids[o] AND b.name = brand_names[o])
      ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- 80 more applications (SYN-MA-0041..0120) so the synthetic history is about 120, with a spring filing bulge.
  FOR n IN 41..120 LOOP
    o := 1 + ((n - 1) % 8);
    bucket := n % 20;
    st := CASE bucket
      WHEN 0 THEN 'draft' WHEN 1 THEN 'draft'
      WHEN 2 THEN 'fee_due' WHEN 3 THEN 'fee_due' WHEN 4 THEN 'fee_due'
      WHEN 5 THEN 'iame_scrutiny' WHEN 6 THEN 'iame_scrutiny'
      WHEN 7 THEN 'bee_scrutiny'
      WHEN 8 THEN 'rating'
      WHEN 9 THEN 'director_review'
      WHEN 10 THEN 'secretary_approval'
      WHEN 17 THEN 'returned' WHEN 18 THEN 'returned'
      WHEN 19 THEN 'rejected'
      ELSE 'approved' END;
    month_back := (ARRAY[2,3,4,5,5,6,6,6,7,7,8,3])[1 + (n % 12)];
    submitted := now() - make_interval(months => month_back, days => (n % 17), hours => (n * 5) % 20);
    days := 8 + (n % 8);
    approved_ts := submitted + make_interval(days => days);
    amount := 25000 + (n % 4) * 2500;
    iseer := round((3.40 + (n % 16) * 0.10)::numeric, 2);
    stars := CASE WHEN iseer >= 5 THEN 5 WHEN iseer >= 4.50 THEN 4 WHEN iseer >= 4.00 THEN 3 WHEN iseer >= 3.50 THEN 2 ELSE 1 END;
    SELECT b.id INTO brand FROM brand b WHERE b.owner_organisation_id = org_ids[o] AND b.name = brand_names[o];
    app := md5('s5b-ma-' || n)::uuid;
    INSERT INTO model_application (id, reference, organisation_id, brand_name, category, model_number, state, version, created_at, brand_id,
                                   principal_organisation_id, declared_iseer)
      VALUES (app, 'SYN-MA-' || lpad(n::text, 4, '0'), org_ids[o], brand_names[o], 'RAC', 'SYN-RAC-' || lpad(n::text, 3, '0'), st,
              CASE st WHEN 'draft' THEN 0 WHEN 'fee_due' THEN 1 ELSE 2 END, submitted - interval '4 days', brand, org_ids[o], iseer)
      ON CONFLICT (id) DO NOTHING;
    IF st = 'draft' THEN CONTINUE; END IF;
    sub_ev := md5('s5b-sub-' || n)::uuid;
    INSERT INTO model_application_submission_event (id, application_id, from_state, to_state, actor_account_id, actor_role, filing_organisation_id, occurred_at)
      VALUES (sub_ev, app, 'draft', 'fee_due', applicant, 'manufacturer', org_ids[o], submitted) ON CONFLICT (id) DO NOTHING;
    snap := md5('s5b-snap-' || n)::uuid;
    INSERT INTO model_application_fee_snapshot (id, application_id, submission_event_id, amount_inr, tax_rate_percent, currency, fee_rule_key, fee_rule_version,
                                                verification_status, source_reference, note, captured_at)
      VALUES (snap, app, sub_ev, amount, 0, 'INR', 'RAC:new_model', 2, 'synthetic', 'S5 MIS demo seed (synthetic)', 'Synthetic amount, same band as the first MIS history', submitted)
      ON CONFLICT (id) DO NOTHING;
    IF st = 'fee_due' THEN CONTINUE; END IF;
    ev := md5('s5b-fee-' || n)::uuid;
    INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
      VALUES (ev, app, 'confirm_fee', 'fee_due', 'iame_scrutiny', finance, 'finance', 1, submitted + interval '2 days') ON CONFLICT (id) DO NOTHING;
    INSERT INTO model_application_fee_confirmation (id, application_id, transition_event_id, fee_snapshot_id, amount_inr, receipt_reference, received_on,
                                                    confirmed_by_account_id, confirmed_at)
      VALUES (md5('s5b-fc-' || n)::uuid, app, ev, snap, amount, 'SYN-RCPT-N' || lpad(n::text, 4, '0'),
              ((submitted + interval '2 days') AT TIME ZONE 'Asia/Kolkata')::date, finance, submitted + interval '2 days')
      ON CONFLICT (id) DO NOTHING;
    IF st = 'approved' THEN
      rate_ev := md5('s5b-rate-' || n)::uuid;
      INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
        VALUES (rate_ev, app, 'rate', 'rating', 'director_review', reviewer, 'reviewer', 2, approved_ts - interval '2 days') ON CONFLICT (id) DO NOTHING;
      ev := md5('s5b-ok-' || n)::uuid;
      INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
        VALUES (ev, app, 'approve', 'secretary_approval', 'approved', secretary, 'secretary', 3, approved_ts) ON CONFLICT (id) DO NOTHING;
      INSERT INTO model_application_rating (id, application_id, transition_event_id, rating_version, basis, scheme_key, declared_iseer, verified_iseer, stars,
                                            computed_by_account_id, computed_at)
        VALUES (md5('s5b-rt-' || n)::uuid, app, rate_ev, 1, 'local_demo', 'RAC-ISEER-DEMO-1', iseer, iseer, stars, reviewer, approved_ts - interval '2 days')
        ON CONFLICT (id) DO NOTHING;
      yr := extract(year FROM approved_ts AT TIME ZONE 'Asia/Kolkata')::int;
      INSERT INTO certificate (id, application_id, transition_event_id, registration_id, category_code, issue_year, sequence_no, valid_from, valid_to,
                               organisation_name, brand_name, model_number, stars, declared_iseer, verified_iseer, scheme_key, issued_by_account_id, issued_at)
        VALUES (md5('s5b-cert-' || n)::uuid, app, ev, 'BEE/RAC/' || yr || '/' || (91000 + n), 'RAC', yr, 91000 + n,
                (approved_ts AT TIME ZONE 'Asia/Kolkata')::date, ((approved_ts AT TIME ZONE 'Asia/Kolkata')::date + interval '3 years' - interval '1 day')::date,
                org_names[o], brand_names[o], 'SYN-RAC-' || lpad(n::text, 3, '0'), stars, iseer, iseer, 'RAC-ISEER-DEMO-1', secretary, approved_ts)
        ON CONFLICT (id) DO NOTHING;
    ELSIF st = 'rejected' THEN
      ev := md5('s5b-rj-' || n)::uuid;
      INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
        VALUES (ev, app, 'reject', 'bee_scrutiny', 'rejected', reviewer, 'reviewer', 2, submitted + interval '12 days') ON CONFLICT (id) DO NOTHING;
      INSERT INTO model_application_rejection (id, application_id, transition_event_id, rejected_from_state, reason, rejected_by_account_id, rejected_at)
        VALUES (md5('s5b-rjrow-' || n)::uuid, app, ev, 'bee_scrutiny', 'Test report does not match the declared model (synthetic)', reviewer, submitted + interval '12 days')
        ON CONFLICT (id) DO NOTHING;
    ELSIF st = 'returned' THEN
      ev := md5('s5b-rn-' || n)::uuid;
      INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
        VALUES (ev, app, 'return', 'iame_scrutiny', 'returned', iame, 'iame', 2, submitted + interval '9 days') ON CONFLICT (id) DO NOTHING;
      INSERT INTO model_application_return (id, application_id, transition_event_id, returned_from_state, reason, fp_report_versions, returned_by_account_id, returned_at)
        VALUES (md5('s5b-rnrow-' || n)::uuid, app, ev, 'iame_scrutiny', 'Laboratory name on the report does not match the application (synthetic)', 1, iame, submitted + interval '9 days')
        ON CONFLICT (id) DO NOTHING;
    ELSE
      ev := md5('s5b-hold-' || n)::uuid;
      INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
        VALUES (ev, app, 'hold_stage', 'iame_scrutiny', st, reviewer, 'reviewer', 2, submitted + interval '6 days') ON CONFLICT (id) DO NOTHING;
    END IF;
  END LOOP;

  -- Queues the presenter actually opens: Nova and Pixel rows sitting with Programme (rating) and the Director.
  INSERT INTO model_application (id, reference, organisation_id, brand_name, category, model_number, state, version, created_at) VALUES
    ('00000000-0000-4000-c000-00000000d001', 'DEMO-Q-0001', nova, 'Nova Cool', 'RAC', 'NC-RAC-QDIR-1', 'director_review', 4, now() - interval '18 days'),
    ('00000000-0000-4000-c000-00000000d002', 'DEMO-Q-0002', nova, 'Nova Cool', 'RAC', 'NC-RAC-QDIR-2', 'director_review', 4, now() - interval '11 days'),
    ('00000000-0000-4000-c000-00000000d003', 'DEMO-Q-0003', nova, 'Nova Cool', 'RAC', 'NC-RAC-QRATE', 'rating', 3, now() - interval '9 days'),
    ('00000000-0000-4000-c000-00000000d004', 'DEMO-Q-0004', pixel, 'Aurora Air (synthetic principal)', 'RAC', 'AU-RAC-QDIR', 'director_review', 4, now() - interval '7 days')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO model_application_submission_event (id, application_id, from_state, to_state, actor_account_id, actor_role, filing_organisation_id, occurred_at)
  SELECT ('00000000-0000-4000-c000-00000000d10' || q)::uuid, ('00000000-0000-4000-c000-00000000d00' || q)::uuid, 'draft', 'fee_due',
         CASE WHEN q = 4 THEN '00000000-0000-4000-a000-000000000002'::uuid ELSE applicant END,
         CASE WHEN q = 4 THEN 'agency' ELSE 'manufacturer' END,
         CASE WHEN q = 4 THEN pixel ELSE nova END, now() - interval '20 days'
  FROM generate_series(1, 4) AS g(q)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO model_application_fee_snapshot (id, application_id, submission_event_id, amount_inr, tax_rate_percent, fee_rule_key, fee_rule_version, verification_status, source_reference, note)
  SELECT ('00000000-0000-4000-c000-00000000d20' || q)::uuid, ('00000000-0000-4000-c000-00000000d00' || q)::uuid, ('00000000-0000-4000-c000-00000000d10' || q)::uuid,
         10000, 18, 'rac-model-registration', 1, 'synthetic', 'S5 queue seed', 'Synthetic demonstration fee'
  FROM generate_series(1, 4) AS g(q)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
  SELECT ('00000000-0000-4000-c000-00000000d30' || q)::uuid, ('00000000-0000-4000-c000-00000000d00' || q)::uuid, 'confirm_fee', 'fee_due', 'iame_scrutiny',
         finance, 'finance', 1, now() - interval '16 days'
  FROM generate_series(1, 4) AS g(q)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO model_application_fee_confirmation (id, application_id, transition_event_id, fee_snapshot_id, amount_inr, receipt_reference, received_on, confirmed_by_account_id, confirmed_at)
  SELECT ('00000000-0000-4000-c000-00000000d40' || q)::uuid, ('00000000-0000-4000-c000-00000000d00' || q)::uuid, ('00000000-0000-4000-c000-00000000d30' || q)::uuid,
         ('00000000-0000-4000-c000-00000000d20' || q)::uuid, 11800, 'SYN-RCPT-Q000' || q, (now() AT TIME ZONE 'Asia/Kolkata')::date - 16, finance, now() - interval '16 days'
  FROM generate_series(1, 4) AS g(q)
  ON CONFLICT (id) DO NOTHING;

  -- Two Nova brand registrations sitting with Programme and the Director, so those lists are not empty.
  INSERT INTO registration_application (id, reference, kind, organisation_id, brand_name, state, version, created_at) VALUES
    ('00000000-0000-4000-c000-00000000e001', 'NOVA-REG-001', 'brand', nova, 'Nova Breeze Line (synthetic)', 'programme_review', 2, now() - interval '12 days'),
    ('00000000-0000-4000-c000-00000000e002', 'NOVA-REG-002', 'brand', nova, 'Nova Quiet Line (synthetic)', 'director_approval', 3, now() - interval '20 days')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO registration_submission_event (id, application_id, from_state, to_state, actor_account_id, actor_role, filing_organisation_id, occurred_at) VALUES
    ('00000000-0000-4000-c000-00000000e011', '00000000-0000-4000-c000-00000000e001', 'draft', 'fee_due', applicant, 'manufacturer', nova, now() - interval '12 days'),
    ('00000000-0000-4000-c000-00000000e012', '00000000-0000-4000-c000-00000000e002', 'draft', 'fee_due', applicant, 'manufacturer', nova, now() - interval '20 days')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO registration_fee_snapshot (id, application_id, submission_event_id, amount_inr, fee_rule_key, fee_rule_version, verification_status, note, captured_at) VALUES
    ('00000000-0000-4000-c000-00000000e021', '00000000-0000-4000-c000-00000000e001', '00000000-0000-4000-c000-00000000e011', 5000, 'RAC:registration', 1, 'synthetic', 'Synthetic amount', now() - interval '12 days'),
    ('00000000-0000-4000-c000-00000000e022', '00000000-0000-4000-c000-00000000e002', '00000000-0000-4000-c000-00000000e012', 5000, 'RAC:registration', 1, 'synthetic', 'Synthetic amount', now() - interval '20 days')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at) VALUES
    ('00000000-0000-4000-c000-00000000e031', '00000000-0000-4000-c000-00000000e001', 'confirm_fee', 'fee_due', 'programme_review', finance, 'finance', 1, now() - interval '10 days'),
    ('00000000-0000-4000-c000-00000000e032', '00000000-0000-4000-c000-00000000e002', 'confirm_fee', 'fee_due', 'programme_review', finance, 'finance', 1, now() - interval '18 days')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO registration_fee_confirmation (id, application_id, transition_event_id, fee_snapshot_id, amount_inr, receipt_reference, received_on, confirmed_by_account_id, confirmed_at) VALUES
    ('00000000-0000-4000-c000-00000000e041', '00000000-0000-4000-c000-00000000e001', '00000000-0000-4000-c000-00000000e031', '00000000-0000-4000-c000-00000000e021', 5000, 'SYN-RCPT-NR01', (now() AT TIME ZONE 'Asia/Kolkata')::date - 10, finance, now() - interval '10 days'),
    ('00000000-0000-4000-c000-00000000e042', '00000000-0000-4000-c000-00000000e002', '00000000-0000-4000-c000-00000000e032', '00000000-0000-4000-c000-00000000e022', 5000, 'SYN-RCPT-NR02', (now() AT TIME ZONE 'Asia/Kolkata')::date - 18, finance, now() - interval '18 days')
  ON CONFLICT (id) DO NOTHING;

  -- Open delegations. Born pending, then approved, because a delegation cannot be inserted already decided.
  INSERT INTO delegation (id, delegator_id, delegate_id, role, reason, valid_from, valid_to, state) VALUES
    ('00000000-0000-4000-c000-00000000f001', director, programme, 'director', 'Cover for the approval desk during the demonstration week (synthetic)', current_date, current_date + 14, 'pending'),
    ('00000000-0000-4000-c000-00000000f002', finance, programme, 'finance', 'Fee desk cover while the finance officer is in a meeting (synthetic)', current_date, current_date + 10, 'pending'),
    ('00000000-0000-4000-c000-00000000f003', programme, helpdesk, 'programme', 'Asked so helpdesk can see a programme queue during the demonstration (synthetic)', current_date, current_date + 7, 'pending')
  ON CONFLICT (id) DO NOTHING;
  UPDATE delegation SET state = 'approved', decided_by = admin, decided_at = now(), decision_note = 'Approved for the demonstration (synthetic)'
   WHERE id IN ('00000000-0000-4000-c000-00000000f001', '00000000-0000-4000-c000-00000000f002') AND state = 'pending';
  -- The request row is written by delegation_log_request. Only the approval is added here.
  INSERT INTO delegation_event (id, delegation_id, action, actor_account_id, note) VALUES
    ('00000000-0000-4000-c000-00000000f012', '00000000-0000-4000-c000-00000000f001', 'approved', admin, 'Synthetic demonstration'),
    ('00000000-0000-4000-c000-00000000f022', '00000000-0000-4000-c000-00000000f002', 'approved', admin, 'Synthetic demonstration')
  ON CONFLICT (id) DO NOTHING;
END $$;
COMMIT;
