-- DEMO: simulated email and SMS notifications (local demonstration, not a BEE system; nothing is ever sent anywhere).
-- A message is a row in an outbox that the person reads in the portal under "Notifications (email and SMS)". Like V39, the rows are written
-- by triggers on the audit records the demo slices already write (payment_event, ledger_event, production_event), in the same transaction,
-- so a step cannot succeed without its message and no Java code can forget one. Addresses are synthetic: an @bee-demo.invalid email and a
-- masked made-up mobile number. A seed can switch the triggers off for its own session with: SET bee.demo_seeding = 'on'.
-- Messages are append-only except that the recipient marks one read (once).

CREATE TABLE demo_message (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_account_id  uuid NOT NULL REFERENCES user_account (id),
  channel               text NOT NULL CHECK (channel IN ('email', 'sms')),
  address               text NOT NULL,
  event_kind            text NOT NULL CHECK (event_kind ~ '^[a-z_]{3,40}$'),
  reference             text,
  subject               text,
  body                  text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at            timestamptz NOT NULL DEFAULT now(),
  read_at               timestamptz,
  CHECK (channel = 'email' OR subject IS NULL),
  CHECK (channel = 'sms' OR subject IS NOT NULL)
);
CREATE INDEX demo_message_recipient ON demo_message (recipient_account_id, created_at DESC);
CREATE INDEX demo_message_unread ON demo_message (recipient_account_id) WHERE read_at IS NULL;

