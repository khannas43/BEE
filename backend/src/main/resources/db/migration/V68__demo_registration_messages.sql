-- DEMO: simulated email and SMS for the registration process (local demonstration, not a BEE system; nothing is ever sent anywhere).
-- Same design as V66: triggers on the audit records the registration steps already write, in the same transaction, so a step cannot succeed
-- without its message. A seed switches them off for its own session with: SET bee.demo_seeding = 'on'.
-- Covered: filing (applicant and Finance), fee confirmed (applicant and Programme), recommended (applicant and Director), returned, rejected,
-- approved, resubmitted (Programme), and the register's closure or revocation proposals (Director to decide; the proposer told of the outcome).

CREATE FUNCTION demo_message_on_registration_filed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  r record;
BEGIN
  IF current_setting('bee.demo_seeding', true) = 'on' OR NEW.to_state <> 'fee_due' THEN
    RETURN NEW;
  END IF;
  SELECT reg.reference, reg.brand_name, reg.kind, o.legal_name INTO r
    FROM registration_application reg JOIN organisation o ON o.id = reg.organisation_id WHERE reg.id = NEW.application_id;
  IF r.reference IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM demo_message_org(NEW.filing_organisation_id, 'registration_filed', r.reference, 'Registration filed: ' || r.reference,
    'Your ' || r.kind || ' registration request ' || r.reference || ' (' || r.brand_name || ') was filed. The registration fee is due; BEE Finance confirms it when it is received. Simulated message: nothing was sent.',
    'BEE demo: registration ' || r.reference || ' was filed. The fee is due.');
  PERFORM demo_message_role('finance', 'registration_fee_to_confirm', r.reference, 'Registration fee to confirm: ' || r.reference,
    r.legal_name || ' filed ' || r.kind || ' registration ' || r.reference || ' (' || r.brand_name || '). Confirm the fee when it is received. Simulated message: nothing was sent.', NULL);
  RETURN NEW;
END $$;

CREATE FUNCTION demo_message_on_registration_step() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  r record;
  note text;
BEGIN
  IF current_setting('bee.demo_seeding', true) = 'on' THEN
    RETURN NEW;
  END IF;
  SELECT reg.reference, reg.brand_name, reg.kind, reg.organisation_id, o.legal_name INTO r
    FROM registration_application reg JOIN organisation o ON o.id = reg.organisation_id WHERE reg.id = NEW.application_id;
  IF r.reference IS NULL THEN
    RETURN NEW;
  END IF;
  note := COALESCE(NEW.note, '');
  IF NEW.action = 'confirm_fee' THEN
    PERFORM demo_message_org(r.organisation_id, 'registration_fee_confirmed', r.reference, 'Registration fee confirmed: ' || r.reference,
      'BEE Finance confirmed the fee for ' || r.reference || ' (' || r.brand_name || '). The request is now with the Programme officer. Simulated message: nothing was sent.',
      'BEE demo: fee confirmed for registration ' || r.reference || '.');
    PERFORM demo_message_role('programme', 'registration_to_review', r.reference, 'Registration to review: ' || r.reference,
      r.legal_name || ' registration ' || r.reference || ' (' || r.brand_name || ') is ready for programme review. Open Registration reviews. Simulated message: nothing was sent.', NULL);
  ELSIF NEW.action = 'recommend' THEN
    PERFORM demo_message_org(r.organisation_id, 'registration_recommended', r.reference, 'Registration recommended: ' || r.reference,
      'The Programme officer recommended ' || r.reference || ' (' || r.brand_name || '). It now waits for the Director. Simulated message: nothing was sent.',
      'BEE demo: registration ' || r.reference || ' was recommended and waits for the Director.');
    PERFORM demo_message_role('director', 'registration_to_approve', r.reference, 'Registration to approve: ' || r.reference,
      r.legal_name || ' registration ' || r.reference || ' (' || r.brand_name || ') is recommended and waits for your decision. Open Registration reviews. Simulated message: nothing was sent.', NULL);
  ELSIF NEW.action = 'return' THEN
    PERFORM demo_message_org(r.organisation_id, 'registration_returned', r.reference, 'Registration returned to you: ' || r.reference,
      r.reference || ' (' || r.brand_name || ') was returned for changes: ' || note || ' Edit it and send it again. Simulated message: nothing was sent.',
      'BEE demo: registration ' || r.reference || ' was returned for changes.');
  ELSIF NEW.action = 'reject' THEN
    PERFORM demo_message_org(r.organisation_id, 'registration_rejected', r.reference, 'Registration rejected: ' || r.reference,
      r.reference || ' (' || r.brand_name || ') was rejected: ' || note || ' Simulated message: nothing was sent.',
      'BEE demo: registration ' || r.reference || ' was rejected.');
  ELSIF NEW.action = 'approve' THEN
    PERFORM demo_message_org(r.organisation_id, 'registration_approved', r.reference, 'Registration approved: ' || r.reference,
      r.reference || ' (' || r.brand_name || ') was approved by the Director and is now on the register. Simulated message: nothing was sent.',
      'BEE demo: registration ' || r.reference || ' was approved. You are on the register.');
  ELSIF NEW.action = 'resubmit' THEN
    PERFORM demo_message_role('programme', 'registration_resubmitted', r.reference, 'Registration sent again: ' || r.reference,
      r.legal_name || ' sent ' || r.reference || ' (' || r.brand_name || ') again after a return. Open Registration reviews. Simulated message: nothing was sent.', NULL);
  END IF;
  RETURN NEW;
