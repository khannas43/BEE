-- Demo slice S1 (payment simulation): synthetic fee-due applications for NOVA and PIXEL with sample payments. Idempotent. Local demonstration only.
-- Needs local/seed/seed.sql first (organisations, people). Fee: 10000.00 INR + 18% tax = 11800.00 INR (provisional, synthetic).
BEGIN;
INSERT INTO model_application (id, reference, organisation_id, brand_name, category, model_number, state, version) VALUES
  ('00000000-0000-4000-c000-000000000a01', 'DEMO-PAY-0001', '00000000-0000-4000-b000-000000000001', 'Nova Cool', 'RAC', 'NC-RAC-DEMO-A', 'fee_due', 0),
  ('00000000-0000-4000-c000-000000000a02', 'DEMO-PAY-0002', '00000000-0000-4000-b000-000000000001', 'Nova Cool', 'RAC', 'NC-RAC-DEMO-B', 'fee_due', 0),
  ('00000000-0000-4000-c000-000000000a03', 'DEMO-PAY-0003', '00000000-0000-4000-b000-000000000001', 'Nova Cool', 'RAC', 'NC-RAC-DEMO-C', 'fee_due', 0),
  ('00000000-0000-4000-c000-000000000a04', 'DEMO-PAY-0004', '00000000-0000-4000-b000-000000000002', 'Aurora Air (synthetic principal)', 'RAC', 'AU-RAC-DEMO-D', 'fee_due', 0),
  ('00000000-0000-4000-c000-000000000a05', 'DEMO-PAY-0005', '00000000-0000-4000-b000-000000000002', 'Aurora Air (synthetic principal)', 'RAC', 'AU-RAC-DEMO-E', 'fee_due', 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO model_application_submission_event (id, application_id, from_state, to_state, actor_account_id, actor_role, filing_organisation_id)
SELECT ('00000000-0000-4000-d000-000000000a0' || n)::uuid, ('00000000-0000-4000-c000-000000000a0' || n)::uuid, 'draft', 'fee_due',
       CASE WHEN n <= 3 THEN '00000000-0000-4000-a000-000000000001'::uuid ELSE '00000000-0000-4000-a000-000000000002'::uuid END,
       CASE WHEN n <= 3 THEN 'manufacturer' ELSE 'agency' END,
       CASE WHEN n <= 3 THEN '00000000-0000-4000-b000-000000000001'::uuid ELSE '00000000-0000-4000-b000-000000000002'::uuid END
FROM generate_series(1, 5) AS n
ON CONFLICT DO NOTHING;

INSERT INTO model_application_fee_snapshot (id, application_id, submission_event_id, amount_inr, tax_rate_percent, currency, fee_rule_key, fee_rule_version, verification_status, source_reference, note)
SELECT ('00000000-0000-4000-e000-000000000a0' || n)::uuid, ('00000000-0000-4000-c000-000000000a0' || n)::uuid, ('00000000-0000-4000-d000-000000000a0' || n)::uuid,
       10000.00, 18.00, 'INR', 'rac-model-registration', 1, 'synthetic', 'Demo seed S1', 'Synthetic demonstration fee, not a BEE fee'
FROM generate_series(1, 5) AS n
ON CONFLICT DO NOTHING;

-- Sample payments: 0002 paid (Finance can confirm it), 0003 initiated (gateway panel open), 0004 paid, 0005 failed. 0001 has none (pay it live).
INSERT INTO payment (id, application_id, organisation_id, amount_inr, status, gateway_ref, started_by_account_id, receipt_number, created_at, settled_at) VALUES
  ('00000000-0000-4000-f000-000000000a02', '00000000-0000-4000-c000-000000000a02', '00000000-0000-4000-b000-000000000001', 11800.00, 'paid', 'SIMGW-5EED0002',
   '00000000-0000-4000-a000-000000000001', 'SIMRCPT-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD') || '-0001', now() - interval '2 hours', now() - interval '2 hours'),
  ('00000000-0000-4000-f000-000000000a03', '00000000-0000-4000-c000-000000000a03', '00000000-0000-4000-b000-000000000001', 11800.00, 'initiated', 'SIMGW-5EED0003',
   '00000000-0000-4000-a000-000000000001', NULL, now() - interval '1 hour', NULL),
  ('00000000-0000-4000-f000-000000000a04', '00000000-0000-4000-c000-000000000a04', '00000000-0000-4000-b000-000000000002', 11800.00, 'paid', 'SIMGW-5EED0004',
   '00000000-0000-4000-a000-000000000002', 'SIMRCPT-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD') || '-0002', now() - interval '90 minutes', now() - interval '90 minutes'),
  ('00000000-0000-4000-f000-000000000a05', '00000000-0000-4000-c000-000000000a05', '00000000-0000-4000-b000-000000000002', 11800.00, 'failed', 'SIMGW-5EED0005',
   '00000000-0000-4000-a000-000000000002', NULL, now() - interval '30 minutes', now() - interval '30 minutes')
ON CONFLICT (id) DO NOTHING;

INSERT INTO payment_callback (id, payment_id, gateway_ref, outcome, payload_sha256)
SELECT ('00000000-0000-4000-9000-000000000a0' || n)::uuid, ('00000000-0000-4000-f000-000000000a0' || n)::uuid, g, o, encode(sha256(convert_to('seed-' || g || o, 'UTF8')), 'hex')
FROM (VALUES (2, 'SIMGW-5EED0002', 'paid'), (4, 'SIMGW-5EED0004', 'paid'), (5, 'SIMGW-5EED0005', 'failed')) AS v (n, g, o)
ON CONFLICT DO NOTHING;

INSERT INTO payment_event (id, payment_id, event, actor_account_id, actor_role, detail)
SELECT ('00000000-0000-4000-8000-0000000' || lpad((n * 10 + k)::text, 5, '0'))::uuid, ('00000000-0000-4000-f000-000000000a0' || n)::uuid, e,
       CASE WHEN n <= 3 THEN '00000000-0000-4000-a000-000000000001'::uuid ELSE '00000000-0000-4000-a000-000000000002'::uuid END,
       CASE WHEN n <= 3 THEN 'manufacturer' ELSE 'agency' END, 'Demo seed S1'
FROM (VALUES (2, 1, 'started'), (2, 2, 'paid'), (3, 1, 'started'), (4, 1, 'started'), (4, 2, 'paid'), (5, 1, 'started'), (5, 2, 'failed')) AS v (n, k, e)
ON CONFLICT DO NOTHING;

INSERT INTO payment_receipt_counter (receipt_day, last_value) VALUES ((now() AT TIME ZONE 'Asia/Kolkata')::date, 2)
ON CONFLICT (receipt_day) DO UPDATE SET last_value = GREATEST(payment_receipt_counter.last_value, 2);
COMMIT;
