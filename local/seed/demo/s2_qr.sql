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

-- Eight further batches for the production models (created in s4, which runs first). Quantities are partly used, two batches are closed and fully bound,
-- and a few serials are void. Bound counts sit just above a normal quarter's units, so only the three seeded spikes fail reconciliation.
BEGIN;
INSERT INTO qr_batch (id, model_application_id, certificate_id, organisation_id, quantity, status, created_by, created_at) VALUES
  ('00000000-0000-4000-c000-000000001501', '00000000-0000-4000-c000-000000001101', '00000000-0000-4000-c200-000000001101', '00000000-0000-4000-b000-000000000504', 2000, 'open', '00000000-0000-4000-a000-000000000001', now() - interval '70 days'),
  ('00000000-0000-4000-c000-000000001502', '00000000-0000-4000-c000-000000001102', '00000000-0000-4000-c200-000000001102', '00000000-0000-4000-b000-000000000504', 2000, 'open', '00000000-0000-4000-a000-000000000001', now() - interval '68 days'),
  ('00000000-0000-4000-c000-000000001503', '00000000-0000-4000-c000-000000001111', '00000000-0000-4000-c200-000000001111', '00000000-0000-4000-b000-000000000505', 1800, 'open', '00000000-0000-4000-a000-000000000001', now() - interval '66 days'),
  ('00000000-0000-4000-c000-000000001504', '00000000-0000-4000-c000-000000001112', '00000000-0000-4000-c200-000000001112', '00000000-0000-4000-b000-000000000505', 2400, 'open', '00000000-0000-4000-a000-000000000001', now() - interval '64 days'),
  ('00000000-0000-4000-c000-000000001505', '00000000-0000-4000-c000-000000001121', '00000000-0000-4000-c200-000000001121', '00000000-0000-4000-b000-000000000506', 1600, 'closed', '00000000-0000-4000-a000-000000000001', now() - interval '62 days'),
  ('00000000-0000-4000-c000-000000001506', '00000000-0000-4000-c000-000000001122', '00000000-0000-4000-c200-000000001122', '00000000-0000-4000-b000-000000000506', 1600, 'closed', '00000000-0000-4000-a000-000000000001', now() - interval '60 days'),
  ('00000000-0000-4000-c000-000000001507', '00000000-0000-4000-c000-000000001131', '00000000-0000-4000-c200-000000001131', '00000000-0000-4000-b000-000000000002', 1200, 'open', '00000000-0000-4000-a000-000000000002', now() - interval '58 days'),
  ('00000000-0000-4000-c000-000000001508', '00000000-0000-4000-c000-000000001132', '00000000-0000-4000-c200-000000001132', '00000000-0000-4000-b000-000000000002', 3200, 'open', '00000000-0000-4000-a000-000000000002', now() - interval '56 days')
ON CONFLICT (id) DO NOTHING;

-- prefix is 4 Crockford characters; the 6-digit tail makes the 10 characters the serial check requires. 1..1100 bound, 1101..1220 allocated, 1221..1224 void.
INSERT INTO qr_serial (serial, batch_id, certificate_id, state, allocated_at, bound_at, voided_at, void_reason)
SELECT 'BEEQ-' || b.prefix || lpad(n::text, 6, '0'), b.batch_id, b.certificate_id,
       CASE WHEN n <= b.bound_n THEN 'bound' WHEN n <= b.alloc_n THEN 'allocated' ELSE 'void' END,
       b.at, CASE WHEN n <= b.bound_n THEN b.at + interval '1 hour' END,
       CASE WHEN n > b.alloc_n THEN b.at + interval '2 hours' END,
       CASE WHEN n > b.alloc_n THEN 'Label damaged in print (synthetic)' END
FROM (VALUES
  ('S2E0'::text, '00000000-0000-4000-c000-000000001501'::uuid, '00000000-0000-4000-c200-000000001101'::uuid, 1100, 1220, 1224, now() - interval '70 days'),
  ('S2F0', '00000000-0000-4000-c000-000000001502', '00000000-0000-4000-c200-000000001102', 1100, 1220, 1224, now() - interval '68 days'),
  ('S2G0', '00000000-0000-4000-c000-000000001503', '00000000-0000-4000-c200-000000001111', 1100, 1220, 1220, now() - interval '66 days'),
  ('S2H0', '00000000-0000-4000-c000-000000001504', '00000000-0000-4000-c200-000000001112', 1100, 1220, 1220, now() - interval '64 days'),
  ('S2J0', '00000000-0000-4000-c000-000000001505', '00000000-0000-4000-c200-000000001121', 1600, 1600, 1600, now() - interval '62 days'),
  ('S2K0', '00000000-0000-4000-c000-000000001506', '00000000-0000-4000-c200-000000001122', 1600, 1600, 1600, now() - interval '60 days'),
  ('S2M0', '00000000-0000-4000-c000-000000001507', '00000000-0000-4000-c200-000000001131', 1100, 1180, 1184, now() - interval '58 days'),
  ('S2N0', '00000000-0000-4000-c000-000000001508', '00000000-0000-4000-c200-000000001132', 1100, 1220, 1220, now() - interval '56 days')
) AS b (prefix, batch_id, certificate_id, bound_n, alloc_n, last_n, at)
JOIN generate_series(1, 1600) AS n ON n <= b.last_n
ON CONFLICT (serial) DO NOTHING;