END $$;

-- A closure or revocation proposal on the register: the Director is asked to decide; the proposer (and the owner, when approved) are told of the outcome.
CREATE FUNCTION demo_message_on_register_proposal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  label text;
  owner_org uuid;
  what text;
BEGIN
  IF current_setting('bee.demo_seeding', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.target_brand_id IS NOT NULL THEN
    SELECT b.name, b.owner_organisation_id INTO label, owner_org FROM brand b WHERE b.id = NEW.target_brand_id;
  ELSE
    SELECT b.name || ' (agency authorisation)', a.principal_organisation_id INTO label, owner_org
      FROM agency_authorisation a JOIN brand b ON b.id = a.brand_id WHERE a.id = NEW.target_authorisation_id;
  END IF;
  what := CASE NEW.action WHEN 'close' THEN 'closure' ELSE 'revocation' END;
  IF TG_OP = 'INSERT' THEN
    PERFORM demo_message_role('director', 'register_to_decide', label, 'Register ' || what || ' to decide: ' || COALESCE(label, ''),
      'A ' || what || ' of ' || COALESCE(label, 'a register entry') || ' was proposed: ' || NEW.reason || ' Open Register and approve or reject it. A different person from the proposer decides. Simulated message: nothing was sent.', NULL, NEW.proposed_by);
  ELSIF OLD.state = 'pending' AND NEW.state <> 'pending' THEN
    PERFORM demo_message_send(NEW.proposed_by, 'register_decided', label, 'Register ' || what || ' ' || NEW.state || ': ' || COALESCE(label, ''),
      'Your proposed ' || what || ' of ' || COALESCE(label, 'a register entry') || ' was ' || NEW.state || '.' || COALESCE(' Note: ' || NEW.decision_note, '') || ' Simulated message: nothing was sent.',
      'BEE demo: your proposed ' || what || ' of ' || COALESCE(label, 'a register entry') || ' was ' || NEW.state || '.');
    IF NEW.state = 'approved' AND owner_org IS NOT NULL THEN
      PERFORM demo_message_org(owner_org, 'register_entry_closed', label, 'Register entry ' || CASE NEW.action WHEN 'close' THEN 'closed: ' ELSE 'revoked: ' END || COALESCE(label, ''),
        COALESCE(label, 'A register entry') || ' was ' || CASE NEW.action WHEN 'close' THEN 'closed' ELSE 'revoked' END || ' on the BEE register: ' || NEW.reason || ' Simulated message: nothing was sent.',
        'BEE demo: ' || COALESCE(label, 'a register entry') || ' was ' || CASE NEW.action WHEN 'close' THEN 'closed' ELSE 'revoked' END || ' on the register.');
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION demo_message_on_registration_filed(), demo_message_on_registration_step(), demo_message_on_register_proposal() FROM PUBLIC;

CREATE TRIGGER demo_message_after_registration_filed AFTER INSERT ON registration_submission_event FOR EACH ROW EXECUTE FUNCTION demo_message_on_registration_filed();
CREATE TRIGGER demo_message_after_registration_step AFTER INSERT ON registration_transition_event FOR EACH ROW EXECUTE FUNCTION demo_message_on_registration_step();
CREATE TRIGGER demo_message_after_register_proposal AFTER INSERT OR UPDATE OF state ON register_revocation_proposal FOR EACH ROW EXECUTE FUNCTION demo_message_on_register_proposal();

-- Like V67: the three definer functions get a fixed search_path that ends in pg_temp's place, so a temporary table cannot shadow a real one.
DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER FUNCTION demo_message_on_registration_filed() SET search_path = %I, pg_temp', home_schema);
  EXECUTE format('ALTER FUNCTION demo_message_on_registration_step() SET search_path = %I, pg_temp', home_schema);
  EXECUTE format('ALTER FUNCTION demo_message_on_register_proposal() SET search_path = %I, pg_temp', home_schema);
END $$;
