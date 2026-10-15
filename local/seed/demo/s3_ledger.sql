-- DEMO S3 seed: SIMULATED ledger transactions (a local test network, not Hyperledger Fabric) for the first four certificates found.
-- Run after the demo frame has issued certificates. Idempotent: a certificate that already has ledger transactions is left alone.
--   1st certificate: issue committed                      -> active (amend / revoke can be shown live)
--   2nd certificate: issue pending                        -> a second person commits or fails it live
--   3rd certificate: issue failed, retry failed again     -> failed, with attempt history (retry live)
--   4th certificate: issue committed, hash SEEDED MISMATCH -> chain verification reports MISMATCH
-- Synthetic data. Submitted by the Secretary, decided by the Admin.
DO $$
DECLARE
  sec  uuid := '00000000-0000-4000-a000-000000000008';
  adm  uuid := '00000000-0000-4000-a000-000000000009';
  c    certificate%ROWTYPE;
  n    integer := 0;
  prev text;
  h    text;
BEGIN
  IF to_regclass('ledger_tx') IS NULL THEN
    RETURN;
  END IF;
  FOR c IN SELECT * FROM certificate ORDER BY issued_at, id LIMIT 4 LOOP
    n := n + 1;
    CONTINUE WHEN EXISTS (SELECT 1 FROM ledger_tx WHERE certificate_id = c.id);
    prev := repeat('0', 64);
    h := ledger_compute_hash(prev, c.registration_id, c.organisation_name, c.brand_name, c.model_number, c.category_code, c.stars, c.verified_iseer, c.valid_from, c.valid_to, 'issue', 1);
    IF n = 1 THEN
      INSERT INTO ledger_tx (certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, submitted_by, decided_by, created_at, committed_at)
      VALUES (c.id, 1, 1, 'issue', 'committed', prev, h, c.valid_to, sec, adm, now() - interval '3 hours', now() - interval '3 hours' + interval '2 seconds');
    ELSIF n = 2 THEN
      INSERT INTO ledger_tx (certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, submitted_by, created_at)
      VALUES (c.id, 1, 1, 'issue', 'pending', prev, h, c.valid_to, sec, now() - interval '20 minutes');
    ELSIF n = 3 THEN
      INSERT INTO ledger_tx (certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, failure_reason, submitted_by, decided_by, created_at)
      VALUES (c.id, 1, 1, 'issue', 'failed', prev, h, c.valid_to, 'Simulated peer timeout (seeded)', sec, adm, now() - interval '2 hours');
      prev := h;
      h := ledger_compute_hash(prev, c.registration_id, c.organisation_name, c.brand_name, c.model_number, c.category_code, c.stars, c.verified_iseer, c.valid_from, c.valid_to, 'issue', 2);
      INSERT INTO ledger_tx (certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, failure_reason, submitted_by, decided_by, created_at)
      VALUES (c.id, 2, 2, 'issue', 'failed', prev, h, c.valid_to, 'Simulated endorsement policy not met (seeded)', sec, adm, now() - interval '1 hour');
    ELSE
      -- seeded mismatch: the stored hash is not the hash of these certificate fields
      INSERT INTO ledger_tx (certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, submitted_by, decided_by, created_at, committed_at, seeded_note)
      VALUES (c.id, 1, 1, 'issue', 'committed', prev,
              encode(sha256(convert_to('tampered ' || c.registration_id, 'UTF8')), 'hex'), c.valid_to, sec, adm,
              now() - interval '5 hours', now() - interval '5 hours' + interval '2 seconds', 'seeded mismatch: the stored hash was altered for the demonstration');
    END IF;
    INSERT INTO ledger_event (certificate_id, tx_id, action, actor_account_id, reason)
      SELECT t.certificate_id, t.id, 'submit', t.submitted_by, 'seeded' FROM ledger_tx t WHERE t.certificate_id = c.id AND t.seq = 1;
  END LOOP;
END $$;
