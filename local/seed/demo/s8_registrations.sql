-- S8: sample data for the registration screens. Synthetic only. Idempotent (fixed ids, ON CONFLICT DO NOTHING).
-- Run after s5_mis.sql and s7_register.sql. Does not set bee.demo_seeding; the seed runner does.
--
-- Adds the missing trail on the 11 requests s5 already filed (events only, plus a version correction
-- where that trail now ends on a different number than the one s5 stored). Adds REG-2026-9010..9017
-- (brand) and REG-2026-9020..9023 (PixelCert agency).
--
-- Version numbers follow s5: confirm_fee is version_after 1, and each later step adds one.
-- s5 stored a flat version of 3 on REG-2026-9001..9009, which matches an approved trail and nothing else.
-- Transition event ids use 00000000-0000-4000-c000-000000001520 onward. 1501-1508 are QR batches.
-- Request ids use ...001620 onward. 1601-1613 are QR batches. Other child rows use md5('s8-...').

BEGIN;
DO $$
DECLARE
  applicant uuid := '00000000-0000-4000-a000-000000000001';
  pixel_user uuid := '00000000-0000-4000-a000-000000000002';
  finance uuid := '00000000-0000-4000-a000-000000000003';
  programme uuid := '00000000-0000-4000-a000-000000000006';
  director uuid := '00000000-0000-4000-a000-000000000007';
  nova uuid := '00000000-0000-4000-b000-000000000001';
  pixel uuid := '00000000-0000-4000-b000-000000000002';
  org501 uuid := '00000000-0000-4000-b000-000000000501';
  org502 uuid := '00000000-0000-4000-b000-000000000502';
  org503 uuid := '00000000-0000-4000-b000-000000000503';
  org504 uuid := '00000000-0000-4000-b000-000000000504';
  frostbyte uuid := '00000000-0000-4000-c000-000000001310';
  cooldrift uuid := '00000000-0000-4000-c000-000000001304';
  arctic uuid := '00000000-0000-4000-c000-000000001308';
  glacier uuid := '00000000-0000-4000-c000-000000001306';
  meadow uuid := '00000000-0000-4000-c000-000000001710';
  cedar uuid := '00000000-0000-4000-c000-000000001711';
  auth9020 uuid := '00000000-0000-4000-e000-000000000201';
  rec record;
  v_app uuid;
  v_filed timestamptz;
  v_confirmed timestamptz;
  v_recommend timestamptz;
  v_approve timestamptz;
  v_ev uuid;
  v_sub uuid;
  v_snap uuid;
  v_n int;
  v_actor uuid;
  v_role text;
  v_action text;
  v_auth_from date;
  v_auth_to date;
  v_note text;
  v_at timestamptz;
  v_brand_name text;
  v_owner uuid;
  v_status text;
