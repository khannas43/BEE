-- Demo slice S2 seed: QR batches and serials. Synthetic local data only, idempotent (safe to run again; existing rows are left alone).
-- Needs the base seed (organisation NOVA, accounts) first. Because the base seed has no approved model with a certificate, this file adds two
-- (LOCAL-MA-S2-01, -02) with the minimum rows the certificate needs, as the owner of the schema. Registration IDs BEE/RAC/2026/10901 and 10902
-- are far above what the allocator hands out, so they cannot clash with a certificate issued by the live approval flow.
BEGIN;
INSERT INTO model_application (id, reference, organisation_id, brand_name, category, model_number, state, version) VALUES
  ('00000000-0000-4000-c000-0000000009a1', 'LOCAL-MA-S2-01', '00000000-0000-4000-b000-000000000001', 'Nova Cool', 'RAC', 'NC-RAC-S2A', 'approved', 3),
  ('00000000-0000-4000-c000-0000000009a2', 'LOCAL-MA-S2-02', '00000000-0000-4000-b000-000000000001', 'Nova Cool', 'RAC', 'NC-RAC-S2B', 'approved', 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after, occurred_at) VALUES
  ('00000000-0000-4000-c000-0000000009b1', '00000000-0000-4000-c000-0000000009a1', 'rate', 'rating', 'director_review', '00000000-0000-4000-a000-000000000005', 'reviewer', 2, '2026-10-01 09:00+05:30'),
  ('00000000-0000-4000-c000-0000000009b2', '00000000-0000-4000-c000-0000000009a1', 'approve', 'secretary_approval', 'approved', '00000000-0000-4000-a000-000000000008', 'secretary', 3, '2026-10-01 11:00+05:30'),
  ('00000000-0000-4000-c000-0000000009b3', '00000000-0000-4000-c000-0000000009a2', 'rate', 'rating', 'director_review', '00000000-0000-4000-a000-000000000005', 'reviewer', 2, '2026-10-02 09:00+05:30'),
  ('00000000-0000-4000-c000-0000000009b4', '00000000-0000-4000-c000-0000000009a2', 'approve', 'secretary_approval', 'approved', '00000000-0000-4000-a000-000000000008', 'secretary', 3, '2026-10-02 11:00+05:30')
ON CONFLICT (id) DO NOTHING;

INSERT INTO model_application_rating (id, application_id, transition_event_id, rating_version, basis, scheme_key, declared_iseer, verified_iseer, stars, computed_by_account_id) VALUES
  ('00000000-0000-4000-c000-0000000009c1', '00000000-0000-4000-c000-0000000009a1', '00000000-0000-4000-c000-0000000009b1', 1, 'local_demo', 'local_demo_rac', 4.10, 4.05, 4, '00000000-0000-4000-a000-000000000005'),
  ('00000000-0000-4000-c000-0000000009c2', '00000000-0000-4000-c000-0000000009a2', '00000000-0000-4000-c000-0000000009b3', 1, 'local_demo', 'local_demo_rac', 4.60, 4.55, 5, '00000000-0000-4000-a000-000000000005')
ON CONFLICT (id) DO NOTHING;

INSERT INTO certificate (id, application_id, transition_event_id, registration_id, category_code, issue_year, sequence_no, valid_from, valid_to,
                         organisation_name, brand_name, model_number, stars, declared_iseer, verified_iseer, scheme_key, issued_by_account_id, issued_at) VALUES
  ('00000000-0000-4000-c000-0000000009d1', '00000000-0000-4000-c000-0000000009a1', '00000000-0000-4000-c000-0000000009b2', 'BEE/RAC/2026/10901', 'RAC', 2026, 10901,
   '2026-10-01', '2029-09-30', 'Nova Cool Appliances Pvt Ltd (synthetic)', 'Nova Cool', 'NC-RAC-S2A', 4, 4.10, 4.05, 'local_demo_rac', '00000000-0000-4000-a000-000000000008', '2026-10-01 11:00+05:30'),
  ('00000000-0000-4000-c000-0000000009d2', '00000000-0000-4000-c000-0000000009a2', '00000000-0000-4000-c000-0000000009b4', 'BEE/RAC/2026/10902', 'RAC', 2026, 10902,
   '2026-10-02', '2029-10-01', 'Nova Cool Appliances Pvt Ltd (synthetic)', 'Nova Cool', 'NC-RAC-S2B', 5, 4.60, 4.55, 'local_demo_rac', '00000000-0000-4000-a000-000000000008', '2026-10-02 11:00+05:30')
