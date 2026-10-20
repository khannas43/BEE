-- DEMO: production details for Nova Cool Appliances. Its QR batches are linked to production lines (a model in a financial-year quarter), spread over
-- the four quarters that have production (FY 2025-26 Q3 and Q4, FY 2026-27 Q1 and Q2), and the label fee (30 rupees a unit, a placeholder rate)
-- is paid for FY 2025-26 Q3 and Q4 and FY 2026-27 Q1; FY 2026-27 Q2 is declared and unpaid. Synthetic data only.
-- Idempotent: skipped when label fee rows or line links exist.
DO $$
DECLARE
  org uuid;
  officer uuid := '00000000-0000-4000-a000-000000000001';
  r record;
  fyq text[][] := ARRAY[['2025-26','3'],['2025-26','4'],['2026-27','1'],['2026-27','2']];
  cq text[] := ARRAY['2025-Q4','2026-Q1','2026-Q2','2026-Q3'];
  i int;
  units bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM label_fee_payment) OR EXISTS (SELECT 1 FROM production_line_batch) THEN
    RETURN;
  END IF;
  SELECT id INTO org FROM organisation WHERE code = 'NOVA';
  IF org IS NULL THEN
    RETURN;
  END IF;
  FOR r IN SELECT b.id, row_number() OVER (PARTITION BY b.model_application_id ORDER BY b.created_at, b.id) - 1 AS n FROM qr_batch b WHERE b.organisation_id = org LOOP
    i := (r.n % 4) + 1;
    INSERT INTO production_line_batch (batch_id, financial_year, fy_quarter) VALUES (r.id, fyq[i][1], fyq[i][2]::smallint);
  END LOOP;
  FOR i IN 1..3 LOOP
    SELECT COALESCE(sum(pr.units), 0) INTO units FROM production_submission s JOIN production_row pr ON pr.submission_id = s.id WHERE s.organisation_id = org AND s.quarter = cq[i];
    IF units > 0 THEN
      INSERT INTO label_fee_payment (order_id, organisation_id, financial_year, fy_quarter, units, amount_inr, status, method, gateway_ref, receipt_number, started_by, created_at, settled_at)
      VALUES (CASE WHEN i < 3 THEN 'LFO-NOVA0001' ELSE 'LFO-NOVA0002' END, org, fyq[i][1], fyq[i][2]::smallint, units, units * 30, 'paid',
              CASE WHEN i < 3 THEN 'razorpay' ELSE 'billdesk' END, CASE WHEN i < 3 THEN 'SIMRA-5C2E7A10' ELSE 'SIMBI-91D4B6F2' END,
              CASE WHEN i < 3 THEN 'LF-20260105-NOVA0001' ELSE 'LF-20260712-NOVA0002' END, officer,
              CASE WHEN i < 3 THEN now() - interval '290 days' ELSE now() - interval '100 days' END, CASE WHEN i < 3 THEN now() - interval '290 days' ELSE now() - interval '100 days' END);
    END IF;
  END LOOP;
END $$;
