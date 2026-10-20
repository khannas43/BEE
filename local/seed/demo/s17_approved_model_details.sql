-- DEMO: complete the record of every approved model so no field reads "-" on the application page, the register or the quarterly screen:
-- laboratory, test date and declared ISEER (the figure already on its certificate), the brand link where the owner has exactly one brand of
-- that name, a submission fee snapshot where the sample had none, and the product details (type, capacity, power input, compressor,
-- refrigerant, voltage, test report number). Synthetic data only. Idempotent: only empty fields are filled, nothing is overwritten.
-- Not covered: uploaded test report files (a seed cannot hold files, BL-282) and ratings for the four approved models without one.
DO $$
DECLARE
  filer uuid := '00000000-0000-4000-a000-000000000001';
  m RECORD;
  sub uuid;
BEGIN
  -- 1. evidence fields and brand link
  UPDATE model_application a SET
      laboratory_code = COALESCE(a.laboratory_code, (SELECT code FROM organisation WHERE code = 'LAB')),
      tested_on = COALESCE(a.tested_on, (LEAST(c.valid_from, c.issued_at::date) - (7 + abs(hashtext(a.reference)) % 30))),
      declared_iseer = COALESCE(a.declared_iseer, c.declared_iseer)
    FROM certificate c WHERE c.application_id = a.id AND a.state = 'approved'
      AND (a.laboratory_code IS NULL OR a.tested_on IS NULL OR a.declared_iseer IS NULL);

  UPDATE model_application a SET brand_id = b.id
    FROM brand b
   WHERE a.state = 'approved' AND a.brand_id IS NULL AND b.owner_organisation_id = a.organisation_id AND b.name = a.brand_name
     AND (SELECT count(*) FROM brand x WHERE x.owner_organisation_id = a.organisation_id AND x.name = a.brand_name) = 1
     AND NOT EXISTS (SELECT 1 FROM model_application o WHERE o.brand_id = b.id AND upper(btrim(o.model_number)) = upper(btrim(a.model_number))
                       AND o.state NOT IN ('draft', 'rejected') AND o.id <> a.id);

  -- a test is done before the certificate's first valid day: correct any date this file set earlier that falls after it
  UPDATE model_application a SET tested_on = LEAST(c.valid_from, c.issued_at::date) - (7 + abs(hashtext(a.reference)) % 30)
    FROM certificate c WHERE c.application_id = a.id AND a.state = 'approved' AND a.tested_on >= c.valid_from;

  -- 2. a submission fee snapshot where there is none
  FOR m IN SELECT a.id, a.organisation_id, a.created_at FROM model_application a
            WHERE a.state = 'approved' AND NOT EXISTS (SELECT 1 FROM model_application_fee_snapshot f WHERE f.application_id = a.id) LOOP
    sub := md5('s17-sub-' || m.id)::uuid;
    INSERT INTO model_application_submission_event (id, application_id, from_state, to_state, actor_account_id, actor_role, filing_organisation_id, occurred_at)
      VALUES (sub, m.id, 'draft', 'fee_due', filer, 'manufacturer', m.organisation_id, m.created_at) ON CONFLICT (id) DO NOTHING;
    INSERT INTO model_application_fee_snapshot (id, application_id, submission_event_id, amount_inr, tax_rate_percent, currency, fee_rule_key, fee_rule_version, verification_status, source_reference, note, captured_at)
      VALUES (md5('s17-snap-' || m.id)::uuid, m.id, sub, 10000.00, 18.00, 'INR', 'rac-model-registration', 1, 'synthetic', 'Demo seed S17', 'Synthetic demonstration fee, not a BEE fee', m.created_at)
      ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- 3. product details
  INSERT INTO model_technical_detail (application_id, ac_type, cooling_capacity_w, power_input_w, compressor_type, refrigerant, rated_voltage, test_report_number)
  SELECT a.id,
         (ARRAY['split', 'split', 'split', 'window', 'cassette'])[1 + abs(hashtext(a.model_number)) % 5],
         cap.w,
         round(cap.w / (3.0 + (abs(hashtext(a.reference || 'e')) % 7) / 10.0))::int,
         CASE WHEN abs(hashtext(a.model_number || 'c')) % 3 = 0 THEN 'fixed' ELSE 'inverter' END,
         (ARRAY['R32', 'R32', 'R32', 'R290', 'R410A'])[1 + abs(hashtext(a.model_number || 'r')) % 5],
         230,
         'TR/LAB/' || to_char(COALESCE(a.tested_on, current_date), 'YYYY') || '/' || lpad((abs(hashtext(a.reference)) % 9000 + 1000)::text, 4, '0')
    FROM model_application a
    CROSS JOIN LATERAL (SELECT (ARRAY[3500, 5000, 5250, 7000, 8800])[1 + abs(hashtext(a.model_number || 'k')) % 5] AS w) cap
   WHERE a.state = 'approved'
     AND NOT EXISTS (SELECT 1 FROM model_technical_detail t WHERE t.application_id = a.id);

  -- the report number carries the year of the test
  UPDATE model_technical_detail t SET test_report_number = 'TR/LAB/' || to_char(a.tested_on, 'YYYY') || '/' || split_part(t.test_report_number, '/', 4)
    FROM model_application a WHERE a.id = t.application_id AND a.state = 'approved' AND a.tested_on IS NOT NULL
     AND t.test_report_number LIKE 'TR/LAB/%' AND split_part(t.test_report_number, '/', 3) <> to_char(a.tested_on, 'YYYY');
END $$;
