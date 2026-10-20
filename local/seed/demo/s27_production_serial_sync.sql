-- DEMO: make the serial numbers of the Production details tab agree with the Quarterly submission tab and its reconciliation.
-- 1. Every production line of the three history years (s26) gets a second batch so that its serial numbers cover the units declared (s26 gave each
--    line only 120). 2. The earlier QR batches of Nova (s2, s4) were linked to quarters at random (s25), some with more serials than the quarter
--    declared; they are linked again to a quarter of the same model that still has room for them, and left unlinked when none has.
-- Synthetic data only. Idempotent: skipped when the top-up serials exist.
DO $$
DECLARE
  nova uuid;
  applicant uuid := '00000000-0000-4000-a000-000000000001';
  h record;
  b record;
  l record;
  sn bigint := 0;
  need bigint;
  sy int;
  cq text;
  bid uuid;
  chunk bigint;
BEGIN
  SELECT id INTO nova FROM organisation WHERE code = 'NOVA';
  IF nova IS NULL THEN
    RETURN;
  END IF;

  -- 1. top up the history lines (once)
  FOR h IN
    SELECT DISTINCT ON (l2.financial_year, l2.fy_quarter, b2.model_application_id) b2.model_application_id AS app, b2.certificate_id AS cert, l2.financial_year AS fy, l2.fy_quarter AS fq
    FROM production_line_batch l2 JOIN qr_batch b2 ON b2.id = l2.batch_id
    WHERE b2.organisation_id = nova AND EXISTS (SELECT 1 FROM qr_serial s WHERE s.batch_id = b2.id AND s.serial LIKE 'BEEQ-HB%') AND NOT EXISTS (SELECT 1 FROM qr_serial z WHERE z.serial LIKE 'BEEQ-HC%')
    ORDER BY l2.financial_year, l2.fy_quarter, b2.model_application_id
  LOOP
    sy := substr(h.fy, 1, 4)::int;
    cq := CASE WHEN h.fq = 4 THEN (sy + 1) || '-Q1' ELSE sy || '-Q' || (h.fq + 1) END;
    SELECT COALESCE(sum(r.units), 0) - 120 INTO need FROM production_submission s JOIN production_row r ON r.submission_id = s.id
      WHERE s.organisation_id = nova AND s.quarter = cq AND r.model_application_id = h.app;
    IF need > 0 THEN
      bid := gen_random_uuid();
      INSERT INTO qr_batch (id, model_application_id, certificate_id, organisation_id, quantity, status, created_by, created_at) VALUES (bid, h.app, h.cert, nova, need, 'closed', applicant, now() - interval '200 days');
      INSERT INTO qr_serial (serial, batch_id, certificate_id, state, allocated_at, bound_at)
        SELECT 'BEEQ-HC' || lpad((sn + n)::text, 8, '0'), bid, h.cert, 'bound', now() - interval '200 days', now() - interval '199 days' FROM generate_series(1, need) AS n;
      sn := sn + need;
      INSERT INTO production_line_batch (batch_id, financial_year, fy_quarter) VALUES (bid, h.fy, h.fq);
    END IF;
  END LOOP;

  -- 2. link the earlier batches again, to a quarter of their model with room
  DELETE FROM production_line_batch WHERE batch_id IN (
    SELECT b2.id FROM qr_batch b2 WHERE b2.organisation_id = nova AND NOT EXISTS (SELECT 1 FROM qr_serial s WHERE s.batch_id = b2.id AND (s.serial LIKE 'BEEQ-HB%' OR s.serial LIKE 'BEEQ-HC%' OR s.serial LIKE 'BEEQ-HD%')));
  CREATE TEMP TABLE room ON COMMIT DROP AS
    SELECT r.model_application_id AS app,
           CASE WHEN substr(s.quarter, 7)::int = 1 THEN (substr(s.quarter, 1, 4)::int - 1) ELSE substr(s.quarter, 1, 4)::int END AS start_year,
           CASE WHEN substr(s.quarter, 7)::int = 1 THEN 4 ELSE substr(s.quarter, 7)::int - 1 END AS fq,
           sum(r.units) AS units
    FROM production_submission s JOIN production_row r ON r.submission_id = s.id WHERE s.organisation_id = nova GROUP BY 1, 2, 3;
  ALTER TABLE room ADD COLUMN left_over bigint;
  UPDATE room SET left_over = units - COALESCE((SELECT count(s3.serial) FROM production_line_batch l3 JOIN qr_batch b2 ON b2.id = l3.batch_id JOIN qr_serial s3 ON s3.batch_id = b2.id
                                                 WHERE b2.model_application_id = room.app AND l3.financial_year = room.start_year || '-' || lpad(((room.start_year + 1) % 100)::text, 2, '0') AND l3.fy_quarter = room.fq), 0);
  FOR b IN SELECT b2.id, b2.model_application_id AS app, (SELECT count(*) FROM qr_serial sx WHERE sx.batch_id = b2.id) AS quantity FROM qr_batch b2 WHERE b2.organisation_id = nova
             AND NOT EXISTS (SELECT 1 FROM production_line_batch l4 WHERE l4.batch_id = b2.id)
             AND EXISTS (SELECT 1 FROM qr_serial s WHERE s.batch_id = b2.id AND s.state <> 'void')
           ORDER BY 3 DESC, b2.id LOOP
    SELECT * INTO l FROM room WHERE app = b.app AND left_over >= b.quantity ORDER BY left_over DESC, start_year DESC, fq DESC LIMIT 1;
    IF FOUND THEN
      INSERT INTO production_line_batch (batch_id, financial_year, fy_quarter) VALUES (b.id, l.start_year || '-' || lpad(((l.start_year + 1) % 100)::text, 2, '0'), l.fq::smallint);
      UPDATE room SET left_over = room.left_over - b.quantity WHERE room.app = l.app AND room.start_year = l.start_year AND room.fq = l.fq;
    END IF;
  END LOOP;
  -- 3. the three 2026 models: their accepted quarters get serials that cover the declared units (the quarter still under review, FY 2026-27 Q2, is left short on purpose)
  IF NOT EXISTS (SELECT 1 FROM qr_serial WHERE serial LIKE 'BEEQ-HD%') THEN
    sn := 0;
    FOR h IN
      SELECT a.id AS app, c.id AS cert, x.fy, x.fq, x.cq
      FROM model_application a JOIN certificate c ON c.application_id = a.id,
           (VALUES ('2025-26', 3, '2025-Q4'), ('2025-26', 4, '2026-Q1'), ('2026-27', 1, '2026-Q2')) AS x(fy, fq, cq)
      WHERE a.organisation_id = nova AND a.model_number IN ('NC-RAC-12D', 'NC-RAC-18F', 'NC-RAC-24H') ORDER BY a.model_number, x.fy, x.fq
    LOOP
      SELECT COALESCE((SELECT sum(r.units) FROM production_submission s JOIN production_row r ON r.submission_id = s.id WHERE s.organisation_id = nova AND s.quarter = h.cq AND r.model_application_id = h.app), 0)
             - COALESCE((SELECT count(*) FROM production_line_batch l5 JOIN qr_batch b5 ON b5.id = l5.batch_id JOIN qr_serial s5 ON s5.batch_id = b5.id
                         WHERE b5.model_application_id = h.app AND l5.financial_year = h.fy AND l5.fy_quarter = h.fq), 0) INTO need;
      WHILE need > 0 LOOP
        chunk := LEAST(5000, need);
        bid := gen_random_uuid();
        INSERT INTO qr_batch (id, model_application_id, certificate_id, organisation_id, quantity, status, created_by, created_at) VALUES (bid, h.app, h.cert, nova, chunk, 'closed', applicant, now() - interval '60 days');
        INSERT INTO qr_serial (serial, batch_id, certificate_id, state, allocated_at, bound_at)
          SELECT 'BEEQ-HD' || lpad((sn + n)::text, 8, '0'), bid, h.cert, 'bound', now() - interval '60 days', now() - interval '59 days' FROM generate_series(1, chunk) AS n;
        sn := sn + chunk;
        INSERT INTO production_line_batch (batch_id, financial_year, fy_quarter) VALUES (bid, h.fy, h.fq::smallint);
        need := need - chunk;
      END LOOP;
    END LOOP;
  END IF;

END $$;
