-- S7: sample data for the Register page (brands, agency authorisations, closure and revocation proposals). Synthetic; safe to run twice.
DO $$
DECLARE
  prog uuid := '00000000-0000-4000-a000-000000000006';
  dir  uuid := '00000000-0000-4000-a000-000000000007';
  pixel uuid := '00000000-0000-4000-b000-000000000002';
  orgs uuid[] := ARRAY['00000000-0000-4000-b000-000000000501','00000000-0000-4000-b000-000000000502','00000000-0000-4000-b000-000000000503','00000000-0000-4000-b000-000000000504','00000000-0000-4000-b000-000000000505','00000000-0000-4000-b000-000000000506','00000000-0000-4000-b000-000000000507','00000000-0000-4000-b000-000000000508']::uuid[];
  names text[] := ARRAY['Aurora Chill','Polar Wave','Breezo Home','Cooldrift','Zephyr Air','Glacier One','Mistral Cool','Arctic Pulse','Tundra Line','Frostbyte'];
  stat  text[] := ARRAY['active','active','suspended','active','revoked','active','suspended','active','revoked','active'];
  i int; b uuid; a uuid;
BEGIN
  FOR i IN 1..10 LOOP
    b := ('00000000-0000-4000-c000-0000000013' || lpad(i::text, 2, '0'))::uuid;
    INSERT INTO brand (id, name, owner_organisation_id, status, source_reference, verification_status, note)
      VALUES (b, names[i] || ' (synthetic)', orgs[1 + (i % 8)], stat[i], 'S7 register demo seed (synthetic)', 'synthetic', 'Synthetic brand for the register demonstration')
      ON CONFLICT (id) DO NOTHING;
  END LOOP;
  -- agency authorisations of PixelCert for a mix of brands: open-ended, dated, revoked
  FOR i IN 1..8 LOOP
    b := ('00000000-0000-4000-c000-0000000013' || lpad(i::text, 2, '0'))::uuid;
    a := ('00000000-0000-4000-e000-0000000001' || lpad(i::text, 2, '0'))::uuid;
    INSERT INTO agency_authorisation (id, agency_organisation_id, principal_organisation_id, brand_id, valid_from, valid_to, status, source_reference, verification_status, note)
      SELECT a, pixel, br.owner_organisation_id, br.id, date '2026-01-15' + (i * 20), CASE WHEN i % 3 = 0 THEN date '2027-06-30' + i ELSE NULL END,
             CASE WHEN i IN (4, 8) THEN 'revoked' ELSE 'active' END, 'S7 register demo seed (synthetic)', 'synthetic', 'Synthetic authorisation'
      FROM brand br WHERE br.id = b AND br.status <> 'revoked'
      ON CONFLICT (id) DO NOTHING;
  END LOOP;
  -- proposals: two waiting, one approved, one rejected, one withdrawn
  INSERT INTO register_revocation_proposal (id, target_brand_id, target_authorisation_id, action, close_on, reason, proposed_by, proposed_at)
  VALUES
    ('00000000-0000-4000-c000-0000000014a1', '00000000-0000-4000-c000-000000001302', NULL, 'revoke', NULL, 'The brand owner has stopped trading; no rated model is active.', prog, now() - interval '2 days'),
    ('00000000-0000-4000-c000-0000000014a2', NULL, '00000000-0000-4000-e000-000000000103', 'close', date '2027-01-31', 'Agency contract with the principal ends on 31 January 2027.', prog, now() - interval '1 day'),
    ('00000000-0000-4000-c000-0000000014b1', '00000000-0000-4000-c000-000000001305', NULL, 'revoke', NULL, 'Repeated mislabelling found in two audits.', prog, now() - interval '30 days'),
    ('00000000-0000-4000-c000-0000000014b2', '00000000-0000-4000-c000-000000001306', NULL, 'revoke', NULL, 'Trade licence lapsed; owner has since renewed it.', prog, now() - interval '20 days'),
    ('00000000-0000-4000-c000-0000000014b3', NULL, '00000000-0000-4000-e000-000000000102', 'revoke', NULL, 'Raised in error against the wrong agency.', prog, now() - interval '12 days')
  ON CONFLICT (id) DO NOTHING;
  UPDATE register_revocation_proposal SET state = 'approved', decided_by = dir, decided_at = now() - interval '28 days', decision_note = NULL
    WHERE id = '00000000-0000-4000-c000-0000000014b1' AND state = 'pending';
  UPDATE register_revocation_proposal SET state = 'rejected', decided_by = dir, decided_at = now() - interval '18 days', decision_note = 'The licence was renewed in time; no action needed.'
    WHERE id = '00000000-0000-4000-c000-0000000014b2' AND state = 'pending';
  UPDATE register_revocation_proposal SET state = 'withdrawn', decided_by = prog, decided_at = now() - interval '11 days', decision_note = NULL
    WHERE id = '00000000-0000-4000-c000-0000000014b3' AND state = 'pending';
END $$;
