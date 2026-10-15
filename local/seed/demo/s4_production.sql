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