BEGIN
  -- A. Finish the trails s5 left at confirm_fee. Do not touch 9006, 9101 (programme review) or 9009 (fee due).
  v_n := 1520;
  FOR rec IN
    SELECT * FROM (VALUES
      ('REG-2026-9001'::text, 4),
      ('REG-2026-9002', 8),
      ('REG-2026-9003', 13),
      ('REG-2026-9004', 18),
      ('REG-2026-9005', 25)
    ) AS t(ref, days)
  LOOP
    SELECT id INTO v_app FROM registration_application WHERE reference = rec.ref;
    IF v_app IS NULL THEN
      RAISE EXCEPTION 's8: % is missing; s5_mis.sql has to run on a database that still inserts REG-2026-9001..9009', rec.ref;
    END IF;
    SELECT occurred_at INTO v_filed FROM registration_submission_event WHERE application_id = v_app;
    SELECT occurred_at INTO v_confirmed FROM registration_transition_event WHERE application_id = v_app AND action = 'confirm_fee';
    IF v_filed IS NULL OR v_confirmed IS NULL OR v_confirmed <= v_filed THEN
      RAISE EXCEPTION 's8: % has no filing and fee confirmation to continue from', rec.ref;
    END IF;
    v_approve := v_filed + make_interval(days => rec.days);
    v_recommend := v_confirmed + ((v_approve - v_confirmed) / 2);
    IF v_recommend <= v_confirmed OR v_approve <= v_recommend OR v_approve >= now() THEN
      RAISE EXCEPTION 's8: approval timing for % is not strictly after the fee confirmation and in the past', rec.ref;
    END IF;
    v_ev := ('00000000-0000-4000-c000-' || lpad(v_n::text, 12, '0'))::uuid;
    INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at, note)
      VALUES (v_ev, v_app, 'recommend', 'programme_review', 'director_approval', programme, 'programme', 2, v_recommend,
              'The trade licence is current and the brand name is free. Recommended for approval.')
      ON CONFLICT (id) DO NOTHING;
    v_n := v_n + 1;
    v_ev := ('00000000-0000-4000-c000-' || lpad(v_n::text, 12, '0'))::uuid;
    INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at, note)
      VALUES (v_ev, v_app, 'approve', 'director_approval', 'approved', director, 'director', 3, v_approve,
              'Approved. The brand is on the register.')
      ON CONFLICT (id) DO NOTHING;
    v_n := v_n + 1;
  END LOOP;

  -- 9007 and 9102 are waiting for the Director: the recommendation was the missing step. version_after 2.
  FOR rec IN
    SELECT * FROM (VALUES
      ('REG-2026-9007'::text, 6),
      ('REG-2026-9102', 4)
    ) AS t(ref, days)
  LOOP
    SELECT id INTO v_app FROM registration_application WHERE reference = rec.ref;
    IF v_app IS NULL THEN
      RAISE EXCEPTION 's8: % is missing', rec.ref;
    END IF;
    SELECT occurred_at INTO v_confirmed FROM registration_transition_event WHERE application_id = v_app AND action = 'confirm_fee';
    v_recommend := v_confirmed + make_interval(days => rec.days);
    IF v_confirmed IS NULL OR v_recommend <= v_confirmed OR v_recommend >= now() THEN
      RAISE EXCEPTION 's8: recommendation timing for % is not after the fee confirmation and in the past', rec.ref;
    END IF;
    v_ev := ('00000000-0000-4000-c000-' || lpad(v_n::text, 12, '0'))::uuid;
    INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at, note)
      VALUES (v_ev, v_app, 'recommend', 'programme_review', 'director_approval', programme, 'programme', 2, v_recommend,
              'The trade licence is current and the brand name is free. Recommended for approval.')
      ON CONFLICT (id) DO NOTHING;
    v_n := v_n + 1;
  END LOOP;

  SELECT id INTO v_app FROM registration_application WHERE reference = 'REG-2026-9008';
  IF v_app IS NULL THEN
    RAISE EXCEPTION 's8: REG-2026-9008 is missing';
  END IF;
  SELECT occurred_at INTO v_confirmed FROM registration_transition_event WHERE application_id = v_app AND action = 'confirm_fee';
  v_recommend := v_confirmed + interval '5 days';
  IF v_confirmed IS NULL OR v_recommend <= v_confirmed OR v_recommend >= now() THEN
    RAISE EXCEPTION 's8: return timing for REG-2026-9008 is not after the fee confirmation and in the past';
  END IF;
  v_ev := ('00000000-0000-4000-c000-' || lpad(v_n::text, 12, '0'))::uuid;
  INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at, note)
    VALUES (v_ev, v_app, 'return', 'programme_review', 'returned', programme, 'programme', 2, v_recommend,
            'Trade licence has expired. Upload a current licence and send it again.')
    ON CONFLICT (id) DO NOTHING;

  -- s5 stored version 3 on every 9001..9009 row. 9001..9005 now end at version_after 3, so that number stays.
  -- 9007, 9102 and 9008 now end at version_after 2. Correct the stored version only while they are still in that state,
  -- so a later live decision is not rewound when this file runs again. 9006, 9101 and 9009 are left as s5 wrote them.
  UPDATE registration_application
     SET version = 2
   WHERE reference IN ('REG-2026-9007', 'REG-2026-9102')
     AND state = 'director_approval'
     AND version IS DISTINCT FROM 2;
  UPDATE registration_application
     SET version = 2
   WHERE reference = 'REG-2026-9008'
     AND state = 'returned'
     AND version IS DISTINCT FROM 2;

  -- B and C. New requests. nova.applicant files every brand request, including the synthetic manufacturers, as s5 did.
  -- pixel.applicant files the agency requests. Programme recommends or returns. The Director approves or rejects.
  v_n := 1540;
  FOR rec IN
    SELECT * FROM (VALUES
      -- reference, id suffix, kind, org, brand name, brand id, principal, valid_from, valid_to, state, version, filed days ago, registered brand, registered auth
      ('REG-2026-9010', 1620, 'brand', org501, 'Aurora Chill (synthetic)', NULL::uuid, NULL::uuid, NULL::date, NULL::date, 'rejected', 3, 40, NULL::uuid, NULL::uuid),
      ('REG-2026-9011', 1621, 'brand', org502, 'Polar Wave (synthetic)', NULL::uuid, NULL::uuid, NULL::date, NULL::date, 'rejected', 3, 27, NULL::uuid, NULL::uuid),
      ('REG-2026-9012', 1622, 'brand', org503, 'Cinder North Line (synthetic)', NULL::uuid, NULL::uuid, NULL::date, NULL::date, 'programme_review', 3, 22, NULL::uuid, NULL::uuid),
      ('REG-2026-9013', 1623, 'brand', org504, 'Harbor North Line (synthetic)', NULL::uuid, NULL::uuid, NULL::date, NULL::date, 'programme_review', 1, 9, NULL::uuid, NULL::uuid),
      ('REG-2026-9014', 1624, 'brand', nova, 'Nova Draft Line (synthetic)', NULL::uuid, NULL::uuid, NULL::date, NULL::date, 'fee_due', 1, 4, NULL::uuid, NULL::uuid),
      ('REG-2026-9015', 1625, 'brand', nova, 'Nova Summit Line (synthetic)', NULL::uuid, NULL::uuid, NULL::date, NULL::date, 'director_approval', 2, 15, NULL::uuid, NULL::uuid),
      ('REG-2026-9016', 1626, 'brand', nova, 'Nova Meadow Line (synthetic)', NULL::uuid, NULL::uuid, NULL::date, NULL::date, 'approved', 3, 60, meadow, NULL::uuid),
      ('REG-2026-9017', 1627, 'brand', nova, 'Nova Cedar Line (synthetic)', NULL::uuid, NULL::uuid, NULL::date, NULL::date, 'approved', 3, 48, cedar, NULL::uuid)
    ) AS t(ref, suffix, kind, org, bname, bid, principal, vfrom, vto, st, ver, filed_days, reg_brand, reg_auth)
  LOOP
    v_app := ('00000000-0000-4000-c000-' || lpad(rec.suffix::text, 12, '0'))::uuid;
    v_filed := now() - make_interval(days => rec.filed_days);
    IF rec.reg_brand IS NOT NULL THEN
      INSERT INTO brand (id, name, owner_organisation_id, status, source_reference, verification_status, note)
        VALUES (rec.reg_brand, rec.bname, rec.org, 'active', rec.ref, 'synthetic', 'Synthetic brand registered through ' || rec.ref)
        ON CONFLICT (id) DO NOTHING;
    END IF;
    INSERT INTO registration_application (id, reference, kind, organisation_id, brand_name, state, version, created_at, registered_brand_id)
      VALUES (v_app, rec.ref, rec.kind, rec.org, rec.bname, rec.st, rec.ver, v_filed - interval '2 days', rec.reg_brand)
      ON CONFLICT (id) DO NOTHING;
    v_sub := md5('s8-sub-' || rec.ref)::uuid;
    v_actor := applicant;
    v_role := 'manufacturer';
    INSERT INTO registration_submission_event (id, application_id, from_state, to_state, actor_account_id, actor_role, filing_organisation_id, occurred_at)
      VALUES (v_sub, v_app, 'draft', 'fee_due', v_actor, v_role, rec.org, v_filed)
      ON CONFLICT (id) DO NOTHING;
    v_snap := md5('s8-snap-' || rec.ref)::uuid;
    INSERT INTO registration_fee_snapshot (id, application_id, submission_event_id, amount_inr, tax_rate_percent, fee_rule_key, fee_rule_version, verification_status, note, captured_at)
      VALUES (v_snap, v_app, v_sub, 5000.00, 0, 'RAC:registration', 1, 'synthetic', 'Synthetic amount', v_filed)
      ON CONFLICT (id) DO NOTHING;
    IF rec.st = 'fee_due' THEN
      CONTINUE;
    END IF;
    v_at := v_filed + interval '2 days';
    v_ev := ('00000000-0000-4000-c000-' || lpad(v_n::text, 12, '0'))::uuid;
    v_n := v_n + 1;
    INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
      VALUES (v_ev, v_app, 'confirm_fee', 'fee_due', 'programme_review', finance, 'finance', 1, v_at)
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO registration_fee_confirmation (id, application_id, transition_event_id, fee_snapshot_id, amount_inr, receipt_reference, received_on, confirmed_by_account_id, confirmed_at)
      VALUES (md5('s8-fc-' || rec.ref)::uuid, v_app, v_ev, v_snap, 5000.00, 'S8-RCPT-' || right(rec.ref, 4),
              (v_at AT TIME ZONE 'Asia/Kolkata')::date, finance, v_at)
      ON CONFLICT (id) DO NOTHING;
    IF rec.ref = 'REG-2026-9013' THEN
      CONTINUE;
    END IF;
    IF rec.ref = 'REG-2026-9012' THEN
      v_at := v_filed + interval '6 days';
      v_ev := ('00000000-0000-4000-c000-' || lpad(v_n::text, 12, '0'))::uuid;
      v_n := v_n + 1;
      INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at, note)
        VALUES (v_ev, v_app, 'return', 'programme_review', 'returned', programme, 'programme', 2, v_at,
                'The brand name on the trade licence does not match this request. Upload a licence in the same name and send it again.')
        ON CONFLICT (id) DO NOTHING;
      v_at := v_filed + interval '11 days';
      v_ev := ('00000000-0000-4000-c000-' || lpad(v_n::text, 12, '0'))::uuid;
      v_n := v_n + 1;
      INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at, note)
        VALUES (v_ev, v_app, 'resubmit', 'returned', 'programme_review', applicant, 'manufacturer', 3, v_at,
                'Corrected licence uploaded. Sent again.')
        ON CONFLICT (id) DO NOTHING;
      CONTINUE;
    END IF;
    v_at := v_filed + CASE rec.ref
      WHEN 'REG-2026-9010' THEN interval '8 days'
      WHEN 'REG-2026-9011' THEN interval '5 days'
      WHEN 'REG-2026-9015' THEN interval '6 days'
      WHEN 'REG-2026-9016' THEN interval '4 days'
      ELSE interval '9 days' END;
    v_ev := ('00000000-0000-4000-c000-' || lpad(v_n::text, 12, '0'))::uuid;
    v_n := v_n + 1;
    v_note := CASE WHEN rec.st = 'rejected'
      THEN 'The trade licence is current. Sent to the Director to decide the brand name.'
      ELSE 'The trade licence is current and the brand name is free. Recommended for approval.' END;
    INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at, note)
      VALUES (v_ev, v_app, 'recommend', 'programme_review', 'director_approval', programme, 'programme', 2, v_at, v_note)
      ON CONFLICT (id) DO NOTHING;
    IF rec.st = 'director_approval' THEN
      CONTINUE;
    END IF;
    v_action := CASE WHEN rec.st = 'rejected' THEN 'reject' ELSE 'approve' END;
    v_note := CASE WHEN rec.st = 'rejected'
      THEN 'A brand with this name is already registered to another owner.'
      ELSE 'Approved. The brand is on the register.' END;
    v_at := v_filed + CASE rec.ref
      WHEN 'REG-2026-9010' THEN interval '18 days'
      WHEN 'REG-2026-9011' THEN interval '11 days'
      WHEN 'REG-2026-9016' THEN interval '7 days'
      ELSE interval '16 days' END;
    v_ev := ('00000000-0000-4000-c000-' || lpad(v_n::text, 12, '0'))::uuid;
    v_n := v_n + 1;
    INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at, note)
      VALUES (v_ev, v_app, v_action, 'director_approval', rec.st, director, 'director', 3, v_at, v_note)
      ON CONFLICT (id) DO NOTHING;
    IF rec.st = 'approved' THEN
      INSERT INTO register_status_event (id, brand_id, from_status, to_status, source, registration_id, actor_account_id, reason, occurred_at)
        VALUES (md5('s8-regstat-' || rec.ref)::uuid, rec.reg_brand, NULL, 'active', 'registration', v_app, director,
                'Approved. The brand is on the register.', v_at)
        ON CONFLICT (id) DO NOTHING;
    END IF;
  END LOOP;

  -- C. PixelCert agency requests. Brands are the s7 register brands.
  -- Frostbyte has no PixelCert authorisation. Cooldrift and Arctic Pulse have only a revoked one, so a later approval does not overlap.
  -- Glacier One has an active grant through 2027-07-06; the fee-due request starts the day that grant ends.
  SELECT b.name, b.owner_organisation_id, b.status INTO v_brand_name, v_owner, v_status FROM brand b WHERE b.id = frostbyte;
  IF v_status IS DISTINCT FROM 'active' OR v_owner IS NULL THEN
    RAISE EXCEPTION 's8: Frostbyte (s7 brand ...1310) is not an active brand; s7_register.sql has to run first';
  END IF;
  v_auth_from := current_date - 20;
  v_auth_to := (v_auth_from + interval '1 year')::date;
  INSERT INTO agency_authorisation (id, agency_organisation_id, principal_organisation_id, brand_id, valid_from, valid_to, status, source_reference, verification_status, note)
    VALUES (auth9020, pixel, v_owner, frostbyte, v_auth_from, v_auth_to, 'active', 'REG-2026-9020', 'synthetic',
            'Synthetic authorisation created with REG-2026-9020')
    ON CONFLICT (id) DO NOTHING;

  FOR rec IN
    SELECT * FROM (VALUES
      ('REG-2026-9020', 1628, frostbyte, 'approved', 3, 33, auth9020, v_auth_from, v_auth_to),
      ('REG-2026-9021', 1629, cooldrift, 'director_approval', 2, 12, NULL::uuid, current_date - 14, (current_date - 14) + 365),
      ('REG-2026-9022', 1630, arctic, 'programme_review', 1, 8, NULL::uuid, current_date - 10, (current_date - 10) + 365),
      ('REG-2026-9023', 1631, glacier, 'fee_due', 1, 3, NULL::uuid, date '2027-07-06', date '2028-07-06')
    ) AS t(ref, suffix, bid, st, ver, filed_days, reg_auth, vfrom, vto)
  LOOP
    SELECT b.name, b.owner_organisation_id, b.status INTO v_brand_name, v_owner, v_status FROM brand b WHERE b.id = rec.bid;
    IF v_status IS DISTINCT FROM 'active' OR v_owner IS NULL THEN
      RAISE EXCEPTION 's8: brand % for % is not active', rec.bid, rec.ref;
    END IF;
    v_app := ('00000000-0000-4000-c000-' || lpad(rec.suffix::text, 12, '0'))::uuid;
    v_filed := now() - make_interval(days => rec.filed_days);
    INSERT INTO registration_application (
        id, reference, kind, organisation_id, principal_organisation_id, brand_id, brand_name, valid_from, valid_to,
        state, version, created_at, registered_authorisation_id)
      VALUES (v_app, rec.ref, 'agency', pixel, v_owner, rec.bid, v_brand_name, rec.vfrom, rec.vto,
              rec.st, rec.ver, v_filed - interval '2 days', rec.reg_auth)
      ON CONFLICT (id) DO NOTHING;
    v_sub := md5('s8-sub-' || rec.ref)::uuid;
    INSERT INTO registration_submission_event (id, application_id, from_state, to_state, actor_account_id, actor_role, filing_organisation_id, occurred_at)
      VALUES (v_sub, v_app, 'draft', 'fee_due', pixel_user, 'agency', pixel, v_filed)
      ON CONFLICT (id) DO NOTHING;
    v_snap := md5('s8-snap-' || rec.ref)::uuid;
    INSERT INTO registration_fee_snapshot (id, application_id, submission_event_id, amount_inr, tax_rate_percent, fee_rule_key, fee_rule_version, verification_status, note, captured_at)
      VALUES (v_snap, v_app, v_sub, 5000.00, 0, 'RAC:registration', 1, 'synthetic', 'Synthetic amount', v_filed)
      ON CONFLICT (id) DO NOTHING;
    IF rec.st = 'fee_due' THEN
      CONTINUE;
    END IF;
    v_at := v_filed + interval '2 days';
    v_ev := ('00000000-0000-4000-c000-' || lpad(v_n::text, 12, '0'))::uuid;
    v_n := v_n + 1;
    INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
      VALUES (v_ev, v_app, 'confirm_fee', 'fee_due', 'programme_review', finance, 'finance', 1, v_at)
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO registration_fee_confirmation (id, application_id, transition_event_id, fee_snapshot_id, amount_inr, receipt_reference, received_on, confirmed_by_account_id, confirmed_at)
      VALUES (md5('s8-fc-' || rec.ref)::uuid, v_app, v_ev, v_snap, 5000.00, 'S8-RCPT-' || right(rec.ref, 4),
              (v_at AT TIME ZONE 'Asia/Kolkata')::date, finance, v_at)
      ON CONFLICT (id) DO NOTHING;
    IF rec.st = 'programme_review' THEN
      CONTINUE;
    END IF;
    v_at := v_filed + CASE WHEN rec.ref = 'REG-2026-9020' THEN interval '11 days' ELSE interval '5 days' END;
    v_ev := ('00000000-0000-4000-c000-' || lpad(v_n::text, 12, '0'))::uuid;
    v_n := v_n + 1;
    INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at, note)
      VALUES (v_ev, v_app, 'recommend', 'programme_review', 'director_approval', programme, 'programme', 2, v_at,
              'The brand is active, the owner matches, and the period does not overlap another grant. Recommended for approval.')
      ON CONFLICT (id) DO NOTHING;
    IF rec.st = 'director_approval' THEN
      CONTINUE;
    END IF;
    v_at := v_filed + interval '23 days';
    v_ev := ('00000000-0000-4000-c000-' || lpad(v_n::text, 12, '0'))::uuid;
    v_n := v_n + 1;
    INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at, note)
      VALUES (v_ev, v_app, 'approve', 'director_approval', 'approved', director, 'director', 3, v_at,
              'Approved. PixelCert may act for this brand for one year.')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO register_status_event (id, authorisation_id, from_status, to_status, valid_to_after, source, registration_id, actor_account_id, reason, occurred_at)
      VALUES (md5('s8-regstat-' || rec.ref)::uuid, rec.reg_auth, NULL, 'active', rec.vto, 'registration', v_app, director,
              'Approved. PixelCert may act for this brand for one year.', v_at)
      ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;
COMMIT;