ON CONFLICT (id) DO NOTHING;

INSERT INTO qr_batch (id, model_application_id, certificate_id, organisation_id, quantity, status, created_by, created_at) VALUES
  ('00000000-0000-4000-c000-0000000009e1', '00000000-0000-4000-c000-0000000009a1', '00000000-0000-4000-c000-0000000009d1', '00000000-0000-4000-b000-000000000001', 100, 'open',
   '00000000-0000-4000-a000-000000000001', '2026-10-05 10:00+05:30'),
  ('00000000-0000-4000-c000-0000000009e2', '00000000-0000-4000-c000-0000000009a2', '00000000-0000-4000-c000-0000000009d2', '00000000-0000-4000-b000-000000000001', 50, 'open',
   '00000000-0000-4000-a000-000000000001', '2026-10-06 10:00+05:30')
ON CONFLICT (id) DO NOTHING;

-- Batch 1: 40 serials, the first 25 bound, one of the rest void. Batch 2: 30 serials, the first 10 bound. Fixed serials (S2D0 + number) so a demo can name them.
INSERT INTO qr_serial (serial, batch_id, certificate_id, state, allocated_at, bound_at)
  SELECT 'BEEQ-S2D0' || lpad(n::text, 6, '0'), '00000000-0000-4000-c000-0000000009e1', '00000000-0000-4000-c000-0000000009d1',
         CASE WHEN n <= 25 THEN 'bound' ELSE 'allocated' END, '2026-10-05 10:05+05:30', CASE WHEN n <= 25 THEN timestamptz '2026-10-05 10:30+05:30' END
    FROM generate_series(1, 40) AS n
ON CONFLICT (serial) DO NOTHING;
INSERT INTO qr_serial (serial, batch_id, certificate_id, state, allocated_at, bound_at)
  SELECT 'BEEQ-S2D1' || lpad(n::text, 6, '0'), '00000000-0000-4000-c000-0000000009e2', '00000000-0000-4000-c000-0000000009d2',
         CASE WHEN n <= 10 THEN 'bound' ELSE 'allocated' END, '2026-10-06 10:05+05:30', CASE WHEN n <= 10 THEN timestamptz '2026-10-06 10:30+05:30' END
    FROM generate_series(1, 30) AS n
ON CONFLICT (serial) DO NOTHING;
-- One void serial (a damaged label). The update is skipped once it is already void.
UPDATE qr_serial SET state = 'void', voided_at = '2026-10-05 11:00+05:30', void_reason = 'Label damaged in print (synthetic)'
 WHERE serial = 'BEEQ-S2D0000040' AND state = 'allocated';

INSERT INTO qr_event (id, batch_id, action, actor_account_id, detail, occurred_at) VALUES
  ('00000000-0000-4000-c000-0000000009f1', '00000000-0000-4000-c000-0000000009e1', 'created', '00000000-0000-4000-a000-000000000001', 'quantity 100 (seed)', '2026-10-05 10:00+05:30'),
  ('00000000-0000-4000-c000-0000000009f2', '00000000-0000-4000-c000-0000000009e2', 'created', '00000000-0000-4000-a000-000000000001', 'quantity 50 (seed)', '2026-10-06 10:00+05:30')
ON CONFLICT (id) DO NOTHING;
COMMIT;
