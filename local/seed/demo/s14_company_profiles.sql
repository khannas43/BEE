-- DEMO: company profiles for the permittee manufacturers that had none (Nova and five named sample manufacturers), so the Manufacturer 360
-- profile shows CIN, GSTIN, registered office, authorised signatory, facilities, permittee number and permittee-since date.
-- Each gets a company-registration record (active) with its trail: signed up, submitted, checks passed, Director approved, observation completed.
-- Synthetic data only. Idempotent: an organisation that already has a registration record is skipped.
DO $$
DECLARE
  v RECORD;
  app uuid;
  ev_approve uuid;
  officer uuid := '00000000-0000-4000-a000-000000000007';
  applicant uuid := '00000000-0000-4000-a000-000000000001';
  org uuid;
  d0 timestamptz;
BEGIN
  FOR v IN
    SELECT * FROM (VALUES
      ('NOVA',        'MOB/2025/90001', 'PT-2025-00101', 'U29300DL2014PTC268145', '07AABCN4521K1ZP', 'Plot 14, Okhla Industrial Area, Phase II', 'New Delhi', 'Delhi',       '110020', 'Rohan Malhotra',  'Managing Director', 'rohan.malhotra@novacool.example',  '9810012345', 'Okhla Plant 1',   'Plot 14, Okhla Industrial Area, Phase II', 'New Delhi', 'Delhi',       '2025-03-10'),
      ('SYNTH-MFG-4', 'MOB/2025/90002', 'PT-2025-00102', 'U29300GJ2016PTC091827', '24AAECH7314D1ZQ', 'Survey 112, GIDC Vatva',                'Ahmedabad', 'Gujarat',     '382445', 'Kiran Desai',     'Director',          'kiran.desai@harborbreeze.example', '9825034567', 'Vatva Works',     'Survey 112, GIDC Vatva',                'Ahmedabad', 'Gujarat',     '2025-04-02'),
      ('SYNTH-MFG-5', 'MOB/2025/90003', 'PT-2025-00103', 'U29190HR2012PTC046553', '06AABCL2288F1Z8', 'Plot 37, Sector 6, IMT Manesar',       'Gurugram',  'Haryana',     '122052', 'Anil Chawla',     'Managing Director', 'anil.chawla@lumenfrost.example',   '9811123456', 'Manesar Plant',   'Plot 37, Sector 6, IMT Manesar',       'Gurugram',  'Haryana',     '2025-04-21'),
      ('SYNTH-MFG-6', 'MOB/2025/90004', 'PT-2025-00104', 'U29300TN2017PTC118264', '33AAFCC5190H1Z2', 'SIPCOT Industrial Park, Sriperumbudur', 'Kancheepuram','Tamil Nadu', '602105', 'Meera Raghavan',  'Director',          'meera.raghavan@cinderpeak.example', '9840245678', 'Sriperumbudur Unit','SIPCOT Industrial Park, Sriperumbudur', 'Kancheepuram','Tamil Nadu', '2025-05-12'),
      ('SYNTH-MFG-7', 'MOB/2025/90005', 'PT-2025-00105', 'U29190KA2015PTC082371', '29AABCM6642L1ZV', '14th Cross, Peenya Industrial Area',    'Bengaluru', 'Karnataka',   '560058', 'Suresh Nair',     'Managing Director', 'suresh.nair@marigoldair.example',  '9880356789', 'Peenya Plant',    '14th Cross, Peenya Industrial Area',    'Bengaluru', 'Karnataka',   '2025-06-03'),
      ('SYNTH-MFG-8', 'MOB/2025/90006', 'PT-2025-00106', 'U29300MH2013PTC245710', '27AAECN3317Q1ZC', 'Gat 88, Chakan MIDC, Phase II',     'Pune',      'Maharashtra', '410501', 'Pooja Kulkarni',  'Director',          'pooja.kulkarni@northwind.example', '9822467890', 'Chakan Plant',    'Gat 88, Chakan MIDC, Phase II',        'Pune',      'Maharashtra', '2025-06-24')
    ) AS t(code, ref, permittee, cin, gstin, line1, city, state, pin, sig, desig, email, phone, fac, fline, fcity, fstate, since)
  LOOP
    SELECT id INTO org FROM organisation WHERE code = v.code;
    CONTINUE WHEN org IS NULL;
    CONTINUE WHEN EXISTS (SELECT 1 FROM manufacturer_onboarding_application WHERE organisation_id = org);
    d0 := (v.since || ' 10:00:00+05:30')::timestamptz;
    INSERT INTO manufacturer_onboarding_application (reference, organisation_id, legal_name, state, version, permittee_number, draft_payload, created_at)
    SELECT v.ref, org, regexp_replace(o.legal_name, '\s*\(synthetic[^)]*\)\s*$', ''), 'active', 5, v.permittee,
      jsonb_build_object(
        'cin', v.cin, 'gstin', v.gstin, 'contacts', '[]'::jsonb, 'annexureNotes', '{}'::jsonb, 'agreementAccepted', true, 'declarationAccepted', true,
        'registeredAddress', jsonb_build_object('line1', v.line1, 'line2', '', 'city', v.city, 'state', v.state, 'pincode', v.pin),
        'facilities', jsonb_build_array(jsonb_build_object('name', v.fac, 'addressLine', v.fline, 'city', v.fcity, 'state', v.fstate, 'pincode', v.pin)),
        'authorisedSignatory', jsonb_build_object('name', v.sig, 'designation', v.desig, 'email', v.email, 'phone', v.phone)),
      d0
    FROM organisation o WHERE o.id = org
    RETURNING id INTO app;
    INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail, occurred_at) VALUES
      (app, 'public_signup', NULL, 'draft', applicant, 'manufacturer', 'Applicant created with simulated email and mobile OTP verification.', d0),
      (app, 'submit', 'draft', 'submitted', applicant, 'manufacturer', 'Submitted with simulated payment', d0 + interval '2 days'),
      (app, 'checks_passed', 'submitted', 'director_review', applicant, 'manufacturer', 'Automated checks passed; awaiting Director decision', d0 + interval '2 days 5 minutes');
    INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail, occurred_at)
      VALUES (app, 'director_approve', 'director_review', 'active_observation', officer, 'officer', 'Director activates manufacturer for observation', d0 + interval '6 days')
      RETURNING id INTO ev_approve;
    INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail, occurred_at)
      VALUES (app, 'observation_completed', 'active_observation', 'active', officer, 'officer', 'Observation period completed with no open anomaly', d0 + interval '186 days');
    INSERT INTO manufacturer_onboarding_permittee_activation (id, application_id, organisation_id, permittee_number, activated_at, transition_event_id)
      VALUES (gen_random_uuid(), app, org, v.permittee, d0 + interval '6 days', ev_approve);
  END LOOP;
END $$;
