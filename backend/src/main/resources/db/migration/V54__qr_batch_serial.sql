-- Demo slice S2 (local demonstration on provisional rules, not BEE rules): QR batches and serials for an approved model that has a certificate.
-- A batch belongs to one certificate; serials are allocated inside it up to its quantity, bound to the certificate, or voided.
-- Serial format BEEQ- + 10 characters of Crockford base32 (no I, L, O, U), made from a secure random in the service and unique here.
-- Every change is also written to qr_event (append only), in the same transaction.

CREATE TABLE qr_batch (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_application_id uuid NOT NULL REFERENCES model_application (id),
  certificate_id       uuid NOT NULL REFERENCES certificate (id),
  organisation_id      uuid NOT NULL REFERENCES organisation (id),
  quantity             integer NOT NULL CHECK (quantity BETWEEN 1 AND 5000),
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by           uuid NOT NULL REFERENCES user_account (id),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qr_batch_organisation ON qr_batch (organisation_id, created_at);
CREATE INDEX qr_batch_certificate ON qr_batch (certificate_id);

CREATE TABLE qr_serial (
  serial         text PRIMARY KEY CHECK (serial ~ '^BEEQ-[0-9A-HJKMNP-TV-Z]{10}$'),
  batch_id       uuid NOT NULL REFERENCES qr_batch (id),
  certificate_id uuid NOT NULL REFERENCES certificate (id),
  state          text NOT NULL DEFAULT 'allocated' CHECK (state IN ('allocated', 'bound', 'void')),
  allocated_at   timestamptz NOT NULL DEFAULT now(),
  bound_at       timestamptz,
  voided_at      timestamptz,
  void_reason    text CHECK (void_reason IS NULL OR char_length(btrim(void_reason)) BETWEEN 1 AND 200),
  CHECK ((state = 'bound') = (bound_at IS NOT NULL) OR state = 'void'),
  CHECK ((state = 'void') = (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE INDEX qr_serial_batch ON qr_serial (batch_id, allocated_at, serial);

CREATE FUNCTION qr_serial_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'a serial is never deleted; void it';
  END IF;
  IF NEW.serial <> OLD.serial OR NEW.batch_id <> OLD.batch_id OR NEW.certificate_id <> OLD.certificate_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'which serial, batch and certificate cannot be changed';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'allocated' AND NEW.state IN ('bound', 'void'))
    OR (OLD.state = 'bound' AND NEW.state = 'void')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format('a serial cannot move from %s to %s', OLD.state, NEW.state);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER qr_serial_transition BEFORE UPDATE OR DELETE ON qr_serial FOR EACH ROW EXECUTE FUNCTION qr_serial_transition();

CREATE TABLE qr_event (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          uuid NOT NULL REFERENCES qr_batch (id),
  action            text NOT NULL CHECK (action IN ('created', 'allocated', 'bound', 'voided')),
  actor_account_id  uuid NOT NULL REFERENCES user_account (id),
  detail            text,
  occurred_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qr_event_batch ON qr_event (batch_id, occurred_at);
CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON qr_event FOR EACH ROW EXECUTE FUNCTION submission_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON qr_event FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change();
