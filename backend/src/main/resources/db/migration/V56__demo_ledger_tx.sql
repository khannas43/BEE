-- DEMO S3 (15 October 2026): SIMULATED certificate ledger. A local demonstration, NOT Hyperledger Fabric and not a BEE system.
-- A certificate (V37, append-only) is untouched; its ledger state is implicit "not_submitted" until a ledger_tx exists.
-- Per certificate the transactions form a hash chain: hash = sha256(prev_hash || canonical certificate fields); the first prev_hash is 64 zeros.
-- Every transaction also carries a global block number. certificate_id has no foreign key on purpose: the local maintenance cleanup of
-- disposable applications deletes certificates, and must not be blocked by the demonstration ledger. Reads always join the certificate.

CREATE SEQUENCE ledger_block_seq;

CREATE TABLE ledger_tx (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id uuid NOT NULL,
  seq            integer NOT NULL CHECK (seq >= 1),
  attempt        integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  kind           text NOT NULL CHECK (kind IN ('issue', 'amend', 'revoke')),
  state          text NOT NULL CHECK (state IN ('pending', 'committed', 'failed')),
  prev_hash      text NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash           text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  valid_to       date NOT NULL,
  reason         text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 500),
  failure_reason text CHECK (failure_reason IS NULL OR char_length(btrim(failure_reason)) BETWEEN 1 AND 500),
  block_no       bigint NOT NULL DEFAULT nextval('ledger_block_seq'),
  submitted_by   uuid NOT NULL REFERENCES user_account (id),
  decided_by     uuid REFERENCES user_account (id),
  seeded_note    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  committed_at   timestamptz,
  UNIQUE (certificate_id, seq),
  UNIQUE (block_no),
  CHECK ((state = 'committed') = (committed_at IS NOT NULL)),
  CHECK ((state = 'failed') = (failure_reason IS NOT NULL)),
  CHECK (state = 'pending' OR decided_by IS NOT NULL OR seeded_note IS NOT NULL),
  CHECK (kind <> 'revoke' OR reason IS NOT NULL),
  CHECK (kind <> 'amend' OR reason IS NOT NULL)
);
CREATE UNIQUE INDEX ledger_tx_one_pending ON ledger_tx (certificate_id) WHERE state = 'pending';
CREATE INDEX ledger_tx_certificate ON ledger_tx (certificate_id, seq);

-- The only change a row may undergo: pending becomes committed or failed (decision columns only).
CREATE FUNCTION ledger_tx_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ledger transactions are append-only';
  END IF;
  IF OLD.state <> 'pending' OR NEW.state NOT IN ('committed', 'failed')
     OR (NEW.id, NEW.certificate_id, NEW.seq, NEW.attempt, NEW.kind, NEW.prev_hash, NEW.hash, NEW.valid_to, NEW.reason, NEW.block_no, NEW.submitted_by, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.certificate_id, OLD.seq, OLD.attempt, OLD.kind, OLD.prev_hash, OLD.hash, OLD.valid_to, OLD.reason, OLD.block_no, OLD.submitted_by, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'a ledger transaction may only move from pending to committed or failed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_tx_guard BEFORE UPDATE OR DELETE ON ledger_tx FOR EACH ROW EXECUTE FUNCTION ledger_tx_guard();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON ledger_tx FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change();

-- The audit row of every ledger action, written in the same transaction as the change.
CREATE TABLE ledger_event (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id   uuid NOT NULL,
  tx_id            uuid NOT NULL REFERENCES ledger_tx (id),
  action           text NOT NULL CHECK (action IN ('submit', 'commit', 'fail', 'retry', 'amend', 'revoke')),
  actor_account_id uuid NOT NULL REFERENCES user_account (id),
  reason           text,
  occurred_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_event_certificate ON ledger_event (certificate_id, occurred_at);
CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON ledger_event FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON ledger_event FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change();

-- The hash of one transaction: sha256 over the previous hash and the canonical certificate fields as they stand in this transaction.
CREATE FUNCTION ledger_compute_hash(p_prev text, p_reg text, p_org text, p_brand text, p_model text, p_category text, p_stars integer,
                                    p_iseer numeric, p_valid_from date, p_valid_to date, p_kind text, p_seq integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_prev || '|' || p_reg || '|' || p_org || '|' || p_brand || '|' || p_model || '|' || p_category || '|' || p_stars
    || '|' || to_char(p_iseer, 'FM9990.00') || '|' || to_char(p_valid_from, 'YYYY-MM-DD') || '|' || to_char(p_valid_to, 'YYYY-MM-DD') || '|' || p_kind
    || '|' || p_seq, 'UTF8')), 'hex')
$$;
