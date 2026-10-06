-- WP10.1a (owner's assumptions, 6 October 2026, not BEE's decision): in-portal notifications for the applicant. No email or SMS.
--
-- * Four events notify, and only these: the application is returned, rejected, has its fee due, or is approved (certificate issued).
--   Internal steps (IAME, reviewer, rating, director) do not: the applicant already sees them in the history.
-- * Everyone who belongs to the application's own organisation (an active member of an active organisation, with an active account)
--   gets one row, which is exactly who may read the application.
-- * The row is written by a trigger on the record each event already writes, in the same transaction: a step cannot succeed without its
--   notification, and nothing in the Java code can forget one. The text holds only what the applicant is already allowed to read.
-- * A notification never changes after it is written, except that its recipient marks it read (once). Only the two functions below do that.
-- * Applications that were returned, rejected, fee-due or approved before this migration get no notification (no backfill).

CREATE TABLE notification (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_account_id  uuid NOT NULL REFERENCES user_account (id),
  application_id        uuid NOT NULL REFERENCES model_application (id),
  kind                  text NOT NULL CHECK (kind IN ('returned', 'rejected', 'fee_due', 'approved')),
  message               text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 700),
  created_at            timestamptz NOT NULL DEFAULT now(),
  read_at               timestamptz
);
CREATE INDEX notification_recipient ON notification (recipient_account_id, created_at DESC);
CREATE INDEX notification_unread ON notification (recipient_account_id) WHERE read_at IS NULL;
CREATE INDEX notification_application ON notification (application_id);

