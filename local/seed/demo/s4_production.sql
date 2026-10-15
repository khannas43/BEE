-- Demo slice S4 seed: approved NOVA/PIXEL models with certificates (synthetic, local demonstration) and four quarters of production
-- submissions for NOVA. Idempotent. Run as the schema owner after V60. The latest submitted quarter (2026-Q3) carries a units spike on
-- NC-RAC-12D so the AI anomaly use case has something to find. 2026-Q4 is left for the live demo (create it as nova.applicant).
BEGIN;

-- Approved models with certificates (skipped silently where another seed already created the same registration IDs).
INSERT INTO model_application (id, reference, organisation_id, brand_name, category, model_number, state, version) VALUES
  ('00000000-0000-4000-c000-000000000101', 'DEMO-MA-0101', '00000000-0000-4000-b000-000000000001', 'Nova Cool', 'RAC', 'NC-RAC-12D', 'approved', 1),
  ('00000000-0000-4000-c000-000000000102', 'DEMO-MA-0102', '00000000-0000-4000-b000-000000000001', 'Nova Cool', 'RAC', 'NC-RAC-18F', 'approved', 1),
  ('00000000-0000-4000-c000-000000000103', 'DEMO-MA-0103', '00000000-0000-4000-b000-000000000001', 'Nova Cool', 'RAC', 'NC-RAC-24H', 'approved', 1),
  ('00000000-0000-4000-c000-000000000104', 'DEMO-MA-0104', '00000000-0000-4000-b000-000000000002', 'Aurora Air (synthetic principal)', 'RAC', 'AU-RAC-15X', 'approved', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after) VALUES
  ('00000000-0000-4000-c100-000000000101', '00000000-0000-4000-c000-000000000101', 'approve', 'secretary_approval', 'approved', '00000000-0000-4000-a000-000000000008', 'secretary', 1),
  ('00000000-0000-4000-c100-000000000102', '00000000-0000-4000-c000-000000000102', 'approve', 'secretary_approval', 'approved', '00000000-0000-4000-a000-000000000008', 'secretary', 1),
  ('00000000-0000-4000-c100-000000000103', '00000000-0000-4000-c000-000000000103', 'approve', 'secretary_approval', 'approved', '00000000-0000-4000-a000-000000000008', 'secretary', 1),
  ('00000000-0000-4000-c100-000000000104', '00000000-0000-4000-c000-000000000104', 'approve', 'secretary_approval', 'approved', '00000000-0000-4000-a000-000000000008', 'secretary', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO certificate (id, application_id, transition_event_id, registration_id, category_code, issue_year, sequence_no, valid_from, valid_to,
                         organisation_name, brand_name, model_number, stars, declared_iseer, verified_iseer, scheme_key, issued_by_account_id) VALUES
  ('00000000-0000-4000-c200-000000000101', '00000000-0000-4000-c000-000000000101', '00000000-0000-4000-c100-000000000101', 'BEE/RAC/2026/10101', 'RAC', 2026, 10101, '2026-01-15', '2029-01-14', 'Nova Cool Appliances Pvt Ltd (synthetic)', 'Nova Cool', 'NC-RAC-12D', 5, 5.10, 5.05, 'rac_demo', '00000000-0000-4000-a000-000000000008'),
  ('00000000-0000-4000-c200-000000000102', '00000000-0000-4000-c000-000000000102', '00000000-0000-4000-c100-000000000102', 'BEE/RAC/2026/10102', 'RAC', 2026, 10102, '2026-01-15', '2029-01-14', 'Nova Cool Appliances Pvt Ltd (synthetic)', 'Nova Cool', 'NC-RAC-18F', 4, 4.60, 4.55, 'rac_demo', '00000000-0000-4000-a000-000000000008'),
  ('00000000-0000-4000-c200-000000000103', '00000000-0000-4000-c000-000000000103', '00000000-0000-4000-c100-000000000103', 'BEE/RAC/2026/10103', 'RAC', 2026, 10103, '2026-01-15', '2029-01-14', 'Nova Cool Appliances Pvt Ltd (synthetic)', 'Nova Cool', 'NC-RAC-24H', 3, 3.90, 3.85, 'rac_demo', '00000000-0000-4000-a000-000000000008'),
  ('00000000-0000-4000-c200-000000000104', '00000000-0000-4000-c000-000000000104', '00000000-0000-4000-c100-000000000104', 'BEE/RAC/2026/10104', 'RAC', 2026, 10104, '2026-01-15', '2029-01-14', 'PixelCert Agency (synthetic)', 'Aurora Air (synthetic principal)', 'AU-RAC-15X', 4, 4.50, 4.45, 'rac_demo', '00000000-0000-4000-a000-000000000008')
ON CONFLICT DO NOTHING;

-- Four quarters for NOVA: three accepted, the latest (2026-Q3) submitted with a spike, awaiting the Programme officer.
DO $$
DECLARE
  nova      constant uuid := '00000000-0000-4000-b000-000000000001';
  applicant constant uuid := '00000000-0000-4000-a000-000000000001';
  programme constant uuid := '00000000-0000-4000-a000-000000000006';
  q         record;
  m         record;
  sid       uuid;
  mo        integer;
  base_u    integer;
  u         integer;
  p_start   date;
  content   bytea;
BEGIN
  FOR q IN SELECT * FROM (VALUES ('2025-Q4', date '2025-10-01', 1, 'accepted'), ('2026-Q1', date '2026-01-01', 2, 'accepted'),
                                 ('2026-Q2', date '2026-04-01', 3, 'accepted'), ('2026-Q3', date '2026-07-01', 4, 'submitted')) AS t (quarter, first_day, n, final_state)
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM production_submission WHERE organisation_id = nova AND quarter = q.quarter);
    INSERT INTO production_submission (organisation_id, quarter, created_by) VALUES (nova, q.quarter, applicant) RETURNING id INTO sid;
    INSERT INTO production_event (submission_id, action, from_state, to_state, actor_account_id, actor_role) VALUES (sid, 'created', NULL, 'draft', applicant, 'manufacturer');
    FOR m IN SELECT a.id, c.registration_id, c.sequence_no FROM model_application a JOIN certificate c ON c.application_id = a.id
              WHERE a.organisation_id = nova AND a.state = 'approved' AND c.registration_id IN ('BEE/RAC/2026/10101', 'BEE/RAC/2026/10102', 'BEE/RAC/2026/10103') LOOP
      base_u := CASE m.sequence_no WHEN 10101 THEN 4000 WHEN 10102 THEN 2500 ELSE 1200 END;
      FOR mo IN 0..2 LOOP
        p_start := (q.first_day + (mo || ' months')::interval)::date;
        u := base_u + q.n * 60 + mo * 40;
        -- the spike: NC-RAC-12D in the last month of 2026-Q3 is about five times its usual level
        IF q.quarter = '2026-Q3' AND m.sequence_no = 10101 AND mo = 2 THEN u := 21500; END IF;
        INSERT INTO production_row (submission_id, model_application_id, units, period_start, period_end, registration_id)
          VALUES (sid, m.id, u, p_start, (p_start + interval '1 month' - interval '1 day')::date, m.registration_id);
      END LOOP;
    END LOOP;
    content := convert_to('Synthetic CA certificate for ' || q.quarter || ' (local demonstration, not a real document)', 'UTF8');
    INSERT INTO production_evidence (submission_id, file_name, media_type, size_bytes, sha256, content, ca_name, ca_membership_no, statement, uploaded_by)
      VALUES (sid, 'ca-certificate-' || q.quarter || '.txt', 'text/plain', length(content), encode(sha256(content), 'hex'), content,
              'Synthetic CA and Co (synthetic)', 'SYN-000123', 'Production figures agree with the books for the quarter (synthetic statement).', applicant);
    UPDATE production_submission SET state = 'submitted', version = 1, submitted_by = applicant, submitted_at = now() WHERE id = sid;
    INSERT INTO production_event (submission_id, action, from_state, to_state, actor_account_id, actor_role) VALUES (sid, 'submitted', 'draft', 'submitted', applicant, 'manufacturer');
    IF q.final_state = 'accepted' THEN
      UPDATE production_submission SET state = 'accepted', version = 2, reviewed_by = programme, reviewed_at = now(), review_note = 'Figures in line with earlier quarters (synthetic).' WHERE id = sid;
      INSERT INTO production_event (submission_id, action, from_state, to_state, actor_account_id, actor_role, note)
        VALUES (sid, 'review_accepted', 'submitted', 'accepted', programme, 'programme', 'Figures in line with earlier quarters (synthetic).');
    END IF;
  END LOOP;
