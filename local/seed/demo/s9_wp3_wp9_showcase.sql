-- S9: WP3–WP9 guided demo readiness (synthetic). Idempotent assertions and showcase markers only.
-- Does not change schema. Run after s1–s8 via scripts/demo/seed-demo.sh.
-- Renewal, withdrawal and cancellation **screens** remain lifecycle-store previews until WP9 production (see docs/demo/DEMO_WP3_WP9_SCRIPT.md).

DO $$
DECLARE
  nova constant uuid := '00000000-0000-4000-b000-000000000001';
BEGIN
  IF (SELECT count(*) FROM certificate WHERE registration_id = 'BEE/RAC/2026/10101') <> 1 THEN
    RAISE EXCEPTION 's9: certificate BEE/RAC/2026/10101 missing (run s4_production.sql)';
  END IF;
  IF (SELECT count(*) FROM model_application WHERE reference = 'DEMO-MA-0101' AND state = 'approved') <> 1 THEN
    RAISE EXCEPTION 's9: Nova approved model DEMO-MA-0101 missing';
  END IF;
  IF (SELECT count(*) FROM registration_application WHERE reference = 'REG-2026-9001' AND state = 'approved') <> 1 THEN
    RAISE EXCEPTION 's9: approved brand registration REG-2026-9001 missing (run s5_mis.sql and s8_registrations.sql)';
  END IF;
  IF (SELECT count(*) FROM brand b JOIN organisation o ON o.id = b.owner_organisation_id WHERE o.code = 'NOVA' AND b.name = 'Nova Cool') < 1 THEN
    RAISE EXCEPTION 's9: Nova Cool brand on register missing (base seed or s7_register.sql)';
  END IF;
  IF (SELECT count(*) FROM model_application WHERE reference LIKE 'DEMO-PAY-%') < 5 THEN
    RAISE EXCEPTION 's9: demo payment applications missing (run s1_payments.sql)';
  END IF;
  IF (SELECT count(*) FROM qr_batch qb JOIN certificate c ON c.id = qb.certificate_id WHERE c.registration_id = 'BEE/RAC/2026/10101') < 1 THEN
    RAISE EXCEPTION 's9: QR batch for BEE/RAC/2026/10101 missing (run s2_qr.sql / s4_production.sql)';
  END IF;
  IF (SELECT count(*) FROM production_submission WHERE organisation_id = nova AND quarter = '2026-Q3') < 1 THEN
    RAISE EXCEPTION 's9: Nova 2026-Q3 production submission missing (run s4_production.sql)';
  END IF;
  IF (SELECT count(*) FROM register_revocation_proposal WHERE state = 'pending') < 1 THEN
    RAISE EXCEPTION 's9: pending register revocation proposal missing (run s7_register.sql)';
  END IF;
END $$;

-- Do not UPDATE brand rows here: base seed (local/seed/seed.sql) rejects any drift from generate-fixtures.cjs.
-- Presenter copy for Nova Cool lives in docs/demo/DEMO_WP3_WP9_SCRIPT.md.