-- Append-only, except that read_at may be set once and nothing else changes. The maintenance login (local cleanup) may delete.
CREATE FUNCTION notification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
     AND (NEW.id, NEW.recipient_account_id, NEW.application_id, NEW.kind, NEW.message, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.recipient_account_id, OLD.application_id, OLD.kind, OLD.message, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000',
    MESSAGE = format('%s records are append-only (%s refused for %s)', TG_TABLE_NAME, TG_OP, current_user);
END $$;

CREATE TRIGGER notification_row_change BEFORE UPDATE OR DELETE ON notification
  FOR EACH ROW EXECUTE FUNCTION notification_guard();
CREATE TRIGGER notification_truncate BEFORE TRUNCATE ON notification
  FOR EACH STATEMENT EXECUTE FUNCTION notification_guard();

-- Writes one row for each person of the application's organisation. Called only by the triggers below.
CREATE FUNCTION notify_application_organisation(p_application uuid, p_kind text, p_text text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO notification (recipient_account_id, application_id, kind, message)
  SELECT DISTINCT m.user_id, a.id, p_kind, a.reference || ' (' || a.brand_name || ' ' || a.model_number || ') ' || p_text
    FROM model_application a
    JOIN organisation_membership m ON m.organisation_id = a.organisation_id
    JOIN organisation o ON o.id = m.organisation_id
    JOIN user_account u ON u.id = m.user_id
   WHERE a.id = p_application AND m.active AND o.status = 'active' AND u.status = 'active'
     AND now() >= m.valid_from AND now() < m.valid_to;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION notify_application_organisation(uuid, text, text) FROM PUBLIC;

CREATE FUNCTION notify_on_return() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM notify_application_organisation(NEW.application_id, 'returned', 'was returned to you: ' || NEW.reason || ' Edit it and send it again.');
  RETURN NEW;
END $$;

CREATE FUNCTION notify_on_rejection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM notify_application_organisation(NEW.application_id, 'rejected', 'was rejected: ' || NEW.reason);
  RETURN NEW;
END $$;

CREATE FUNCTION notify_on_fee_due() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM notify_application_organisation(NEW.application_id, 'fee_due',
    'has its fee due: INR ' || COALESCE(NEW.total_inr, NEW.amount_inr)::text
    || CASE WHEN NEW.tax_inr IS NOT NULL AND NEW.tax_inr > 0 THEN ' (fee ' || NEW.amount_inr::text || ' plus tax ' || NEW.tax_inr::text || ')' ELSE '' END
    || '. Finance confirms it when it is received.');
  RETURN NEW;
END $$;

CREATE FUNCTION notify_on_certificate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM notify_application_organisation(NEW.application_id, 'approved',
    'was approved. Certificate ' || NEW.registration_id || ' is valid from ' || NEW.valid_from::text || ' to ' || NEW.valid_to::text
    || ' (local demonstration, not issued by BEE).');
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION notify_on_return(), notify_on_rejection(), notify_on_fee_due(), notify_on_certificate() FROM PUBLIC;

CREATE TRIGGER notify_after_return AFTER INSERT ON model_application_return
  FOR EACH ROW EXECUTE FUNCTION notify_on_return();
CREATE TRIGGER notify_after_rejection AFTER INSERT ON model_application_rejection
  FOR EACH ROW EXECUTE FUNCTION notify_on_rejection();
CREATE TRIGGER notify_after_fee_due AFTER INSERT ON model_application_fee_snapshot
  FOR EACH ROW EXECUTE FUNCTION notify_on_fee_due();
CREATE TRIGGER notify_after_certificate AFTER INSERT ON certificate
  FOR EACH ROW EXECUTE FUNCTION notify_on_certificate();

-- The recipient marks one notification read, or all of theirs. Another person's id changes nothing. Returns how many rows changed.
CREATE FUNCTION notification_mark_read(p_account uuid, p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  n integer;
BEGIN
  UPDATE notification SET read_at = now() WHERE id = p_id AND recipient_account_id = p_account AND read_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE FUNCTION notification_mark_all_read(p_account uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  n integer;
BEGIN
  UPDATE notification SET read_at = now() WHERE recipient_account_id = p_account AND read_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION notification_mark_read(uuid, uuid), notification_mark_all_read(uuid) FROM PUBLIC;

DROP FUNCTION IF EXISTS app_disposable_model_cleanup(uuid[]);

CREATE FUNCTION app_disposable_model_cleanup(app_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  home_schema text := coalesce(nullif(current_setting('bee.cleanup_schema', true), ''), current_schema());
  missing boolean;
BEGIN
  IF session_user <> 'bee_local_maint' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'cleanup refused: maintenance role required';
  END IF;
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM unnest($1::uuid[]) AS u(id) '
      || 'WHERE NOT EXISTS (SELECT 1 FROM %I.local_disposable_application d WHERE d.application_id = u.id))',
    home_schema)
  INTO missing USING app_ids;
  IF missing THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'cleanup refused: unregistered application id';
  END IF;
  EXECUTE format('DELETE FROM %I.notification WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_rejection WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_resubmission WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_return WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_secretary_approval WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_director_recommendation WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_rating WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_reviewer_forward WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_iame_recommendation WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.certificate WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.fee_correction_proposal WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_fee_confirmation WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application_transition_event WHERE application_id = ANY ($1)', home_schema) USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.assignment WHERE subject_type = ''model_application'' AND subject_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.model_application_document_version v USING %I.model_application_document d '
      || 'WHERE v.document_id = d.id AND d.application_id = ANY ($1)',
    home_schema, home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.model_application_document WHERE application_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.model_application_fee_snapshot WHERE application_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.model_application_submission_event WHERE application_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format(
    'DELETE FROM %I.local_disposable_application WHERE application_id = ANY ($1)', home_schema)
    USING app_ids;
  EXECUTE format('DELETE FROM %I.model_application WHERE id = ANY ($1)', home_schema) USING app_ids;
END $$;

REVOKE ALL ON FUNCTION app_disposable_model_cleanup(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_disposable_model_cleanup(uuid[]) FROM bee_app;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.app_disposable_model_cleanup(uuid[]) TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.notification TO bee_local_maint', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    -- The runtime login reads notifications and marks its own read only through the functions; it cannot write the table.
    EXECUTE format('GRANT SELECT ON %I.notification TO bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I.notification FROM bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.notification_mark_read(uuid, uuid), %I.notification_mark_all_read(uuid) TO bee_runtime', home_schema, home_schema);
  END IF;
END $$;
