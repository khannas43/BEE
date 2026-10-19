-- DEMO: the compliance-risk model's sample profiles now describe the demonstration's own manufacturers. Each row is keyed by the
-- organisation id, so it replaces that organisation's live-scored entry (same key) and the AI screen can link the finding to its
-- Manufacturer 360 profile. The numbers are sample figures chosen to match the story (holds, suspended brands, a production spike),
-- not measurements. Rows stay marked synthetic. Replaces the older generic sample rows. Idempotent.
BEGIN;
DELETE FROM ai_demo_entity;
INSERT INTO ai_demo_entity (entity_key, name, kind, applications, returned, rejected, resubmissions, efficiency_gap_pct, fee_delay_days, production_ratio)
SELECT o.id::text, v.name, 'manufacturer', v.apps, v.ret, v.rej, v.resub, v.gap, v.delay, v.prod
FROM (VALUES
  ('SYNTH-MFG-6', 'Cinder Peak Cooling Pvt Ltd',          9, 3, 3, 2, 3.5,  6.0, 1.90),
  ('SYNTH-MFG-4', 'Harbor Breeze Cooling Pvt Ltd',       10, 4, 2, 3, 7.2,  9.0, 1.20),
  ('SYNTH-MFG-8', 'Northwind Comforts Pvt Ltd',           8, 3, 1, 2, 5.5, 11.0, 1.30),
  ('SYNTH-MFG-1', 'Synthetic Maker One',                 24, 6, 2, 3, 3.0,  4.0, 1.10),
  ('GUEST-00002', 'Kestrel Cooling Systems Pvt Ltd',      2, 1, 0, 2, 8.0,  5.0, NULL),
  ('GUEST-00003', 'Brightwave Appliances Pvt Ltd',        2, 1, 0, 1, 6.0, 38.0, NULL),
  ('NOVA',        'Nova Cool Appliances Pvt Ltd',        16, 3, 0, 2, 1.2,  2.5, 1.05),
  ('SYNTH-MFG-5', 'Lumen Frost Appliances Pvt Ltd',      15, 2, 1, 1, 2.0,  3.0, 1.10),
  ('SYNTH-MFG-7', 'Marigold Air Systems Pvt Ltd',        14, 1, 0, 0, 1.0,  2.0, 1.00),
  ('SYNTH-MFG-2', 'Synthetic Maker Two',                 27, 2, 0, 1, 1.5,  2.0, 1.00),
  ('SYNTH-MFG-3', 'Synthetic Maker Three',               25, 2, 1, 1, 1.8,  3.0, 1.05),
  ('GUEST-00001', 'Ravik Appliances Pvt Ltd',             1, 0, 0, 0, 0.0,  0.0, NULL),
  ('GUEST-00004', 'Zephyr Climate Appliances Pvt Ltd',    1, 0, 0, 0, 0.0,  0.0, NULL)
) AS v(code, name, apps, ret, rej, resub, gap, delay, prod)
JOIN organisation o ON o.code = v.code
ON CONFLICT (entity_key) DO NOTHING;
COMMIT;
