-- DEMO corrective migration (V66 and V57 are applied and immutable): independent review findings BL-230 and BL-233.
--
-- 1. production_replace_rows: while a production submission has a query, the manufacturer may replace ALL its rows (BL-230). The runtime login
--    has no UPDATE or DELETE on production_row, so this definer function is the only way, and only for a submission in state 'query'.
-- 2. The simulated-message triggers: the seeding switch is honoured only for a login that is not the runtime login; programme officers (writers
--    of the simulated ledger) are told when a second signature is needed; a retry asks for one again; a failure also reaches whoever sent it;
--    the reviewer's note is trimmed inside the message; the made-up mobile number can no longer raise an integer overflow.
-- 3. Every SECURITY DEFINER function of the schema gets a fixed search_path that ends in pg_temp's place explicit, so a temporary table cannot
--    stand in for a real one.

CREATE FUNCTION demo_seeding_on() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('bee.demo_seeding', true) = 'on' AND session_user <> 'bee_runtime'
$$;

CREATE FUNCTION production_replace_rows(p_submission uuid, p_actor uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  st text;
  n integer;
BEGIN
  SELECT state INTO st FROM production_submission WHERE id = p_submission FOR UPDATE;
  IF st IS DISTINCT FROM 'query' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'the rows of a production submission can be replaced only while it has a query';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_account WHERE id = p_actor AND status = 'active') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'an active account is needed to replace rows';
  END IF;
  DELETE FROM production_row WHERE submission_id = p_submission;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION production_replace_rows(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION demo_message_send(p_account uuid, p_kind text, p_reference text, p_subject text, p_body text, p_sms text) RETURNS void
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
      VALUES (p_account, 'sms', '+91 9XXXXX' || lpad((abs(hashtext(uname)::bigint) % 10000)::text, 4, '0') || ' (synthetic)', p_kind, p_reference, left(p_sms, 160));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION demo_message_on_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  p record;
  tail text;
BEGIN
  IF demo_seeding_on() OR NEW.event NOT IN ('paid', 'failed') THEN
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

CREATE OR REPLACE FUNCTION demo_message_on_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  c record;
  k text;
  w text;
  sub uuid;
BEGIN
  IF demo_seeding_on() THEN
    RETURN NEW;
  END IF;
  SELECT cert.registration_id, a.organisation_id INTO c
    FROM certificate cert JOIN model_application a ON a.id = cert.application_id WHERE cert.id = NEW.certificate_id;
  IF c.registration_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.action IN ('submit', 'amend', 'revoke', 'retry') THEN
    w := CASE NEW.action WHEN 'submit' THEN 'issue' WHEN 'retry' THEN 'issue (tried again)' WHEN 'amend' THEN 'amendment' ELSE 'revocation' END;
    PERFORM demo_message_role('secretary', 'ledger_to_sign', c.registration_id, 'Second signature needed: ' || c.registration_id,
      'The ' || w || ' of certificate ' || c.registration_id || ' is waiting on the simulated ledger. A different person from the one who sent it must commit it. Simulated message: nothing was sent.', NULL, NEW.actor_account_id);
    PERFORM demo_message_role('admin', 'ledger_to_sign', c.registration_id, 'Second signature needed: ' || c.registration_id,
      'The ' || w || ' of certificate ' || c.registration_id || ' is waiting on the simulated ledger. A different person from the one who sent it must commit it. Simulated message: nothing was sent.', NULL, NEW.actor_account_id);
    PERFORM demo_message_role('programme', 'ledger_to_sign', c.registration_id, 'Second signature needed: ' || c.registration_id,
      'The ' || w || ' of certificate ' || c.registration_id || ' is waiting on the simulated ledger. A different person from the one who sent it must commit it. Simulated message: nothing was sent.', NULL, NEW.actor_account_id);
  ELSIF NEW.action = 'commit' THEN
    SELECT kind INTO k FROM ledger_tx WHERE id = NEW.tx_id;
    PERFORM demo_message_org(c.organisation_id, 'ledger_committed', c.registration_id,
      CASE k WHEN 'revoke' THEN 'Certificate revoked: ' WHEN 'amend' THEN 'Certificate amended: ' ELSE 'Certificate on the ledger: ' END || c.registration_id,
      'Certificate ' || c.registration_id || CASE k WHEN 'revoke' THEN ' was revoked on the simulated Fabric ledger.' WHEN 'amend' THEN ' was amended on the simulated Fabric ledger.'
        ELSE ' is recorded on the simulated Fabric ledger.' END || ' Anyone can check it on the public verification page. Simulated message: nothing was sent.',
      'BEE demo: certificate ' || c.registration_id || CASE k WHEN 'revoke' THEN ' was revoked.' WHEN 'amend' THEN ' was amended.' ELSE ' is now on the ledger.' END);
  ELSIF NEW.action = 'fail' THEN
    SELECT submitted_by INTO sub FROM ledger_tx WHERE id = NEW.tx_id;
    PERFORM demo_message_role('admin', 'ledger_failed', c.registration_id, 'Ledger transaction failed: ' || c.registration_id,
      'The simulated ledger transaction for ' || c.registration_id || ' failed and can be retried. Simulated message: nothing was sent.', NULL);
    PERFORM demo_message_role('secretary', 'ledger_failed', c.registration_id, 'Ledger transaction failed: ' || c.registration_id,
      'The simulated ledger transaction for ' || c.registration_id || ' failed and can be retried. Simulated message: nothing was sent.', NULL);
    -- the person who sent it is told too, whatever their role
    IF sub IS NOT NULL THEN
      PERFORM demo_message_send(sub, 'ledger_failed', c.registration_id, 'Ledger transaction failed: ' || c.registration_id,
        'The simulated ledger transaction you sent for ' || c.registration_id || ' failed and can be retried. Simulated message: nothing was sent.', NULL);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION demo_message_on_production() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  s record;
  label text;
BEGIN
  IF demo_seeding_on() OR NEW.action NOT IN ('submitted', 'review_accepted', 'review_query') THEN
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
      'The Programme officer has raised a query on your ' || s.quarter || ' figures: ' || left(COALESCE(NEW.note, ''), 800) || ' Edit and send them again. Simulated message: nothing was sent.',
      'BEE demo: a query was raised on your ' || s.quarter || ' production figures. Please check the portal.');
  ELSE
    PERFORM demo_message_org(s.organisation_id, 'production_accepted', s.quarter, 'Production figures accepted: ' || s.quarter,
      'Your ' || s.quarter || ' production figures were accepted. Simulated message: nothing was sent.', 'BEE demo: your ' || s.quarter || ' production figures were accepted.');
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  home_schema text := current_schema();
  f regprocedure;
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.production_replace_rows(uuid, uuid) TO bee_runtime', home_schema);
  END IF;
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = to_regnamespace(home_schema) AND p.prosecdef LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = %I, pg_temp', f, home_schema);
  END LOOP;
END $$;