INSERT INTO qr_event (id, batch_id, action, actor_account_id, detail, occurred_at)
SELECT md5('s2b-' || b.id::text || '-' || a.action)::uuid, b.id, a.action,
       CASE WHEN b.organisation_id = '00000000-0000-4000-b000-000000000002'::uuid THEN '00000000-0000-4000-a000-000000000002'::uuid
            ELSE '00000000-0000-4000-a000-000000000001'::uuid END,
       a.detail, b.created_at
FROM qr_batch b
JOIN (VALUES ('created', 'seeded batch'), ('allocated', 'seeded allocation'), ('bound', 'seeded binding')) AS a (action, detail) ON true
WHERE b.id IN (
  '00000000-0000-4000-c000-000000001501','00000000-0000-4000-c000-000000001502','00000000-0000-4000-c000-000000001503','00000000-0000-4000-c000-000000001504',
  '00000000-0000-4000-c000-000000001505','00000000-0000-4000-c000-000000001506','00000000-0000-4000-c000-000000001507','00000000-0000-4000-c000-000000001508')
ON CONFLICT (id) DO NOTHING;
INSERT INTO qr_event (id, batch_id, action, actor_account_id, detail, occurred_at) VALUES
  (md5('s2b-void-1501')::uuid, '00000000-0000-4000-c000-000000001501', 'voided', '00000000-0000-4000-a000-000000000001', 'four damaged labels (synthetic)', now() - interval '69 days'),
  (md5('s2b-void-1502')::uuid, '00000000-0000-4000-c000-000000001502', 'voided', '00000000-0000-4000-a000-000000000001', 'four damaged labels (synthetic)', now() - interval '67 days'),
  (md5('s2b-void-1507')::uuid, '00000000-0000-4000-c000-000000001507', 'voided', '00000000-0000-4000-a000-000000000002', 'four damaged labels (synthetic)', now() - interval '57 days')
ON CONFLICT (id) DO NOTHING;
COMMIT;

