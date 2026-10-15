-- Demonstration slice S1: simulated payment gateway. Local demonstration on provisional rules, not BEE rules, not a real gateway.
-- payment: one attempt to pay the fee due on a model application (amount fixed at start from the fee snapshot, never from a callback).
-- payment_callback: the simulated gateway's callbacks, de-duplicated by the SHA-256 of the canonical payload.
-- payment_event: append-only audit of every change (started, paid, failed), written in the same transaction as the change.
-- No foreign key from payment to model_application on purpose: the disposable-application cleanup must keep working.
CREATE TABLE payment (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id       uuid NOT NULL,
  organisation_id      uuid NOT NULL REFERENCES organisation (id),
  amount_inr           numeric(14, 2) NOT NULL CHECK (amount_inr > 0),
  status               text NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'paid', 'failed')),
  gateway_ref          text NOT NULL UNIQUE CHECK (gateway_ref ~ '^SIMGW-[0-9A-F]{8}$'),
  started_by_account_id uuid NOT NULL REFERENCES user_account (id),
  receipt_number       text UNIQUE CHECK (receipt_number ~ '^SIMRCPT-[0-9]{8}-[0-9]{4,}$'),
  created_at           timestamptz NOT NULL DEFAULT now(),
  settled_at           timestamptz,
  CHECK ((status = 'initiated') = (settled_at IS NULL)),
  CHECK ((status = 'paid') = (receipt_number IS NOT NULL))
);
CREATE INDEX payment_application ON payment (application_id);
CREATE INDEX payment_organisation ON payment (organisation_id, created_at DESC);
-- At most one open or paid payment per application; a failed one can be followed by a new attempt.
CREATE UNIQUE INDEX payment_one_live_per_application ON payment (application_id) WHERE status IN ('initiated', 'paid');

CREATE TABLE payment_callback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id     uuid NOT NULL REFERENCES payment (id),
  gateway_ref    text NOT NULL,
  outcome        text NOT NULL CHECK (outcome IN ('paid', 'failed')),
  payload_sha256 text NOT NULL UNIQUE CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  received_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_callback_payment ON payment_callback (payment_id);

CREATE TABLE payment_event (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id       uuid NOT NULL REFERENCES payment (id),
  event            text NOT NULL CHECK (event IN ('started', 'paid', 'failed')),
  actor_account_id uuid NOT NULL REFERENCES user_account (id),
  actor_role       text NOT NULL,
  detail           text,
  occurred_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_event_payment ON payment_event (payment_id, occurred_at);
CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON payment_event FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON payment_event FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON payment_callback FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON payment_callback FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change();

COMMENT ON TABLE payment IS 'Simulated gateway payment of a model application fee. Local demonstration, not a real payment system.';
