-- DEMO: product testing for Nova Cool Appliances. 20 customer grievances (from five channels) across four Nova models, one clearly flagged model
-- (NC-RAC-12D: many recent, repeated complaints and an earlier retest), and five BEE test cases, one at each stage: selected, procured from the
-- market, at the laboratory, result in (a fail, not yet closed) and closed (a pass). Names and contacts are made up. Synthetic data only.
-- Idempotent: skipped when grievances already exist.
DO $$
DECLARE
  org uuid;
  officer uuid := '00000000-0000-4000-a000-000000000007';
  models text[][] := ARRAY[['BEE/RAC/2026/10101','NC-RAC-12D'],['BEE/RAC/2026/10102','NC-RAC-18F'],['BEE/RAC/2026/10901','NC-RAC-S2A'],['BEE/RAC/2026/10103','NC-RAC-24H']];
  -- model index | category | days ago | source index | complainant
  g text[] := ARRAY[
    '1|cooling|3|1|Meera Kulkarni','1|cooling|6|2|Sanjay Bhatt','1|power|9|3|Farhan Qureshi','1|cooling|12|1|Lata Deshpande','1|cooling|16|4|Gopal Reddy',
    '1|power|19|2|Pooja Nair','1|noise|23|5|Harish Saini','1|cooling|27|1|Divya Menon','1|power|33|3|Ashok Tiwari',
    '2|cooling|8|2|Ritu Malhotra','2|noise|15|4|Imran Sheikh','2|cooling|24|1|Neelam Joshi','2|noise|38|3|Karthik Iyer','2|label|52|5|Sudha Rao',
    '3|power|11|3|Vivek Chauhan','3|power|29|2|Anjali Bose','3|counterfeit|41|1|Rohit Jain','3|label|57|4|Shalini Das',
    '4|cooling|21|2|Bhavna Patel','4|other|47|5|Manish Gupta'];
  src text[] := ARRAY['qr_scan','helpline','email','consumer_portal','forum'];
  txt jsonb := '{"cooling":"Room does not cool properly even at 18 degrees; the rating promised better performance.","power":"Electricity bill is much higher than a unit of this star rating should cause.","noise":"The outdoor unit is very noisy and vibrates after a few weeks.","label":"The star label on the unit looks different from the label shown on the website.","counterfeit":"Bought from a local shop; the QR code scan did not match the box and the unit looks like a copy.","other":"Remote and display stopped working within the first month."}';
  r text[];
  i int;
  m int;
  case_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM grievance) THEN
    RETURN;
  END IF;
  SELECT id INTO org FROM organisation WHERE code = 'NOVA';
  IF org IS NULL THEN
    RETURN;
  END IF;
  FOR i IN 1..array_length(g, 1) LOOP
    r := string_to_array(g[i], '|');
    m := r[1]::int;
    INSERT INTO grievance (reference, source, category, registration_id, model_number, brand_name, organisation_id, summary, complainant_name, complainant_contact, received_at, status)
    VALUES (format('GR-2026-%s', lpad(i::text, 4, '0')), src[r[4]::int], r[2], models[m][1], models[m][2], 'Nova Cool', org, txt ->> r[2], r[5],
            CASE WHEN i % 2 = 0 THEN lower(replace(r[5], ' ', '.')) || '@example.invalid' ELSE '+91 98xxxx' || lpad((1000 + i * 37)::text, 4, '0') END,
            now() - make_interval(days => r[3]::int, hours => (i * 5) % 11), CASE WHEN r[3]::int > 45 THEN 'closed' ELSE 'open' END);
  END LOOP;

  -- 1 selected (the flagged model)
  case_id := gen_random_uuid();
  INSERT INTO test_case (id, reference, registration_id, model_number, brand_name, organisation_id, basis, reason, risk_score, rated_iseer, selected_by, selected_at, updated_at)
  VALUES (case_id, 'TC-2026-0001', 'BEE/RAC/2026/10101', 'NC-RAC-12D', 'Nova Cool', org, 'risk', 'Highest risk rank: 9 grievances in 33 days (cooling raised 5 times) and a retest last quarter.', 71, 5.05, officer, now() - interval '1 day', now() - interval '1 day');
  INSERT INTO test_case_event (case_id, stage, note, by_user, at) VALUES (case_id, 'selected', 'Highest risk rank: 9 grievances in 33 days (cooling raised 5 times) and a retest last quarter.', officer, now() - interval '1 day');
  -- 2 procured
  case_id := gen_random_uuid();
  INSERT INTO test_case (id, reference, registration_id, model_number, brand_name, organisation_id, basis, reason, risk_score, stage, procured_from, rated_iseer, selected_by, selected_at, updated_at)
  VALUES (case_id, 'TC-2026-0002', 'BEE/RAC/2026/10102', 'NC-RAC-18F', 'Nova Cool', org, 'risk', '5 grievances in 38 days, two about noise; selected from the risk ranking.', 31, 'procured', 'Retail store, Pune (bought by BEE)', 4.55, officer, now() - interval '6 days', now() - interval '2 days');
  INSERT INTO test_case_event (case_id, stage, note, by_user, at) VALUES
    (case_id, 'selected', '5 grievances in 38 days, two about noise; selected from the risk ranking.', officer, now() - interval '6 days'),
    (case_id, 'procured', 'One unit bought from a retail store in Pune with a tax invoice.', officer, now() - interval '2 days');
  -- 3 at the laboratory (drawn at random)
  case_id := gen_random_uuid();
  INSERT INTO test_case (id, reference, registration_id, model_number, brand_name, organisation_id, basis, reason, risk_score, stage, procured_from, laboratory, rated_iseer, selected_by, selected_at, updated_at)
  VALUES (case_id, 'TC-2026-0003', 'BEE/RAC/2026/10901', 'NC-RAC-S2A', 'Nova Cool', org, 'random', 'Drawn at random with weight 41 (risk score 36 plus a base of 5).', 36, 'at_lab', 'Online marketplace order', 'Synthetic Test Laboratory, Bengaluru', 4.05, officer, now() - interval '11 days', now() - interval '3 days');
  INSERT INTO test_case_event (case_id, stage, note, by_user, at) VALUES
    (case_id, 'selected', 'Drawn at random with weight 41 (risk score 36 plus a base of 5).', officer, now() - interval '11 days'),
    (case_id, 'procured', 'Bought through an online marketplace.', officer, now() - interval '8 days'),
    (case_id, 'at_lab', 'Handed to the laboratory for the efficiency test.', officer, now() - interval '3 days');
  -- 4 result in (a fail, not yet closed)
  case_id := gen_random_uuid();
  INSERT INTO test_case (id, reference, registration_id, model_number, brand_name, organisation_id, basis, reason, risk_score, stage, procured_from, laboratory, result, measured_iseer, rated_iseer, tested_on, selected_by, selected_at, updated_at)
  VALUES (case_id, 'TC-2026-0004', 'BEE/RAC/2026/10103', 'NC-RAC-24H', 'Nova Cool', org, 'random', 'Drawn at random with weight 46 (risk score 41 plus a base of 5).', 41, 'result_in', 'Retail store, Nagpur (bought by BEE)', 'Synthetic Test Laboratory, Bengaluru', 'fail', 3.62, 3.85, current_date - 3, officer, now() - interval '24 days', now() - interval '3 days');
  INSERT INTO test_case_event (case_id, stage, note, by_user, at) VALUES
    (case_id, 'selected', 'Drawn at random with weight 46 (risk score 41 plus a base of 5).', officer, now() - interval '24 days'),
    (case_id, 'procured', 'Bought from a retail store in Nagpur.', officer, now() - interval '19 days'),
    (case_id, 'at_lab', 'Handed to the laboratory.', officer, now() - interval '12 days'),
    (case_id, 'result_in', 'Measured ISEER 3.62 against 3.85 rated: below the rating.', officer, now() - interval '3 days');
  INSERT INTO quarterly_test_result (organisation_id, quarter, registration_id, model_number, result, measured_iseer, tested_on, laboratory_code, remarks, recorded_by)
  VALUES (org, '2026-Q4', 'BEE/RAC/2026/10103', 'NC-RAC-24H', 'fail', 3.62, current_date - 3, 'Synthetic Test Laboratory, Bengaluru', 'BEE market-sample test, case TC-2026-0004', officer)
  ON CONFLICT (organisation_id, quarter, registration_id) DO NOTHING;
  -- 5 closed (a pass)
  case_id := gen_random_uuid();
  INSERT INTO test_case (id, reference, registration_id, model_number, brand_name, organisation_id, basis, reason, risk_score, stage, procured_from, laboratory, result, measured_iseer, rated_iseer, tested_on, recommendation, selected_by, selected_at, updated_at)
  VALUES (case_id, 'TC-2026-0005', 'BEE/RAC/2023/10051', 'NC-RAC-12K', 'Nova Cool', org, 'manual', 'Chosen by the Officer: certificate ends on 12 Nov 2026, check before renewal.', 18, 'closed', 'Retail store, Mumbai (bought by BEE)', 'Synthetic Test Laboratory, Bengaluru', 'pass', 4.18, 4.20, current_date - 40, 'none', officer, now() - interval '62 days', now() - interval '30 days');
  INSERT INTO test_case_event (case_id, stage, note, by_user, at) VALUES
    (case_id, 'selected', 'Chosen by the Officer: certificate ends on 12 Nov 2026, check before renewal.', officer, now() - interval '62 days'),
    (case_id, 'procured', 'Bought from a retail store in Mumbai.', officer, now() - interval '55 days'),
    (case_id, 'at_lab', 'Handed to the laboratory.', officer, now() - interval '48 days'),
    (case_id, 'result_in', 'Measured ISEER 4.18 against 4.20 rated: within tolerance.', officer, now() - interval '40 days'),
    (case_id, 'closed', 'Passed. No further action.', officer, now() - interval '30 days');
END $$;