-- Nova's three production models (10101 to 10103) get bound serials sized against their declarations, so quarterly reconciliation flags
-- only the seeded 10101 spike (about 30,000 declared in 2026-Q3 against 4,800 bound) and the AI production-anomaly run, which compares all
-- quarters with the bound serials, flags 10101 only (10102 and 10103 have enough bound serials for everything declared, with room for a live 2026-Q4 entry).
-- A batch holds at most 5,000 serials, so the larger models have several batches.
BEGIN;
INSERT INTO qr_batch (id, model_application_id, certificate_id, organisation_id, quantity, status, created_by, created_at)
SELECT b.id::uuid, b.app::uuid, b.cert::uuid, '00000000-0000-4000-b000-000000000001', 5000, 'open', '00000000-0000-4000-a000-000000000001', now() - make_interval(days => b.days)
FROM (VALUES
  ('00000000-0000-4000-c000-000000001601', '00000000-0000-4000-c000-000000000101', '00000000-0000-4000-c200-000000000101', 90),
  ('00000000-0000-4000-c000-000000001602', '00000000-0000-4000-c000-000000000102', '00000000-0000-4000-c200-000000000102', 88),
  ('00000000-0000-4000-c000-000000001603', '00000000-0000-4000-c000-000000000103', '00000000-0000-4000-c200-000000000103', 86),
  ('00000000-0000-4000-c000-000000001604', '00000000-0000-4000-c000-000000000102', '00000000-0000-4000-c200-000000000102', 87),
  ('00000000-0000-4000-c000-000000001605', '00000000-0000-4000-c000-000000000102', '00000000-0000-4000-c200-000000000102', 85),
  ('00000000-0000-4000-c000-000000001606', '00000000-0000-4000-c000-000000000102', '00000000-0000-4000-c200-000000000102', 84),
  ('00000000-0000-4000-c000-000000001607', '00000000-0000-4000-c000-000000000102', '00000000-0000-4000-c200-000000000102', 83),
  ('00000000-0000-4000-c000-000000001608', '00000000-0000-4000-c000-000000000103', '00000000-0000-4000-c200-000000000103', 82),
  ('00000000-0000-4000-c000-000000001609', '00000000-0000-4000-c000-000000000103', '00000000-0000-4000-c200-000000000103', 81),
  ('00000000-0000-4000-c000-000000001610', '00000000-0000-4000-c000-000000000103', '00000000-0000-4000-c200-000000000103', 80),
  ('00000000-0000-4000-c000-000000001611', '00000000-0000-4000-c000-000000000102', '00000000-0000-4000-c200-000000000102', 79),
  ('00000000-0000-4000-c000-000000001612', '00000000-0000-4000-c000-000000000102', '00000000-0000-4000-c200-000000000102', 78),
  ('00000000-0000-4000-c000-000000001613', '00000000-0000-4000-c000-000000000102', '00000000-0000-4000-c200-000000000102', 77)
) AS b (id, app, cert, days)
ON CONFLICT (id) DO NOTHING;
INSERT INTO qr_serial (serial, batch_id, certificate_id, state, allocated_at, bound_at)
SELECT 'BEEQ-' || b.prefix || lpad(n::text, 6, '0'), b.batch_id, b.certificate_id, 'bound', b.at, b.at + interval '1 hour'
FROM (VALUES
  ('S2P0'::text, '00000000-0000-4000-c000-000000001601'::uuid, '00000000-0000-4000-c200-000000000101'::uuid, 4800, now() - interval '90 days'),
  ('S2Q0', '00000000-0000-4000-c000-000000001602', '00000000-0000-4000-c200-000000000102', 5000, now() - interval '88 days'),
  ('S2R0', '00000000-0000-4000-c000-000000001603', '00000000-0000-4000-c200-000000000103', 5000, now() - interval '86 days'),
  ('S2S0', '00000000-0000-4000-c000-000000001604', '00000000-0000-4000-c200-000000000102', 5000, now() - interval '87 days'),
  ('S2T0', '00000000-0000-4000-c000-000000001605', '00000000-0000-4000-c200-000000000102', 5000, now() - interval '85 days'),
  ('S2V0', '00000000-0000-4000-c000-000000001606', '00000000-0000-4000-c200-000000000102', 5000, now() - interval '84 days'),
  ('S2W0', '00000000-0000-4000-c000-000000001607', '00000000-0000-4000-c200-000000000102', 5000, now() - interval '83 days'),
  ('S2X0', '00000000-0000-4000-c000-000000001608', '00000000-0000-4000-c200-000000000103', 4000, now() - interval '82 days'),
  ('S2Y0', '00000000-0000-4000-c000-000000001609', '00000000-0000-4000-c200-000000000103', 4000, now() - interval '81 days'),
  ('S2Z0', '00000000-0000-4000-c000-000000001610', '00000000-0000-4000-c200-000000000103', 4000, now() - interval '80 days'),
  ('S3A0', '00000000-0000-4000-c000-000000001611', '00000000-0000-4000-c200-000000000102', 5000, now() - interval '79 days'),
  ('S3B0', '00000000-0000-4000-c000-000000001612', '00000000-0000-4000-c200-000000000102', 5000, now() - interval '78 days'),
  ('S3C0', '00000000-0000-4000-c000-000000001613', '00000000-0000-4000-c200-000000000102', 5000, now() - interval '77 days')
) AS b (prefix, batch_id, certificate_id, bound_n, at)
JOIN generate_series(1, 5000) AS n ON n <= b.bound_n
ON CONFLICT (serial) DO NOTHING;
INSERT INTO qr_event (id, batch_id, action, actor_account_id, detail, occurred_at)
SELECT md5('s2n-' || b.id::text || '-' || a.action)::uuid, b.id, a.action, '00000000-0000-4000-a000-000000000001'::uuid, a.detail, b.created_at
FROM qr_batch b
JOIN (VALUES ('created', 'seeded batch'), ('allocated', 'seeded allocation'), ('bound', 'seeded binding')) AS a (action, detail) ON true
WHERE b.id IN ('00000000-0000-4000-c000-000000001601','00000000-0000-4000-c000-000000001602','00000000-0000-4000-c000-000000001603','00000000-0000-4000-c000-000000001604',
               '00000000-0000-4000-c000-000000001605','00000000-0000-4000-c000-000000001606','00000000-0000-4000-c000-000000001607','00000000-0000-4000-c000-000000001608',
               '00000000-0000-4000-c000-000000001609','00000000-0000-4000-c000-000000001610','00000000-0000-4000-c000-000000001611','00000000-0000-4000-c000-000000001612','00000000-0000-4000-c000-000000001613')
ON CONFLICT (id) DO NOTHING;
COMMIT;