CREATE FUNCTION demo_message_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'bee_local_maint' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.read_at IS NULL AND NEW.read_at IS NOT NULL
     AND (NEW.id, NEW.recipient_account_id, NEW.channel, NEW.address, NEW.event_kind, NEW.reference, NEW.subject, NEW.body, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.recipient_account_id, OLD.channel, OLD.address, OLD.event_kind, OLD.reference, OLD.subject, OLD.body, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000',
    MESSAGE = format('%s records are append-only (%s refused for %s)', TG_TABLE_NAME, TG_OP, current_user);
END $$;
CREATE TRIGGER demo_message_row_change BEFORE UPDATE OR DELETE ON demo_message FOR EACH ROW EXECUTE FUNCTION demo_message_guard();
CREATE TRIGGER demo_message_truncate BEFORE TRUNCATE ON demo_message FOR EACH STATEMENT EXECUTE FUNCTION demo_message_guard();

-- One email, and optionally one short SMS, to one person. Called only by the functions and triggers below.
CREATE FUNCTION demo_message_send(p_account uuid, p_kind text, p_reference text, p_subject text, p_body text, p_sms text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  uname text;
BEGIN
  SELECT username INTO uname FROM user_account WHERE id = p_account AND status = 'active';
  IF uname IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO demo_message (recipient_account_id, channel, address, event_kind, reference, subject, body)
    VALUES (p_account, 'email', uname || '@bee-demo.invalid', p_kind, p_reference, p_subject, p_body);
  IF p_sms IS NOT NULL THEN
    INSERT INTO demo_message (recipient_account_id, channel, address, event_kind, reference, body)
      VALUES (p_account, 'sms', '+91 9XXXXX' || lpad((abs(hashtext(uname)) % 10000)::text, 4, '0') || ' (synthetic)', p_kind, p_reference, left(p_sms, 160));
  END IF;
END $$;

-- Everyone who is an active member of the organisation.
CREATE FUNCTION demo_message_org(p_org uuid, p_kind text, p_reference text, p_subject text, p_body text, p_sms text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT m.user_id FROM organisation_membership m JOIN organisation o ON o.id = m.organisation_id
            WHERE m.organisation_id = p_org AND m.active AND o.status = 'active' AND now() >= m.valid_from AND now() < m.valid_to LOOP
    PERFORM demo_message_send(r.user_id, p_kind, p_reference, p_subject, p_body, p_sms);
  END LOOP;
END $$;

-- Everyone who holds the role over all records, except the person who took the step (p_exclude).
CREATE FUNCTION demo_message_role(p_role text, p_kind text, p_reference text, p_subject text, p_body text, p_sms text, p_exclude uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT a.user_id FROM role_assignment a WHERE a.role = p_role AND a.scope = 'all' AND a.active
              AND now() >= a.valid_from AND now() < a.valid_to AND a.user_id IS DISTINCT FROM p_exclude LOOP
    PERFORM demo_message_send(r.user_id, p_kind, p_reference, p_subject, p_body, p_sms);
  END LOOP;
END $$;

CREATE FUNCTION demo_message_on_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  p record;
  tail text;
BEGIN
  IF current_setting('bee.demo_seeding', true) = 'on' OR NEW.event NOT IN ('paid', 'failed') THEN
    RETURN NEW;
  END IF;
  SELECT pay.organisation_id, pay.amount_inr, pay.gateway_ref, pay.receipt_number, a.reference INTO p
    FROM payment pay LEFT JOIN model_application a ON a.id = pay.application_id WHERE pay.id = NEW.payment_id;
  IF p.organisation_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.event = 'paid' THEN
    tail := 'INR ' || p.amount_inr::text || ' for ' || COALESCE(p.reference, 'your application') || ' was received at the simulated gateway (' || p.gateway_ref || ', receipt ' || COALESCE(p.receipt_number, '-') || ').';
    PERFORM demo_message_org(p.organisation_id, 'payment_paid', p.reference, 'Payment received: ' || COALESCE(p.reference, ''),
      tail || ' BEE Finance confirms the fee when it is received. Simulated message: nothing was sent.', 'BEE demo: payment received for ' || COALESCE(p.reference, 'your application') || '. Finance will confirm it.');
    PERFORM demo_message_role('finance', 'payment_to_confirm', p.reference, 'Payment to confirm: ' || COALESCE(p.reference, ''),
      tail || ' Open the Finance queue and confirm the fee. Simulated message: nothing was sent.', NULL);
  ELSE
    PERFORM demo_message_org(p.organisation_id, 'payment_failed', p.reference, 'Payment failed: ' || COALESCE(p.reference, ''),
      'The simulated gateway declined the payment of INR ' || p.amount_inr::text || ' for ' || COALESCE(p.reference, 'your application') || ' (' || p.gateway_ref || '). You can try again. Simulated message: nothing was sent.',
      'BEE demo: payment declined for ' || COALESCE(p.reference, 'your application') || '. Please try again.');
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION demo_message_on_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  c record;
  k text;
  w text;
BEGIN
  IF current_setting('bee.demo_seeding', true) = 'on' THEN
    RETURN NEW;
  END IF;
  SELECT cert.registration_id, a.organisation_id INTO c
    FROM certificate cert JOIN model_application a ON a.id = cert.application_id WHERE cert.id = NEW.certificate_id;
  IF c.registration_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.action = 'submit' OR NEW.action = 'amend' OR NEW.action = 'revoke' THEN
    w := CASE NEW.action WHEN 'submit' THEN 'issue' WHEN 'amend' THEN 'amendment' ELSE 'revocation' END;
    PERFORM demo_message_role('secretary', 'ledger_to_sign', c.registration_id, 'Second signature needed: ' || c.registration_id,
      'The ' || w || ' of certificate ' || c.registration_id || ' is waiting on the simulated ledger. A different person from the one who sent it must commit it. Simulated message: nothing was sent.', NULL, NEW.actor_account_id);
    PERFORM demo_message_role('admin', 'ledger_to_sign', c.registration_id, 'Second signature needed: ' || c.registration_id,
      'The ' || w || ' of certificate ' || c.registration_id || ' is waiting on the simulated ledger. A different person from the one who sent it must commit it. Simulated message: nothing was sent.', NULL, NEW.actor_account_id);
  ELSIF NEW.action = 'commit' THEN
    SELECT kind INTO k FROM ledger_tx WHERE id = NEW.tx_id;
    PERFORM demo_message_org(c.organisation_id, 'ledger_committed', c.registration_id,
      CASE k WHEN 'revoke' THEN 'Certificate revoked: ' WHEN 'amend' THEN 'Certificate amended: ' ELSE 'Certificate on the ledger: ' END || c.registration_id,
      'Certificate ' || c.registration_id || CASE k WHEN 'revoke' THEN ' was revoked on the simulated Fabric ledger.' WHEN 'amend' THEN ' was amended on the simulated Fabric ledger.'
        ELSE ' is recorded on the simulated Fabric ledger.' END || ' Anyone can check it on the public verification page. Simulated message: nothing was sent.',
      'BEE demo: certificate ' || c.registration_id || CASE k WHEN 'revoke' THEN ' was revoked.' WHEN 'amend' THEN ' was amended.' ELSE ' is now on the ledger.' END);
  ELSIF NEW.action = 'fail' THEN
    PERFORM demo_message_role('admin', 'ledger_failed', c.registration_id, 'Ledger transaction failed: ' || c.registration_id,
      'The simulated ledger transaction for ' || c.registration_id || ' failed and can be retried. Simulated message: nothing was sent.', NULL);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION demo_message_on_production() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  s record;
  label text;
BEGIN
  IF current_setting('bee.demo_seeding', true) = 'on' OR NEW.action NOT IN ('submitted', 'review_accepted', 'review_query') THEN
    RETURN NEW;
  END IF;
  SELECT sub.organisation_id, sub.quarter, o.legal_name AS org_name INTO s
    FROM production_submission sub JOIN organisation o ON o.id = sub.organisation_id WHERE sub.id = NEW.submission_id;
  IF s.quarter IS NULL THEN
    RETURN NEW;
  END IF;
  label := s.org_name || ' ' || s.quarter;
  IF NEW.action = 'submitted' THEN
    PERFORM demo_message_role('programme', 'production_submitted', s.quarter, 'Production figures to review: ' || label,
      s.org_name || ' has sent its quarterly production figures for ' || s.quarter || '. Open Quarterly production to review them. Simulated message: nothing was sent.', NULL);
  ELSIF NEW.action = 'review_query' THEN
    PERFORM demo_message_org(s.organisation_id, 'production_query', s.quarter, 'Query on your production figures: ' || s.quarter,
      'The Programme officer has raised a query on your ' || s.quarter || ' figures: ' || COALESCE(NEW.note, '') || ' Edit and send them again. Simulated message: nothing was sent.',
      'BEE demo: a query was raised on your ' || s.quarter || ' production figures. Please check the portal.');
  ELSE
    PERFORM demo_message_org(s.organisation_id, 'production_accepted', s.quarter, 'Production figures accepted: ' || s.quarter,
      'Your ' || s.quarter || ' production figures were accepted. Simulated message: nothing was sent.', 'BEE demo: your ' || s.quarter || ' production figures were accepted.');
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION demo_message_send(uuid, text, text, text, text, text), demo_message_org(uuid, text, text, text, text, text),
  demo_message_role(text, text, text, text, text, text, uuid), demo_message_on_payment(), demo_message_on_ledger(), demo_message_on_production() FROM PUBLIC;

CREATE TRIGGER demo_message_after_payment AFTER INSERT ON payment_event FOR EACH ROW EXECUTE FUNCTION demo_message_on_payment();
CREATE TRIGGER demo_message_after_ledger AFTER INSERT ON ledger_event FOR EACH ROW EXECUTE FUNCTION demo_message_on_ledger();
CREATE TRIGGER demo_message_after_production AFTER INSERT ON production_event FOR EACH ROW EXECUTE FUNCTION demo_message_on_production();

-- The recipient marks one message read, or all of theirs. Another person's id changes nothing. Returns how many rows changed.
CREATE FUNCTION demo_message_mark_read(p_account uuid, p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  n integer;
BEGIN
  UPDATE demo_message SET read_at = now() WHERE id = p_id AND recipient_account_id = p_account AND read_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE FUNCTION demo_message_mark_all_read(p_account uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  n integer;
BEGIN
  UPDATE demo_message SET read_at = now() WHERE recipient_account_id = p_account AND read_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION demo_message_mark_read(uuid, uuid), demo_message_mark_all_read(uuid) FROM PUBLIC;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.demo_message TO bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I.demo_message FROM bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.demo_message_mark_read(uuid, uuid), %I.demo_message_mark_all_read(uuid) TO bee_runtime', home_schema, home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, UPDATE, DELETE ON %I.demo_message TO bee_local_maint', home_schema);
  END IF;
END $$;

COMMENT ON TABLE demo_message IS 'Simulated email and SMS outbox for the local demonstration. Nothing is sent anywhere.';
