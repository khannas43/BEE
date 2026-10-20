-- DEMO: sample sign-in and action history so the Sign-in activity screen is not empty: 8 people (BEE staff and manufacturers), 36 sign-ins from
-- several office and mobile addresses over the last six days, and a few recorded actions. The addresses are made-up private ranges.
-- Synthetic data only. Idempotent: skipped when the sample addresses are already present.
DO $$
DECLARE
  r record;
  n int;
  t timestamptz;
  ips text[];
  acts text[];
BEGIN
  IF EXISTS (SELECT 1 FROM access_activity WHERE ip = '10.20.4.31') THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT u.id, u.username, u.display_name,
           (SELECT role FROM role_assignment ra WHERE ra.user_id = u.id ORDER BY role LIMIT 1) AS role,
           o.id AS org_id, o.code AS org_code, regexp_replace(o.legal_name, '\s*\(synthetic[^)]*\)\s*$', '') AS org_name,
           CASE u.username WHEN 'bee.officer' THEN 1 WHEN 'bee.director' THEN 2 WHEN 'bee.admin' THEN 3 WHEN 'bee.finance' THEN 4
             WHEN 'nova.applicant' THEN 5 WHEN 'pixel.applicant' THEN 6 WHEN 'bee.auditor' THEN 7 WHEN 'bee.programme' THEN 8 END AS k
    FROM user_account u
    JOIN organisation_membership m ON m.user_id = u.id
    JOIN organisation o ON o.id = m.organisation_id
    WHERE u.username IN ('bee.officer','bee.director','bee.admin','bee.finance','nova.applicant','pixel.applicant','bee.auditor','bee.programme')
    ORDER BY 8
  LOOP
    ips := CASE WHEN r.org_code = 'BEE' THEN ARRAY['10.20.4.31','10.20.4.52','10.20.7.18'] ELSE ARRAY['192.168.1.24','117.211.84.19','49.36.152.77'] END;
    acts := CASE r.username
      WHEN 'bee.officer' THEN ARRAY['Recommend (model applications)','Create quarterly test result','Answer service request']
      WHEN 'bee.director' THEN ARRAY['Approve (model applications)','Decision (register revocations)']
      WHEN 'bee.admin' THEN ARRAY['Commit ledger record','Create business setting']
      WHEN 'bee.finance' THEN ARRAY['Fee confirmation (model applications)']
      WHEN 'nova.applicant' THEN ARRAY['Submit (model applications)','Create QR batch','Create payment']
      WHEN 'pixel.applicant' THEN ARRAY['Create QR batch','Create service request']
      ELSE ARRAY['Create report'] END;
    FOR n IN 0..4 LOOP
      EXIT WHEN r.k > 4 AND n > 3;
      EXIT WHEN r.k IN (7, 8) AND n > 2;
      t := date_trunc('minute', now()) - make_interval(days => (n * 5 + r.k * 2) % 6, hours => (r.k * 3 + n * 4) % 9, mins => (r.k * 7 + n * 13) % 50);
      INSERT INTO access_activity (at, user_id, username, display_name, role, organisation_id, organisation_code, organisation_name, ip, kind, action)
      VALUES (t, r.id, r.username, r.display_name, r.role, r.org_id, r.org_code, r.org_name, ips[1 + (n + r.k) % 3], 'login', 'Signed in');
      IF n < array_length(acts, 1) THEN
        INSERT INTO access_activity (at, user_id, username, display_name, role, organisation_id, organisation_code, organisation_name, ip, kind, action)
        VALUES (t + make_interval(mins => 6 + n * 4), r.id, r.username, r.display_name, r.role, r.org_id, r.org_code, r.org_name, ips[1 + (n + r.k) % 3], 'action', acts[1 + n]);
      END IF;
    END LOOP;
  END LOOP;
END $$;