END $$;
COMMIT;

-- Four more organisations, four quarters each (2025-Q4 to 2026-Q3). Nova's quarters, including the 2026-Q3 spike, are left as they are.
-- 2026-Q4 stays free for Nova's live demo. Three models over-declare in one quarter; the other quarters stay within the bound QR serials seeded in s2.
BEGIN;
INSERT INTO organisation (id, code, kind, legal_name) VALUES
  ('00000000-0000-4000-b000-000000000504', 'SYNTH-MFG-4', 'manufacturer', 'Harbor Breeze Cooling Pvt Ltd (synthetic)'),
  ('00000000-0000-4000-b000-000000000505', 'SYNTH-MFG-5', 'manufacturer', 'Lumen Frost Appliances Pvt Ltd (synthetic)'),
  ('00000000-0000-4000-b000-000000000506', 'SYNTH-MFG-6', 'manufacturer', 'Cinder Peak Cooling Pvt Ltd (synthetic)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO brand (id, name, owner_organisation_id, status, source_reference, verification_status, note) VALUES
  ('00000000-0000-4000-c000-0000000010b1', 'Harbor Breeze (synthetic)', '00000000-0000-4000-b000-000000000504', 'active', 'S4 production seed (synthetic)', 'synthetic', 'Synthetic production brand'),
  ('00000000-0000-4000-c000-0000000010b2', 'Lumen Frost (synthetic)', '00000000-0000-4000-b000-000000000505', 'active', 'S4 production seed (synthetic)', 'synthetic', 'Synthetic production brand'),
  ('00000000-0000-4000-c000-0000000010b3', 'Cinder Peak (synthetic)', '00000000-0000-4000-b000-000000000506', 'active', 'S4 production seed (synthetic)', 'synthetic', 'Synthetic production brand')
ON CONFLICT (id) DO NOTHING;

INSERT INTO model_application (id, reference, organisation_id, brand_name, category, model_number, state, version) VALUES
  ('00000000-0000-4000-c000-000000001101', 'DEMO-MA-1101', '00000000-0000-4000-b000-000000000504', 'Harbor Breeze (synthetic)', 'RAC', 'HB-RAC-15A', 'approved', 1),
  ('00000000-0000-4000-c000-000000001102', 'DEMO-MA-1102', '00000000-0000-4000-b000-000000000504', 'Harbor Breeze (synthetic)', 'RAC', 'HB-RAC-18B', 'approved', 1),
  ('00000000-0000-4000-c000-000000001111', 'DEMO-MA-1111', '00000000-0000-4000-b000-000000000505', 'Lumen Frost (synthetic)', 'RAC', 'LF-RAC-12A', 'approved', 1),
  ('00000000-0000-4000-c000-000000001112', 'DEMO-MA-1112', '00000000-0000-4000-b000-000000000505', 'Lumen Frost (synthetic)', 'RAC', 'LF-RAC-20C', 'approved', 1),
  ('00000000-0000-4000-c000-000000001121', 'DEMO-MA-1121', '00000000-0000-4000-b000-000000000506', 'Cinder Peak (synthetic)', 'RAC', 'CP-RAC-18A', 'approved', 1),
  ('00000000-0000-4000-c000-000000001122', 'DEMO-MA-1122', '00000000-0000-4000-b000-000000000506', 'Cinder Peak (synthetic)', 'RAC', 'CP-RAC-24B', 'approved', 1),
  ('00000000-0000-4000-c000-000000001131', 'DEMO-MA-1131', '00000000-0000-4000-b000-000000000002', 'Aurora Air (synthetic principal)', 'RAC', 'PX-RAC-10A', 'approved', 1),
  ('00000000-0000-4000-c000-000000001132', 'DEMO-MA-1132', '00000000-0000-4000-b000-000000000002', 'Aurora Air (synthetic principal)', 'RAC', 'PX-RAC-12B', 'approved', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
SELECT ('00000000-0000-4000-c100-00000000' || suffix)::uuid, ('00000000-0000-4000-c000-00000000' || suffix)::uuid,
       'rate', 'rating', 'director_review', '00000000-0000-4000-a000-000000000005', 'reviewer', 1, now() - interval '90 days'
FROM (VALUES ('1101'), ('1102'), ('1111'), ('1112'), ('1121'), ('1122'), ('1131'), ('1132')) AS v (suffix)
ON CONFLICT (id) DO NOTHING;
INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at)
SELECT ('00000000-0000-4000-c110-00000000' || suffix)::uuid, ('00000000-0000-4000-c000-00000000' || suffix)::uuid,
       'approve', 'secretary_approval', 'approved', '00000000-0000-4000-a000-000000000008', 'secretary', 2, now() - interval '80 days'
FROM (VALUES ('1101'), ('1102'), ('1111'), ('1112'), ('1121'), ('1122'), ('1131'), ('1132')) AS v (suffix)
ON CONFLICT (id) DO NOTHING;
INSERT INTO model_application_rating (id, application_id, transition_event_id, rating_version, basis, scheme_key, declared_iseer, verified_iseer, stars, computed_by_account_id)
SELECT ('00000000-0000-4000-c120-00000000' || suffix)::uuid, ('00000000-0000-4000-c000-00000000' || suffix)::uuid,
       ('00000000-0000-4000-c100-00000000' || suffix)::uuid, 1, 'local_demo', 'rac_demo', iseer, iseer, stars, '00000000-0000-4000-a000-000000000005'
FROM (VALUES ('1101', 4.20, 3), ('1102', 4.55, 4), ('1111', 3.80, 2), ('1112', 5.05, 5),
             ('1121', 4.40, 3), ('1122', 3.60, 2), ('1131', 4.10, 3), ('1132', 4.70, 4)) AS v (suffix, iseer, stars)
ON CONFLICT (id) DO NOTHING;

INSERT INTO certificate (id, application_id, transition_event_id, registration_id, category_code, issue_year, sequence_no, valid_from, valid_to,
                         organisation_name, brand_name, model_number, stars, declared_iseer, verified_iseer, scheme_key, issued_by_account_id, issued_at)
SELECT ('00000000-0000-4000-c200-00000000' || suffix)::uuid, ('00000000-0000-4000-c000-00000000' || suffix)::uuid,
       ('00000000-0000-4000-c110-00000000' || suffix)::uuid,
       'BEE/RAC/' || extract(year FROM (now() - interval '80 days') AT TIME ZONE 'Asia/Kolkata')::int || '/' || seq,
       'RAC', extract(year FROM (now() - interval '80 days') AT TIME ZONE 'Asia/Kolkata')::int, seq,
       ((now() - interval '80 days') AT TIME ZONE 'Asia/Kolkata')::date,
       (((now() - interval '80 days') AT TIME ZONE 'Asia/Kolkata')::date + interval '3 years' - interval '1 day')::date,
       org_name, brand_name, model_number, stars::smallint, iseer::numeric, iseer::numeric, 'rac_demo', '00000000-0000-4000-a000-000000000008', now() - interval '80 days'
FROM (VALUES
  ('1101', 10301, 'Harbor Breeze Cooling Pvt Ltd (synthetic)', 'Harbor Breeze (synthetic)', 'HB-RAC-15A', 4.20::numeric, 3::smallint),
  ('1102', 10302, 'Harbor Breeze Cooling Pvt Ltd (synthetic)', 'Harbor Breeze (synthetic)', 'HB-RAC-18B', 4.55::numeric, 4::smallint),
  ('1111', 10303, 'Lumen Frost Appliances Pvt Ltd (synthetic)', 'Lumen Frost (synthetic)', 'LF-RAC-12A', 3.80::numeric, 2::smallint),
  ('1112', 10304, 'Lumen Frost Appliances Pvt Ltd (synthetic)', 'Lumen Frost (synthetic)', 'LF-RAC-20C', 5.05::numeric, 5::smallint),
  ('1121', 10305, 'Cinder Peak Cooling Pvt Ltd (synthetic)', 'Cinder Peak (synthetic)', 'CP-RAC-18A', 4.40::numeric, 3::smallint),
  ('1122', 10306, 'Cinder Peak Cooling Pvt Ltd (synthetic)', 'Cinder Peak (synthetic)', 'CP-RAC-24B', 3.60::numeric, 2::smallint),
  ('1131', 10311, 'PixelCert Agency (synthetic)', 'Aurora Air (synthetic principal)', 'PX-RAC-10A', 4.10::numeric, 3::smallint),
  ('1132', 10312, 'PixelCert Agency (synthetic)', 'Aurora Air (synthetic principal)', 'PX-RAC-12B', 4.70::numeric, 4::smallint)
) AS v (suffix, seq, org_name, brand_name, model_number, iseer, stars)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  programme constant uuid := '00000000-0000-4000-a000-000000000006';
  q record;
  m record;
  sid uuid;
  mo integer;
  u integer;
  p_start date;
  content bytea;
  actor uuid;
  actor_role text;
  final_state text;
  spike boolean;
BEGIN
  FOR q IN
    SELECT * FROM (VALUES
      ('00000000-0000-4000-b000-000000000504'::uuid, '2025-Q4', date '2025-10-01', 'accepted'),
      ('00000000-0000-4000-b000-000000000504', '2026-Q1', date '2026-01-01', 'accepted'),
      ('00000000-0000-4000-b000-000000000504', '2026-Q2', date '2026-04-01', 'accepted'),
      ('00000000-0000-4000-b000-000000000504', '2026-Q3', date '2026-07-01', 'accepted'),
      ('00000000-0000-4000-b000-000000000505', '2025-Q4', date '2025-10-01', 'accepted'),
      ('00000000-0000-4000-b000-000000000505', '2026-Q1', date '2026-01-01', 'accepted'),
      ('00000000-0000-4000-b000-000000000505', '2026-Q2', date '2026-04-01', 'accepted'),
      ('00000000-0000-4000-b000-000000000505', '2026-Q3', date '2026-07-01', 'submitted'),
      ('00000000-0000-4000-b000-000000000506', '2025-Q4', date '2025-10-01', 'accepted'),
      ('00000000-0000-4000-b000-000000000506', '2026-Q1', date '2026-01-01', 'accepted'),
      ('00000000-0000-4000-b000-000000000506', '2026-Q2', date '2026-04-01', 'query'),
      ('00000000-0000-4000-b000-000000000506', '2026-Q3', date '2026-07-01', 'accepted'),
      ('00000000-0000-4000-b000-000000000002', '2025-Q4', date '2025-10-01', 'accepted'),
      ('00000000-0000-4000-b000-000000000002', '2026-Q1', date '2026-01-01', 'accepted'),
      ('00000000-0000-4000-b000-000000000002', '2026-Q2', date '2026-04-01', 'accepted'),
      ('00000000-0000-4000-b000-000000000002', '2026-Q3', date '2026-07-01', 'accepted')
    ) AS t (org, quarter, first_day, final_state)
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM production_submission WHERE organisation_id = q.org AND quarter = q.quarter);
    actor := CASE WHEN q.org = '00000000-0000-4000-b000-000000000002'::uuid THEN '00000000-0000-4000-a000-000000000002'::uuid
                  ELSE '00000000-0000-4000-a000-000000000001'::uuid END;
    actor_role := CASE WHEN q.org = '00000000-0000-4000-b000-000000000002'::uuid THEN 'agency' ELSE 'manufacturer' END;
    INSERT INTO production_submission (organisation_id, quarter, created_by) VALUES (q.org, q.quarter, actor) RETURNING id INTO sid;
    INSERT INTO production_event (submission_id, action, from_state, to_state, actor_account_id, actor_role)
      VALUES (sid, 'created', NULL, 'draft', actor, actor_role);
    FOR m IN
      SELECT a.id, c.registration_id, a.model_number
        FROM model_application a JOIN certificate c ON c.application_id = a.id
       WHERE a.organisation_id = q.org AND a.reference LIKE 'DEMO-MA-11%'
    LOOP
      spike := (m.model_number = 'HB-RAC-18B' AND q.quarter = '2026-Q1')
            OR (m.model_number = 'LF-RAC-12A' AND q.quarter = '2026-Q2')
            OR (m.model_number = 'PX-RAC-10A' AND q.quarter = '2025-Q4');
      FOR mo IN 0..2 LOOP
        p_start := (q.first_day + (mo || ' months')::interval)::date;
        u := CASE WHEN spike AND mo = 2 THEN 6400 ELSE 320 + mo * 20 END;
        INSERT INTO production_row (submission_id, model_application_id, units, period_start, period_end, registration_id)
          VALUES (sid, m.id, u, p_start, (p_start + interval '1 month' - interval '1 day')::date, m.registration_id);
      END LOOP;
    END LOOP;
    content := convert_to('Synthetic CA certificate for ' || q.quarter || ' (local demonstration, not a real document)', 'UTF8');
    INSERT INTO production_evidence (submission_id, file_name, media_type, size_bytes, sha256, content, ca_name, ca_membership_no, statement, uploaded_by)
      VALUES (sid, 'ca-certificate-' || q.quarter || '.txt', 'text/plain', length(content), encode(sha256(content), 'hex'), content,
              'Synthetic CA and Co (synthetic)', 'SYN-000456', 'Production figures agree with the books for the quarter (synthetic statement).', actor);
    UPDATE production_submission SET state = 'submitted', version = 1, submitted_by = actor, submitted_at = q.first_day + interval '100 days' WHERE id = sid;
    INSERT INTO production_event (submission_id, action, from_state, to_state, actor_account_id, actor_role)
      VALUES (sid, 'submitted', 'draft', 'submitted', actor, actor_role);
    final_state := q.final_state;
    IF final_state = 'accepted' THEN
      UPDATE production_submission SET state = 'accepted', version = 2, reviewed_by = programme, reviewed_at = q.first_day + interval '110 days',
             review_note = 'Figures in line with the bound serials (synthetic).' WHERE id = sid;
      INSERT INTO production_event (submission_id, action, from_state, to_state, actor_account_id, actor_role, note)
        VALUES (sid, 'review_accepted', 'submitted', 'accepted', programme, 'programme', 'Figures in line with the bound serials (synthetic).');
    ELSIF final_state = 'query' THEN
      UPDATE production_submission SET state = 'query', version = 2, reviewed_by = programme, reviewed_at = q.first_day + interval '110 days',
             review_note = 'Please confirm the September model split (synthetic query).' WHERE id = sid;
      INSERT INTO production_event (submission_id, action, from_state, to_state, actor_account_id, actor_role, note)
        VALUES (sid, 'review_query', 'submitted', 'query', programme, 'programme', 'Please confirm the September model split (synthetic query).');
    END IF;
  END LOOP;
END $$;
COMMIT;
