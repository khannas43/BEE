-- DEMO: three financial years of production for Nova Cool Appliances, all four quarters each (FY 2023-24, 2024-25 and 2025-26), for the Production
-- details tab. Ten calendar quarters are added (2023-Q2 to 2025-Q3; the four of FY 2025-26 and 2026-27 that were already there stay): accepted
-- submissions with rows for the two 2023 models (NC-RAC-09K and NC-RAC-12K), a synthetic CA certificate, the review trail, the label fee paid
-- (30 rupees a unit, a placeholder rate) and 120 bound serial numbers on every production line. Synthetic data only.
-- Note: the 2023 certificates start on 5 October and 13 November 2023, so the first two quarters of FY 2023-24 are declared before them; this is
-- demonstration data. Idempotent: skipped when the quarter 2024-Q1 already has a submission for Nova.
DO $$
DECLARE
  nova uuid;
  applicant uuid := '00000000-0000-4000-a000-000000000001';
  programme uuid := '00000000-0000-4000-a000-000000000006';
  q text;
  qs text[] := ARRAY['2023-Q2','2023-Q3','2023-Q4','2024-Q1','2024-Q2','2024-Q3','2024-Q4','2025-Q1','2025-Q2','2025-Q3'];
  idx int := 0;
  yr int; qn int; first_day date; last_day date; fy_start int; fq int; fy text;
  m record;
  sid uuid; units bigint; content bytea; bid uuid; sn bigint := 0; seasonal numeric;
  total bigint;
BEGIN
  SELECT id INTO nova FROM organisation WHERE code = 'NOVA';
  IF nova IS NULL OR EXISTS (SELECT 1 FROM production_submission WHERE organisation_id = nova AND quarter = '2024-Q1') THEN
    RETURN;
  END IF;
  FOREACH q IN ARRAY qs LOOP
    idx := idx + 1;
    yr := substr(q, 1, 4)::int; qn := substr(q, 7)::int;
    first_day := make_date(yr, (qn - 1) * 3 + 1, 1); last_day := (first_day + interval '3 months' - interval '1 day')::date;
    fy_start := CASE WHEN qn = 1 THEN yr - 1 ELSE yr END; fq := CASE WHEN qn = 1 THEN 4 ELSE qn - 1 END;
    fy := fy_start || '-' || lpad(((fy_start + 1) % 100)::text, 2, '0');
    seasonal := (ARRAY[1.18, 1.00, 0.84, 0.92])[fq];
    INSERT INTO production_submission (organisation_id, quarter, created_by) VALUES (nova, q, applicant) RETURNING id INTO sid;
    total := 0;
    FOR m IN SELECT a.id AS app, c.id AS cert, c.registration_id, a.model_number, CASE a.model_number WHEN 'NC-RAC-09K' THEN 3000 ELSE 2200 END AS base
             FROM model_application a JOIN certificate c ON c.application_id = a.id WHERE a.organisation_id = nova AND a.model_number IN ('NC-RAC-09K', 'NC-RAC-12K') ORDER BY a.model_number LOOP
      units := round(m.base * (1 + 0.04 * idx) * seasonal / 10) * 10;
      total := total + units;
      INSERT INTO production_row (submission_id, model_application_id, units, period_start, period_end, registration_id) VALUES (sid, m.app, units, first_day, last_day, m.registration_id);
      -- the serial numbers of this production line: one closed batch of 120, all bound to a label
      bid := gen_random_uuid();
      INSERT INTO qr_batch (id, model_application_id, certificate_id, organisation_id, quantity, status, created_by, created_at) VALUES (bid, m.app, m.cert, nova, 120, 'closed', applicant, last_day + 5);
      INSERT INTO qr_serial (serial, batch_id, certificate_id, state, allocated_at, bound_at)
        SELECT 'BEEQ-HB' || lpad((sn + n)::text, 8, '0'), bid, m.cert, 'bound', last_day + 5, last_day + 6 FROM generate_series(1, 120) AS n;
      sn := sn + 120;
      INSERT INTO production_line_batch (batch_id, financial_year, fy_quarter) VALUES (bid, fy, fq);
    END LOOP;
    content := convert_to('Synthetic CA certificate for ' || q || ' (local demonstration, not a real document)', 'UTF8');
    INSERT INTO production_evidence (submission_id, file_name, media_type, size_bytes, sha256, content, ca_name, ca_membership_no, statement, uploaded_by)
      VALUES (sid, 'ca-certificate-' || q || '.txt', 'text/plain', length(content), encode(sha256(content), 'hex'), content,
              'Synthetic CA and Co (synthetic)', 'SYN-000123', 'Production figures agree with the books for the quarter (synthetic statement).', applicant);
    UPDATE production_submission SET state = 'submitted', version = 1, submitted_by = applicant, submitted_at = last_day + interval '9 days 5 hours' WHERE id = sid;
    INSERT INTO production_event (submission_id, action, from_state, to_state, actor_account_id, actor_role, occurred_at) VALUES (sid, 'submitted', 'draft', 'submitted', applicant, 'manufacturer', last_day + interval '9 days 5 hours');
    UPDATE production_submission SET state = 'accepted', version = 2, reviewed_by = programme, reviewed_at = last_day + interval '16 days 6 hours', review_note = 'Figures in line with earlier quarters (synthetic).' WHERE id = sid;
    INSERT INTO production_event (submission_id, action, from_state, to_state, actor_account_id, actor_role, note, occurred_at) VALUES (sid, 'accepted', 'submitted', 'accepted', programme, 'programme', 'Figures in line with earlier quarters (synthetic).', last_day + interval '16 days 6 hours');
    -- the label fee for the quarter, paid
    INSERT INTO label_fee_payment (order_id, organisation_id, financial_year, fy_quarter, units, amount_inr, status, method, gateway_ref, receipt_number, started_by, created_at, settled_at)
      VALUES ('LFO-NOVAH' || fy_start || fq, nova, fy, fq::smallint, total, total * 30, 'paid', CASE WHEN idx % 2 = 0 THEN 'billdesk' ELSE 'razorpay' END,
              'SIMH-' || lpad(idx::text, 4, '0') || 'A7C2', 'LF-' || to_char(last_day + 20, 'YYYYMMDD') || '-H' || fy_start || fq, applicant, last_day + interval '12 days', last_day + interval '12 days');
  END LOOP;
END $$;
