-- DEMO: certificates that were issued more than a few days ago are on the ledger. The earlier seeds put only the first 32 certificates on it,
-- so 50 of 84 read "Not submitted", which looked like a backlog. Each certificate issued before 2026-10-15 and without a ledger record now has a
-- committed "issue" record (submitted by the Director, committed by the Admin, the usual two people), chained from the zero hash.
-- The certificates issued from 2026-10-15 stay "not submitted" on purpose: they are the live demonstration (submit, then commit by a second person).
-- Synthetic data only. Idempotent: a certificate with any ledger record is skipped.
DO $$
DECLARE
  sec uuid := '00000000-0000-4000-a000-000000000008';
  adm uuid := '00000000-0000-4000-a000-000000000009';
  c certificate%ROWTYPE;
  prev text := repeat('0', 64);
  h text;
  tx uuid;
BEGIN
  IF to_regclass('ledger_tx') IS NULL THEN
    RETURN;
  END IF;
  FOR c IN SELECT * FROM certificate x WHERE x.issued_at < timestamptz '2026-10-15 00:00:00+05:30'
             AND NOT EXISTS (SELECT 1 FROM ledger_tx t WHERE t.certificate_id = x.id) ORDER BY x.issued_at, x.id LOOP
    h := ledger_compute_hash(prev, c.registration_id, c.organisation_name, c.brand_name, c.model_number, c.category_code, c.stars, c.verified_iseer, c.valid_from, c.valid_to, 'issue', 1);
    tx := md5('s20-tx-' || c.id)::uuid;
    INSERT INTO ledger_tx (id, certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, submitted_by, decided_by, created_at, committed_at)
      VALUES (tx, c.id, 1, 1, 'issue', 'committed', prev, h, c.valid_to, sec, adm, c.issued_at + interval '2 hours', c.issued_at + interval '2 hours 5 seconds') ON CONFLICT (id) DO NOTHING;
    INSERT INTO ledger_event (id, certificate_id, tx_id, action, actor_account_id, reason, occurred_at)
      VALUES (md5('s20-ev-' || c.id)::uuid, c.id, tx, 'commit', adm, 'seeded', c.issued_at + interval '2 hours 5 seconds') ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;
