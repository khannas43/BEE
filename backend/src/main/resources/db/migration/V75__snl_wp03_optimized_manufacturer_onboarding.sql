-- SNL WP03 optimized manufacturer onboarding (local demonstration). Provisional local rules, not BEE rules.
-- Trusted SECURITY DEFINER orchestrators; bee_runtime may EXECUTE orchestrators only on evidence tables.
INSERT INTO fee_application_type (code, label) VALUES ('manufacturer_onboarding', 'Manufacturer entity onboarding')
  ON CONFLICT DO NOTHING;

INSERT INTO master_fee_rule (rule_key, version, effective_from, effective_to, source_reference, verification_status, note, legacy_id,
                             category_code, application_type, amount_inr, tax_rate_percent)
SELECT 'REG:manufacturer_onboarding', 1, DATE '2026-01-01', NULL,
   'Owner default WP3 optimized onboarding (local placeholder, not a BEE rule)', 'synthetic',
   'Provisional company registration fee for manufacturer onboarding; Assumption A07 (₹5,000).', NULL,
   'REG', 'manufacturer_onboarding', 5000.00, 0
WHERE NOT EXISTS (SELECT 1 FROM master_fee_rule WHERE rule_key = 'REG:manufacturer_onboarding' AND version = 1);

ALTER TABLE organisation
  ADD COLUMN IF NOT EXISTS permittee_lifecycle text NOT NULL DEFAULT 'none'
    CHECK (permittee_lifecycle IN ('none', 'pending', 'active', 'on_hold', 'revoked'));

UPDATE organisation SET permittee_lifecycle = 'active' WHERE code = 'NOVA' AND permittee_lifecycle = 'none';

CREATE TABLE manufacturer_onboarding_allocator (
  scope      text PRIMARY KEY,
  next_value integer NOT NULL CHECK (next_value >= 0)
);
INSERT INTO manufacturer_onboarding_allocator (scope, next_value) VALUES ('reference', 0), ('permittee_number', 0);

CREATE TABLE manufacturer_onboarding_application (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference           text NOT NULL UNIQUE,
  organisation_id     uuid NOT NULL REFERENCES organisation (id),
  legal_name          text NOT NULL CHECK (char_length(btrim(legal_name)) BETWEEN 1 AND 200),
  state               text NOT NULL DEFAULT 'draft' CHECK (state IN (
    'draft', 'submitted', 'automatic_checks_failed', 'director_review', 'active_observation', 'active', 'on_hold', 'rejected', 'revoked')),
  version             integer NOT NULL DEFAULT 0,
  permittee_number    text UNIQUE,
  observation_ends_on date,
  draft_payload       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(draft_payload) <= 98304),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (permittee_number IS NULL OR state IN ('active_observation', 'active', 'on_hold', 'revoked'))
);
CREATE UNIQUE INDEX manufacturer_onboarding_one_live_per_org
  ON manufacturer_onboarding_application (organisation_id)
  WHERE state NOT IN ('rejected', 'revoked');

CREATE TABLE manufacturer_onboarding_event (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid NOT NULL REFERENCES manufacturer_onboarding_application (id),
  event_kind       text NOT NULL CHECK (char_length(event_kind) BETWEEN 1 AND 60),
  from_state       text,
  to_state         text,
  actor_account_id uuid NOT NULL REFERENCES user_account (id),
  actor_role       text NOT NULL,
  detail           text,
  occurred_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX manufacturer_onboarding_event_app ON manufacturer_onboarding_event (application_id, occurred_at);

CREATE TABLE manufacturer_onboarding_fee_snapshot (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id      uuid NOT NULL REFERENCES manufacturer_onboarding_application (id),
  amount_inr          numeric(14, 2) NOT NULL,
  tax_rate_percent    numeric(5, 2) NOT NULL DEFAULT 0 CHECK (tax_rate_percent BETWEEN 0 AND 100),
  tax_inr             numeric(14, 2) GENERATED ALWAYS AS (round(amount_inr * tax_rate_percent / 100, 2)) STORED,
  total_inr           numeric(14, 2) GENERATED ALWAYS AS (amount_inr + round(amount_inr * tax_rate_percent / 100, 2)) STORED,
  currency            text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  fee_rule_key        text NOT NULL,
  fee_rule_version    integer NOT NULL,
  verification_status text NOT NULL CHECK (verification_status IN ('synthetic', 'provisional', 'verified')),
  source_reference    text,
  note                text,
  captured_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturer_onboarding_fee_snapshot_one UNIQUE (application_id)
);

CREATE TABLE manufacturer_onboarding_payment_link (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES manufacturer_onboarding_application (id),
  payment_id     uuid NOT NULL UNIQUE REFERENCES payment (id),
  linked_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE manufacturer_onboarding_automated_check (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES manufacturer_onboarding_application (id),
  check_code     text NOT NULL,
  outcome        text NOT NULL CHECK (outcome IN ('pass', 'fail')),
  detail         text,
  checked_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX manufacturer_onboarding_automated_check_app ON manufacturer_onboarding_automated_check (application_id, checked_at);

CREATE TABLE manufacturer_onboarding_document (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES manufacturer_onboarding_application (id),
  document_kind  text NOT NULL CHECK (document_kind IN (
    'trade_licence', 'certificate_of_incorporation', 'gst_certificate', 'pan_card', 'signatory_photo_id',
    'facility_address_proof', 'signed_declaration', 'signed_agreement', 'annexure_supporting')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, document_kind)
);

CREATE TABLE manufacturer_onboarding_document_version (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           uuid NOT NULL REFERENCES manufacturer_onboarding_document (id),
  version_number        integer NOT NULL CHECK (version_number >= 1),
  content_sha256        char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes            bigint NOT NULL CHECK (size_bytes > 0),
  media_type            text NOT NULL DEFAULT 'application/pdf',
  original_filename     text NOT NULL,
  label                 text NOT NULL,
  uploaded_by_account_id uuid NOT NULL REFERENCES user_account (id),
  uploaded_at           timestamptz NOT NULL DEFAULT now(),
  issue_on              date,
  expires_on            date,
  UNIQUE (document_id, version_number)
);

CREATE TABLE manufacturer_onboarding_director_decision (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid NOT NULL REFERENCES manufacturer_onboarding_application (id),
  decision         text NOT NULL CHECK (decision IN ('approve', 'reject')),
  note             text CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 500),
  actor_account_id uuid NOT NULL REFERENCES user_account (id),
  decided_at       timestamptz NOT NULL DEFAULT now(),
  transition_event_id uuid NOT NULL UNIQUE
);

CREATE TABLE manufacturer_onboarding_permittee_activation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid NOT NULL UNIQUE REFERENCES manufacturer_onboarding_application (id),
  organisation_id  uuid NOT NULL REFERENCES organisation (id),
  permittee_number text NOT NULL UNIQUE,
  activated_at     timestamptz NOT NULL DEFAULT now(),
  transition_event_id uuid NOT NULL UNIQUE
);

CREATE TABLE manufacturer_onboarding_observation (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id      uuid NOT NULL UNIQUE REFERENCES manufacturer_onboarding_application (id),
  started_on          date NOT NULL,
  ends_on             date NOT NULL CHECK (ends_on > started_on),
  closed_at           timestamptz,
  transition_event_id uuid UNIQUE,
  CHECK ((closed_at IS NULL) = (transition_event_id IS NULL))
);

CREATE TABLE manufacturer_onboarding_anomaly (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid NOT NULL REFERENCES manufacturer_onboarding_application (id),
  raised_by_role   text NOT NULL CHECK (raised_by_role IN ('finance', 'programme', 'director')),
  reason           text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  raised_by_account_id uuid NOT NULL REFERENCES user_account (id),
  raised_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolution       text CHECK (resolution IS NULL OR resolution IN ('cleared', 'revoked')),
  resolved_by_account_id uuid REFERENCES user_account (id),
  resolution_note  text CHECK (resolution_note IS NULL OR char_length(btrim(resolution_note)) BETWEEN 1 AND 500),
  transition_event_id uuid UNIQUE
);
CREATE INDEX manufacturer_onboarding_anomaly_open ON manufacturer_onboarding_anomaly (application_id) WHERE resolved_at IS NULL;

CREATE TABLE manufacturer_onboarding_command_evidence (
  command_id     uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES manufacturer_onboarding_application (id),
  purpose        text NOT NULL CHECK (purpose IN (
    'submit', 'director_decision', 'raise_anomaly', 'resolve_anomaly', 'revoke', 'observation_close')),
  payload_hash   char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  completed_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO capability_grant (capability, role) VALUES
  ('manufacturer_onboarding_director', 'director'),
  ('manufacturer_onboarding_anomaly', 'finance'),
  ('manufacturer_onboarding_anomaly', 'programme'),
  ('manufacturer_onboarding_anomaly', 'director')
ON CONFLICT DO NOTHING;

CREATE FUNCTION manufacturer_onboarding_next_reference(p_year integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  UPDATE manufacturer_onboarding_allocator SET next_value = next_value + 1 WHERE scope = 'reference' RETURNING next_value INTO v;
  IF NOT FOUND THEN
    INSERT INTO manufacturer_onboarding_allocator (scope, next_value) VALUES ('reference', 1) RETURNING next_value INTO v;
  END IF;
  RETURN format('MOB/%s/%s', p_year, lpad(v::text, 5, '0'));
END $$;

CREATE FUNCTION manufacturer_onboarding_next_permittee(p_year integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  UPDATE manufacturer_onboarding_allocator SET next_value = next_value + 1 WHERE scope = 'permittee_number' RETURNING next_value INTO v;
  IF NOT FOUND THEN
    INSERT INTO manufacturer_onboarding_allocator (scope, next_value) VALUES ('permittee_number', 1) RETURNING next_value INTO v;
  END IF;
  RETURN format('PT-%s-%s', p_year, lpad(v::text, 5, '0'));
END $$;

CREATE FUNCTION manufacturer_onboarding_sim_receipt_number() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v integer; d date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  INSERT INTO payment_receipt_counter (receipt_day, last_value) VALUES (d, 1)
    ON CONFLICT (receipt_day) DO UPDATE SET last_value = payment_receipt_counter.last_value + 1 RETURNING last_value INTO v;
  RETURN format('SIMRCPT-%s-%s', to_char(d, 'YYYYMMDD'), lpad(v::text, 4, '0'));
END $$;

CREATE FUNCTION manufacturer_onboarding_event_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'bee_local_maint' OR session_user = 'bee_local_maint' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = format('%s is append-only', TG_TABLE_NAME);
END $$;

CREATE TRIGGER manufacturer_onboarding_event_append_only BEFORE UPDATE OR DELETE ON manufacturer_onboarding_event
  FOR EACH ROW EXECUTE FUNCTION manufacturer_onboarding_event_append_only_guard();

CREATE FUNCTION manufacturer_onboarding_command_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'manufacturer_onboarding_command_evidence_immutable'; END IF;
  IF TG_OP = 'DELETE' AND session_user <> 'bee_local_maint' AND current_user <> 'bee_local_maint' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'manufacturer_onboarding_command_evidence_delete_refused';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER manufacturer_onboarding_command_evidence_immutable BEFORE UPDATE OR DELETE ON manufacturer_onboarding_command_evidence
  FOR EACH ROW EXECUTE FUNCTION manufacturer_onboarding_command_evidence_guard();

CREATE FUNCTION manufacturer_onboarding_application_runtime_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'bee_runtime' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'manufacturer_onboarding_application_delete_refused';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'manufacturer_onboarding_application_insert_via_trusted';
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'manufacturer_onboarding_application_update_via_trusted';
END $$;

CREATE TRIGGER manufacturer_onboarding_application_runtime_guard BEFORE INSERT OR UPDATE OR DELETE
  ON manufacturer_onboarding_application FOR EACH ROW EXECUTE FUNCTION manufacturer_onboarding_application_runtime_guard();

CREATE FUNCTION manufacturer_onboarding_event_runtime_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'bee_runtime' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'manufacturer_onboarding_event_insert_via_orchestrator';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION manufacturer_onboarding_document_runtime_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'bee_runtime' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'manufacturer_onboarding_document_insert_via_trusted';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER manufacturer_onboarding_document_runtime_guard BEFORE INSERT ON manufacturer_onboarding_document
  FOR EACH ROW EXECUTE FUNCTION manufacturer_onboarding_document_runtime_guard();

CREATE FUNCTION manufacturer_onboarding_document_version_runtime_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'bee_runtime' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'manufacturer_onboarding_document_version_insert_via_trusted';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER manufacturer_onboarding_document_version_runtime_guard BEFORE INSERT ON manufacturer_onboarding_document_version
  FOR EACH ROW EXECUTE FUNCTION manufacturer_onboarding_document_version_runtime_guard();

CREATE TRIGGER manufacturer_onboarding_event_runtime_guard BEFORE INSERT ON manufacturer_onboarding_event
  FOR EACH ROW EXECUTE FUNCTION manufacturer_onboarding_event_runtime_guard();

CREATE OR REPLACE FUNCTION model_application_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plc text;
BEGIN
  IF current_user <> 'bee_runtime' THEN
    RETURN NEW;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND OLD.state = 'draft' AND NEW.state = 'fee_due' THEN
    SELECT permittee_lifecycle INTO plc FROM organisation WHERE id = NEW.organisation_id;
    IF plc IN ('on_hold', 'revoked') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'model application submit blocked while permittee lifecycle is ' || plc;
    END IF;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'draft'              AND NEW.state = 'fee_due')
    OR (OLD.state = 'fee_due'            AND NEW.state = 'iame_scrutiny')
    OR (OLD.state = 'iame_scrutiny'      AND NEW.state IN ('bee_scrutiny', 'returned', 'rejected'))
    OR (OLD.state = 'bee_scrutiny'       AND NEW.state IN ('rating', 'returned', 'rejected'))
    OR (OLD.state = 'rating'             AND NEW.state IN ('director_review', 'rejected'))
    OR (OLD.state = 'director_review'    AND NEW.state IN ('secretary_approval', 'approved', 'returned', 'rejected'))
    OR (OLD.state = 'secretary_approval' AND NEW.state IN ('approved', 'returned', 'rejected'))
    OR (OLD.state = 'returned'           AND NEW.state IN ('iame_scrutiny', 'bee_scrutiny', 'rating', 'director_review', 'secretary_approval'))) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format('a model application cannot move from %s to %s', OLD.state, NEW.state);
  END IF;
  IF OLD.state <> 'draft' AND (NEW.reference IS DISTINCT FROM OLD.reference OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
       OR NEW.principal_organisation_id IS DISTINCT FROM OLD.principal_organisation_id OR NEW.brand_id IS DISTINCT FROM OLD.brand_id
       OR NEW.brand_name IS DISTINCT FROM OLD.brand_name OR NEW.category IS DISTINCT FROM OLD.category OR NEW.model_number IS DISTINCT FROM OLD.model_number) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'who, which brand and which model an application is for cannot change once it is submitted';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION manufacturer_onboarding_assert_applicant_writer(p_actor uuid, p_organisation uuid, p_application uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE plc text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_account u WHERE u.id = p_actor AND u.status = 'active') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'no_active_account';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM role_assignment ra WHERE ra.user_id = p_actor AND ra.active AND ra.role = 'manufacturer' AND ra.scope = 'own-org') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'no_write_scope';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organisation_membership m JOIN organisation o ON o.id = m.organisation_id
                  WHERE m.user_id = p_actor AND m.organisation_id = p_organisation AND m.active AND o.status = 'active'
                    AND now() >= m.valid_from AND now() < m.valid_to) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'not_found';
  END IF;
  IF p_application IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM manufacturer_onboarding_application a WHERE a.id = p_application AND a.organisation_id = p_organisation) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'not_found';
  END IF;
  SELECT permittee_lifecycle INTO plc FROM organisation WHERE id = p_organisation;
  IF plc <> 'none' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'organisation_not_eligible';
  END IF;
END $$;

CREATE FUNCTION manufacturer_onboarding_merge_draft_payload(p_existing jsonb, p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path FROM CURRENT AS $$
DECLARE allowed text[] := ARRAY['cin', 'gstin', 'declarationAccepted', 'agreementAccepted', 'registeredAddress', 'authorisedSignatory', 'facilities', 'contacts', 'annexureNotes'];
  k text;
  out jsonb := coalesce(p_existing, '{}'::jsonb);
BEGIN
  IF p_patch IS NULL THEN RETURN out; END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'validation_failed';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (k = ANY (allowed)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'validation_failed';
    END IF;
    out := out || jsonb_build_object(k, p_patch -> k);
  END LOOP;
  RETURN out;
END $$;

CREATE FUNCTION manufacturer_onboarding_trusted_create(
  p_actor uuid, p_organisation uuid, p_legal_name text, p_year integer, p_draft jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE id uuid := gen_random_uuid(); ref text; merged jsonb;
BEGIN
  PERFORM manufacturer_onboarding_assert_applicant_writer(p_actor, p_organisation);
  IF char_length(btrim(p_legal_name)) < 1 OR char_length(btrim(p_legal_name)) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'validation_failed';
  END IF;
  IF EXISTS (SELECT 1 FROM manufacturer_onboarding_application o WHERE o.organisation_id = p_organisation AND o.state NOT IN ('rejected', 'revoked')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'validation_failed';
  END IF;
  merged := manufacturer_onboarding_merge_draft_payload('{}'::jsonb, coalesce(p_draft, '{}'::jsonb));
  ref := manufacturer_onboarding_next_reference(p_year);
  INSERT INTO manufacturer_onboarding_application (id, reference, organisation_id, legal_name, draft_payload)
  VALUES (id, ref, p_organisation, btrim(p_legal_name), merged);
  RETURN id;
END $$;

CREATE FUNCTION manufacturer_onboarding_trusted_patch_draft(
  p_actor uuid, p_application uuid, p_organisation uuid, p_version integer,
  p_legal_name text, p_draft jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE a manufacturer_onboarding_application%ROWTYPE; merged jsonb; v_after integer;
BEGIN
  PERFORM manufacturer_onboarding_assert_applicant_writer(p_actor, p_organisation, p_application);
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state NOT IN ('draft', 'automatic_checks_failed') OR a.version <> p_version THEN
    RETURN NULL;
  END IF;
  merged := manufacturer_onboarding_merge_draft_payload(a.draft_payload, p_draft);
  v_after := a.version + 1;
  UPDATE manufacturer_onboarding_application
     SET legal_name = coalesce(nullif(btrim(p_legal_name), ''), legal_name),
         draft_payload = CASE WHEN p_draft IS NULL THEN draft_payload ELSE merged END,
         version = v_after
   WHERE id = p_application;
  RETURN v_after;
END $$;

CREATE FUNCTION manufacturer_onboarding_trusted_append_document(
  p_actor uuid, p_application uuid, p_organisation uuid, p_document_kind text,
  p_content_sha256 char(64), p_size_bytes bigint, p_original_filename text, p_label text,
  p_issue_on date, p_expires_on date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE a manufacturer_onboarding_application%ROWTYPE; doc_id uuid; next_ver integer;
  kinds text[] := ARRAY['trade_licence', 'certificate_of_incorporation', 'gst_certificate', 'pan_card', 'signatory_photo_id',
    'facility_address_proof', 'signed_declaration', 'signed_agreement', 'annexure_supporting'];
BEGIN
  PERFORM manufacturer_onboarding_assert_applicant_writer(p_actor, p_organisation, p_application);
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state NOT IN ('draft', 'automatic_checks_failed') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'not_editable';
  END IF;
  IF NOT (p_document_kind = ANY (kinds)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'validation_failed';
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_content_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'validation_failed';
  END IF;
  IF p_expires_on IS NOT NULL AND p_issue_on IS NOT NULL AND p_expires_on <= p_issue_on THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'validation_failed';
  END IF;
  SELECT id INTO doc_id FROM manufacturer_onboarding_document WHERE application_id = p_application AND document_kind = p_document_kind FOR UPDATE;
  IF NOT FOUND THEN
    doc_id := gen_random_uuid();
    INSERT INTO manufacturer_onboarding_document (id, application_id, document_kind) VALUES (doc_id, p_application, p_document_kind);
  END IF;
  SELECT coalesce(max(version_number), 0) + 1 INTO next_ver FROM manufacturer_onboarding_document_version WHERE document_id = doc_id;
  INSERT INTO manufacturer_onboarding_document_version (id, document_id, version_number, content_sha256, size_bytes, media_type, original_filename, label, uploaded_by_account_id, issue_on, expires_on)
  VALUES (gen_random_uuid(), doc_id, next_ver, p_content_sha256, p_size_bytes, 'application/pdf', p_original_filename, p_label, p_actor, p_issue_on, p_expires_on);
  RETURN next_ver;
END $$;

CREATE FUNCTION manufacturer_onboarding_run_automated_checks(p_application uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  a manufacturer_onboarding_application%ROWTYPE;
  d jsonb;
  ok boolean := true;
  has_doc boolean;
  today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  req text[] := ARRAY[
    'trade_licence', 'certificate_of_incorporation', 'gst_certificate', 'pan_card', 'signatory_photo_id',
    'facility_address_proof', 'signed_declaration', 'signed_agreement'];
  kind text;
  exp date;
  plc text;
BEGIN
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application;
  d := coalesce(a.draft_payload, '{}'::jsonb);
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'legal_name_present', CASE WHEN char_length(btrim(a.legal_name)) > 0 THEN 'pass' ELSE 'fail' END,
    CASE WHEN char_length(btrim(a.legal_name)) > 0 THEN NULL ELSE 'Legal name required' END);
  ok := ok AND char_length(btrim(a.legal_name)) > 0;
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'declaration_accepted', CASE WHEN coalesce((d->>'declarationAccepted')::boolean, false) THEN 'pass' ELSE 'fail' END,
    CASE WHEN coalesce((d->>'declarationAccepted')::boolean, false) THEN NULL ELSE 'Declaration must be accepted' END);
  ok := ok AND coalesce((d->>'declarationAccepted')::boolean, false);
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'agreement_accepted', CASE WHEN coalesce((d->>'agreementAccepted')::boolean, false) THEN 'pass' ELSE 'fail' END,
    CASE WHEN coalesce((d->>'agreementAccepted')::boolean, false) THEN NULL ELSE 'Agreement must be accepted' END);
  ok := ok AND coalesce((d->>'agreementAccepted')::boolean, false);
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'cin_format', CASE WHEN (d->>'cin') ~ '^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[A-Za-z]{3}[0-9]{6}$' THEN 'pass' ELSE 'fail' END,
    CASE WHEN (d->>'cin') ~ '^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[A-Za-z]{3}[0-9]{6}$' THEN NULL ELSE 'CIN format invalid' END);
  ok := ok AND (d->>'cin') ~ '^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[A-Za-z]{3}[0-9]{6}$';
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'gstin_format', CASE WHEN (d->>'gstin') ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' THEN 'pass' ELSE 'fail' END,
    CASE WHEN (d->>'gstin') ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' THEN NULL ELSE 'GSTIN format invalid' END);
  ok := ok AND (d->>'gstin') ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'registered_address_complete',
    CASE WHEN d->'registeredAddress' ?& ARRAY['line1','city','state','pincode'] THEN 'pass' ELSE 'fail' END,
    CASE WHEN d->'registeredAddress' ?& ARRAY['line1','city','state','pincode'] THEN NULL ELSE 'Registered address incomplete' END);
  ok := ok AND (d->'registeredAddress' ?& ARRAY['line1','city','state','pincode']);
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'authorised_signatory_present',
    CASE WHEN d->'authorisedSignatory' ?& ARRAY['name','designation'] THEN 'pass' ELSE 'fail' END,
    CASE WHEN d->'authorisedSignatory' ?& ARRAY['name','designation'] THEN NULL ELSE 'Authorised signatory incomplete' END);
  ok := ok AND (d->'authorisedSignatory' ?& ARRAY['name','designation']);
  SELECT permittee_lifecycle INTO plc FROM organisation WHERE id = a.organisation_id;
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'eligible_applicant_organisation',
    CASE WHEN plc = 'none' THEN 'pass' ELSE 'fail' END,
    CASE WHEN plc = 'none' THEN NULL ELSE format('Organisation lifecycle %s blocks onboarding', plc) END);
  ok := ok AND plc = 'none';
  IF d->>'cin' IS NOT NULL AND EXISTS (
    SELECT 1 FROM manufacturer_onboarding_application o2
     WHERE o2.id <> p_application AND o2.state NOT IN ('rejected', 'revoked')
       AND btrim(coalesce(o2.draft_payload->>'cin', '')) = btrim(d->>'cin')) THEN
    INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
    VALUES (p_application, 'cin_duplicate', 'fail', 'CIN already used on another live application');
    ok := false;
  END IF;
  IF d->>'gstin' IS NOT NULL AND EXISTS (
    SELECT 1 FROM manufacturer_onboarding_application o2
     WHERE o2.id <> p_application AND o2.state NOT IN ('rejected', 'revoked')
       AND btrim(coalesce(o2.draft_payload->>'gstin', '')) = btrim(d->>'gstin')) THEN
    INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
    VALUES (p_application, 'gstin_duplicate', 'fail', 'GSTIN already used on another live application');
    ok := false;
  END IF;
  FOREACH kind IN ARRAY req LOOP
    SELECT EXISTS (SELECT 1 FROM manufacturer_onboarding_document doc
      JOIN manufacturer_onboarding_document_version v ON v.document_id = doc.id
      WHERE doc.application_id = p_application AND doc.document_kind = kind) INTO has_doc;
    INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
    VALUES (p_application, 'document_' || kind,
      CASE WHEN has_doc THEN 'pass' ELSE 'fail' END,
      CASE WHEN has_doc THEN NULL ELSE format('Required document missing: %s', kind) END);
    ok := ok AND has_doc;
    IF has_doc THEN
      SELECT v.expires_on INTO exp FROM manufacturer_onboarding_document doc
        JOIN manufacturer_onboarding_document_version v ON v.document_id = doc.id
        WHERE doc.application_id = p_application AND doc.document_kind = kind
        ORDER BY v.version_number DESC LIMIT 1;
      IF exp IS NOT NULL AND exp < today THEN
        INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
        VALUES (p_application, 'document_' || kind || '_expired', 'fail', format('Document expired on %s', exp));
        ok := false;
      END IF;
    END IF;
  END LOOP;
  RETURN ok;
END $$;

CREATE FUNCTION manufacturer_onboarding_orchestrate_submit(
  p_application uuid, p_actor uuid, p_role text, p_version integer,
  p_amount_inr numeric, p_fee_rule_key text, p_fee_rule_version integer,
  p_verification_status text, p_source_reference text, p_note text,
  p_command_id uuid, p_payload_hash char(64))
RETURNS TABLE (out_state text, out_version integer, out_payment_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  a manufacturer_onboarding_application%ROWTYPE;
  plc text;
  pay_id uuid := gen_random_uuid();
  gw text := 'SIMGW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  sha text := md5(p_application::text || p_command_id::text) || md5('sim|' || p_application::text || p_command_id::text);
  receipt text;
  v_after integer;
  checks_ok boolean;
  to_state text;
  notify_id uuid := gen_random_uuid();
  notify_hash char(64) := md5(p_command_id::text || 'mob-notify-submit') || md5('mob-notify-submit|' || p_command_id::text);
BEGIN
  IF EXISTS (SELECT 1 FROM manufacturer_onboarding_command_evidence WHERE command_id = p_command_id) THEN
    SELECT a.state, a.version INTO out_state, out_version FROM manufacturer_onboarding_application a WHERE a.id = p_application;
    SELECT l.payment_id INTO out_payment_id FROM manufacturer_onboarding_payment_link l WHERE l.application_id = p_application;
    RETURN NEXT; RETURN;
  END IF;
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state NOT IN ('draft', 'automatic_checks_failed') OR a.version <> p_version THEN
    RETURN QUERY SELECT 'not_submittable'::text, NULL::integer, NULL::uuid; RETURN;
  END IF;
  SELECT permittee_lifecycle INTO plc FROM organisation WHERE id = a.organisation_id;
  IF plc IN ('on_hold', 'revoked', 'active', 'pending') THEN
    RETURN QUERY SELECT 'organisation_not_eligible'::text, NULL::integer, NULL::uuid; RETURN;
  END IF;
  checks_ok := manufacturer_onboarding_run_automated_checks(p_application);
  IF p_amount_inr IS DISTINCT FROM 5000.00 THEN
    INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
    VALUES (p_application, 'fee_rule_amount', 'fail', 'Fee must match master rule INR 5000.00');
    checks_ok := false;
  END IF;
  IF NOT checks_ok THEN
    v_after := a.version + 1;
    UPDATE manufacturer_onboarding_application SET state = 'automatic_checks_failed', version = v_after WHERE id = p_application;
    INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
    VALUES (p_application, 'submit_checks_failed', 'draft', 'automatic_checks_failed', p_actor, p_role, 'Automated checks failed');
    INSERT INTO manufacturer_onboarding_command_evidence (command_id, application_id, purpose, payload_hash)
    VALUES (p_command_id, p_application, 'submit', p_payload_hash);
    RETURN QUERY SELECT 'automatic_checks_failed'::text, v_after, NULL::uuid; RETURN;
  END IF;
  receipt := manufacturer_onboarding_sim_receipt_number();
  INSERT INTO payment (id, application_id, organisation_id, amount_inr, status, gateway_ref, started_by_account_id, receipt_number, settled_at)
  VALUES (pay_id, p_application, a.organisation_id, p_amount_inr, 'paid', gw, p_actor, receipt, now());
  INSERT INTO payment_callback (payment_id, gateway_ref, outcome, payload_sha256) VALUES (pay_id, gw, 'paid', sha);
  INSERT INTO payment_event (payment_id, event, actor_account_id, actor_role, detail)
  VALUES (pay_id, 'started', p_actor, p_role, 'Onboarding fee at simulated gateway'),
         (pay_id, 'paid', p_actor, p_role, 'Simulated auto-settle on submit');
  INSERT INTO manufacturer_onboarding_payment_link (application_id, payment_id) VALUES (p_application, pay_id);
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'payment_receipt', 'pass', receipt);
  INSERT INTO manufacturer_onboarding_fee_snapshot (application_id, amount_inr, tax_rate_percent, fee_rule_key, fee_rule_version, verification_status, source_reference, note)
  VALUES (p_application, p_amount_inr, 0, p_fee_rule_key, p_fee_rule_version, p_verification_status, p_source_reference, p_note);
  v_after := a.version + 1;
  UPDATE manufacturer_onboarding_application SET state = 'submitted', version = v_after WHERE id = p_application;
  INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
  VALUES (p_application, 'submit', 'draft', 'submitted', p_actor, p_role, 'Submitted with simulated payment');
  v_after := v_after + 1;
  to_state := 'director_review';
  UPDATE manufacturer_onboarding_application SET state = to_state, version = v_after WHERE id = p_application;
  UPDATE organisation SET permittee_lifecycle = 'pending' WHERE id = a.organisation_id AND permittee_lifecycle = 'none';
  INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
  VALUES (p_application, 'checks_passed', 'submitted', to_state, p_actor, p_role, 'Automated checks passed');
  PERFORM notification_foundation_deliver(notify_id, notify_hash, 'manufacturer_onboarding_application', p_application,
    'manufacturer_onboarding_director_review', 'Automated checks passed; director review required.', p_actor);
  INSERT INTO manufacturer_onboarding_command_evidence (command_id, application_id, purpose, payload_hash)
  VALUES (p_command_id, p_application, 'submit', p_payload_hash);
  RETURN QUERY SELECT to_state, v_after, pay_id;
END $$;

CREATE FUNCTION manufacturer_onboarding_orchestrate_director_decision(
  p_application uuid, p_actor uuid, p_version integer, p_decision text, p_note text,
  p_command_id uuid, p_payload_hash char(64))
RETURNS TABLE (out_state text, out_version integer, out_permittee_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  a manufacturer_onboarding_application%ROWTYPE;
  holds boolean;
  v_after integer;
  pt text;
  ev uuid := gen_random_uuid();
  approved_at timestamptz := clock_timestamp();
  obs_start date;
  obs_end date;
BEGIN
  IF EXISTS (SELECT 1 FROM manufacturer_onboarding_command_evidence WHERE command_id = p_command_id) THEN
    SELECT a.state, a.version, a.permittee_number INTO out_state, out_version, out_permittee_number FROM manufacturer_onboarding_application a WHERE a.id = p_application;
    RETURN NEXT; RETURN;
  END IF;
  IF p_decision NOT IN ('approve', 'reject') THEN
    RETURN QUERY SELECT 'validation_failed'::text, NULL::integer, NULL::text; RETURN;
  END IF;
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state <> 'director_review' OR a.version <> p_version THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer, NULL::text; RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM role_assignment ra JOIN capability_grant g ON g.role = ra.role AND g.capability = 'manufacturer_onboarding_director'
                  WHERE ra.user_id = p_actor AND ra.active) INTO holds;
  IF NOT holds THEN RETURN QUERY SELECT 'not_permitted'::text, NULL::integer, NULL::text; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM manufacturer_onboarding_event e WHERE e.application_id = p_application AND e.actor_account_id = p_actor AND e.event_kind = 'submit') THEN
    RETURN QUERY SELECT 'segregation_refused'::text, NULL::integer, NULL::text; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM organisation_membership m WHERE m.active AND m.user_id = p_actor AND m.organisation_id = a.organisation_id) THEN
    RETURN QUERY SELECT 'segregation_refused'::text, NULL::integer, NULL::text; RETURN;
  END IF;
  v_after := a.version + 1;
  IF p_decision = 'reject' THEN
    UPDATE manufacturer_onboarding_application SET state = 'rejected', version = v_after WHERE id = p_application;
    INSERT INTO manufacturer_onboarding_director_decision (application_id, decision, note, actor_account_id, transition_event_id)
    VALUES (p_application, 'reject', nullif(btrim(p_note), ''), p_actor, ev);
    INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
    VALUES (p_application, 'director_reject', 'director_review', 'rejected', p_actor, 'director', p_note);
    INSERT INTO manufacturer_onboarding_command_evidence (command_id, application_id, purpose, payload_hash)
    VALUES (p_command_id, p_application, 'director_decision', p_payload_hash);
    RETURN QUERY SELECT 'rejected'::text, v_after, NULL::text; RETURN;
  END IF;
  obs_start := (approved_at AT TIME ZONE 'Asia/Kolkata')::date;
  obs_end := obs_start + 15;
  pt := manufacturer_onboarding_next_permittee(extract(year from obs_start)::integer);
  UPDATE manufacturer_onboarding_application SET state = 'active_observation', version = v_after, permittee_number = pt, observation_ends_on = obs_end
   WHERE id = p_application;
  INSERT INTO manufacturer_onboarding_director_decision (application_id, decision, note, actor_account_id, decided_at, transition_event_id)
  VALUES (p_application, 'approve', nullif(btrim(p_note), ''), p_actor, approved_at, ev);
  INSERT INTO manufacturer_onboarding_observation (application_id, started_on, ends_on) VALUES (p_application, obs_start, obs_end);
  INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
  VALUES (p_application, 'director_approve', 'director_review', 'active_observation', p_actor, 'director', p_note);
  PERFORM notification_foundation_deliver(gen_random_uuid(), md5(p_command_id::text || 'mob-notify-info') || md5('mob-notify-info|' || p_command_id::text),
    'manufacturer_onboarding_application', p_application, 'manufacturer_onboarding_information',
    'Director approved; permittee in observation.', p_actor);
  INSERT INTO manufacturer_onboarding_command_evidence (command_id, application_id, purpose, payload_hash)
  VALUES (p_command_id, p_application, 'director_decision', p_payload_hash);
  RETURN QUERY SELECT 'active_observation'::text, v_after, pt;
END $$;

CREATE FUNCTION manufacturer_onboarding_orchestrate_raise_anomaly(
  p_application uuid, p_actor uuid, p_actor_role text, p_version integer, p_reason text,
  p_command_id uuid, p_payload_hash char(64))
RETURNS TABLE (out_state text, out_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE a manufacturer_onboarding_application%ROWTYPE; holds boolean; v_after integer;
BEGIN
  IF EXISTS (SELECT 1 FROM manufacturer_onboarding_command_evidence WHERE command_id = p_command_id) THEN
    SELECT a.state, a.version INTO out_state, out_version FROM manufacturer_onboarding_application a WHERE a.id = p_application;
    RETURN NEXT; RETURN;
  END IF;
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state NOT IN ('active_observation', 'active') OR a.version <> p_version THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer; RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM role_assignment ra JOIN capability_grant g ON g.role = ra.role AND g.capability = 'manufacturer_onboarding_anomaly'
                  WHERE ra.user_id = p_actor AND ra.active AND ra.role = p_actor_role) INTO holds;
  IF NOT holds OR p_actor_role NOT IN ('finance', 'programme', 'director') THEN
    RETURN QUERY SELECT 'not_permitted'::text, NULL::integer; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM manufacturer_onboarding_anomaly WHERE application_id = p_application AND resolved_at IS NULL) THEN
    RETURN QUERY SELECT 'anomaly_open'::text, NULL::integer; RETURN;
  END IF;
  v_after := a.version + 1;
  UPDATE manufacturer_onboarding_application SET state = 'on_hold', version = v_after WHERE id = p_application;
  UPDATE organisation SET permittee_lifecycle = 'on_hold' WHERE id = a.organisation_id;
  INSERT INTO manufacturer_onboarding_anomaly (application_id, raised_by_role, reason, raised_by_account_id)
  VALUES (p_application, p_actor_role, btrim(p_reason), p_actor);
  INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
  VALUES (p_application, 'anomaly_raised', a.state, 'on_hold', p_actor, p_actor_role, p_reason);
  INSERT INTO manufacturer_onboarding_command_evidence (command_id, application_id, purpose, payload_hash)
  VALUES (p_command_id, p_application, 'raise_anomaly', p_payload_hash);
  RETURN QUERY SELECT 'on_hold'::text, v_after;
END $$;

CREATE FUNCTION manufacturer_onboarding_orchestrate_resolve_anomaly(
  p_application uuid, p_actor uuid, p_version integer, p_resolution text, p_note text,
  p_command_id uuid, p_payload_hash char(64))
RETURNS TABLE (out_state text, out_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE a manufacturer_onboarding_application%ROWTYPE; holds boolean; v_after integer; resume text; today date; ev uuid := gen_random_uuid();
BEGIN
  IF EXISTS (SELECT 1 FROM manufacturer_onboarding_command_evidence WHERE command_id = p_command_id) THEN
    SELECT a.state, a.version INTO out_state, out_version FROM manufacturer_onboarding_application a WHERE a.id = p_application;
    RETURN NEXT; RETURN;
  END IF;
  IF p_resolution NOT IN ('cleared', 'revoked') THEN RETURN QUERY SELECT 'validation_failed'::text, NULL::integer; RETURN; END IF;
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state <> 'on_hold' OR a.version <> p_version THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer; RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM role_assignment ra JOIN capability_grant g ON g.role = ra.role AND g.capability = 'manufacturer_onboarding_director'
                  WHERE ra.user_id = p_actor AND ra.active) INTO holds;
  IF NOT holds THEN RETURN QUERY SELECT 'not_permitted'::text, NULL::integer; RETURN; END IF;
  v_after := a.version + 1;
  IF p_resolution = 'revoked' THEN
    UPDATE manufacturer_onboarding_application SET state = 'revoked', version = v_after WHERE id = p_application;
    UPDATE organisation SET permittee_lifecycle = 'revoked' WHERE id = a.organisation_id;
    UPDATE manufacturer_onboarding_anomaly SET resolved_at = now(), resolution = 'revoked', resolved_by_account_id = p_actor, resolution_note = nullif(btrim(p_note), '')
     WHERE application_id = p_application AND resolved_at IS NULL;
    INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
    VALUES (p_application, 'director_revoke', 'on_hold', 'revoked', p_actor, 'director', p_note);
    INSERT INTO manufacturer_onboarding_command_evidence (command_id, application_id, purpose, payload_hash)
    VALUES (p_command_id, p_application, 'revoke', p_payload_hash);
    RETURN QUERY SELECT 'revoked'::text, v_after; RETURN;
  END IF;
  today := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  IF a.observation_ends_on IS NOT NULL AND today >= a.observation_ends_on THEN
    resume := 'active';
    UPDATE manufacturer_onboarding_observation SET closed_at = now(), transition_event_id = ev
     WHERE application_id = p_application AND closed_at IS NULL;
    IF NOT EXISTS (SELECT 1 FROM manufacturer_onboarding_permittee_activation WHERE application_id = p_application) THEN
      INSERT INTO manufacturer_onboarding_permittee_activation (application_id, organisation_id, permittee_number, transition_event_id)
      VALUES (p_application, a.organisation_id, a.permittee_number, ev);
    END IF;
    UPDATE organisation SET permittee_lifecycle = 'active' WHERE id = a.organisation_id;
  ELSE
    resume := 'active_observation';
    UPDATE organisation SET permittee_lifecycle = 'pending' WHERE id = a.organisation_id;
  END IF;
  UPDATE manufacturer_onboarding_application SET state = resume, version = v_after WHERE id = p_application;
  UPDATE manufacturer_onboarding_anomaly SET resolved_at = now(), resolution = 'cleared', resolved_by_account_id = p_actor, resolution_note = nullif(btrim(p_note), '')
   WHERE application_id = p_application AND resolved_at IS NULL;
  INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
  VALUES (p_application, 'anomaly_cleared', 'on_hold', resume, p_actor, 'director', p_note);
  INSERT INTO manufacturer_onboarding_command_evidence (command_id, application_id, purpose, payload_hash)
  VALUES (p_command_id, p_application, 'resolve_anomaly', p_payload_hash);
  RETURN QUERY SELECT resume, v_after;
END $$;

CREATE FUNCTION manufacturer_onboarding_orchestrate_observation_close(
  p_application uuid, p_actor uuid, p_role text, p_version integer,
  p_command_id uuid, p_payload_hash char(64))
RETURNS TABLE (out_state text, out_version integer, out_permittee_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE a manufacturer_onboarding_application%ROWTYPE; today date; v_after integer; ev uuid := gen_random_uuid();
BEGIN
  IF EXISTS (SELECT 1 FROM manufacturer_onboarding_command_evidence WHERE command_id = p_command_id) THEN
    SELECT a.state, a.version, a.permittee_number INTO out_state, out_version, out_permittee_number FROM manufacturer_onboarding_application a WHERE a.id = p_application;
    RETURN NEXT; RETURN;
  END IF;
  today := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state <> 'active_observation' OR a.version <> p_version THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer, NULL::text; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM manufacturer_onboarding_anomaly WHERE application_id = p_application AND resolved_at IS NULL) THEN
    RETURN QUERY SELECT 'anomaly_open'::text, NULL::integer, NULL::text; RETURN;
  END IF;
  IF today < a.observation_ends_on THEN
    RETURN QUERY SELECT 'observation_not_ended'::text, NULL::integer, NULL::text; RETURN;
  END IF;
  v_after := a.version + 1;
  UPDATE manufacturer_onboarding_application SET state = 'active', version = v_after WHERE id = p_application;
  UPDATE manufacturer_onboarding_observation SET closed_at = now(), transition_event_id = ev WHERE application_id = p_application;
  INSERT INTO manufacturer_onboarding_permittee_activation (application_id, organisation_id, permittee_number, transition_event_id)
  VALUES (p_application, a.organisation_id, a.permittee_number, ev);
  UPDATE organisation SET permittee_lifecycle = 'active' WHERE id = a.organisation_id;
  INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
  VALUES (p_application, 'observation_close', 'active_observation', 'active', p_actor, p_role, '15-day observation complete');
  INSERT INTO manufacturer_onboarding_command_evidence (command_id, application_id, purpose, payload_hash)
  VALUES (p_command_id, p_application, 'observation_close', p_payload_hash);
  RETURN QUERY SELECT 'active'::text, v_after, a.permittee_number;
END $$;

CREATE FUNCTION manufacturer_onboarding_maint_observation_close_as_of(
  p_application uuid, p_as_of date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE a manufacturer_onboarding_application%ROWTYPE; cmd uuid := gen_random_uuid(); hash char(64) := md5(random()::text) || md5('mob-maint-close|' || random()::text);
BEGIN
  IF current_user <> 'bee_local_maint' AND session_user <> 'bee_local_maint' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'maint_only';
  END IF;
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application;
  IF NOT FOUND OR a.state <> 'active_observation' THEN RETURN 'not_found'; END IF;
  IF p_as_of < a.observation_ends_on THEN RETURN 'observation_not_ended'; END IF;
  PERFORM manufacturer_onboarding_orchestrate_observation_close(
    p_application, (SELECT id FROM user_account WHERE username = 'bee.director' LIMIT 1), 'director', a.version, cmd, hash);
  RETURN 'active';
END $$;

CREATE FUNCTION manufacturer_onboarding_maint_close_expired_observations(p_as_of date DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE r record; n integer := 0; today date := coalesce(p_as_of, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  cmd uuid; hash char(64); dir uuid;
BEGIN
  IF current_user <> 'bee_local_maint' AND session_user <> 'bee_local_maint' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'maint_only';
  END IF;
  SELECT id INTO dir FROM user_account WHERE username = 'bee.director' LIMIT 1;
  FOR r IN SELECT a.id, a.version FROM manufacturer_onboarding_application a
    WHERE a.state = 'active_observation' AND a.observation_ends_on <= today
      AND NOT EXISTS (SELECT 1 FROM manufacturer_onboarding_anomaly an WHERE an.application_id = a.id AND an.resolved_at IS NULL)
    FOR UPDATE LOOP
    cmd := gen_random_uuid();
    hash := md5(r.id::text || cmd::text) || md5('mob-batch-close|' || r.id::text || cmd::text);
    PERFORM manufacturer_onboarding_orchestrate_observation_close(r.id, dir, 'director', r.version, cmd, hash);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

ALTER TABLE notification DROP CONSTRAINT IF EXISTS notification_subject_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_subject_kind_check
  CHECK (subject_kind IN ('registration_application', 'model_application', 'manufacturer_onboarding_application'));
ALTER TABLE notification DROP CONSTRAINT IF EXISTS notification_model_application_id_check;
ALTER TABLE notification ADD CONSTRAINT notification_model_application_id_check
  CHECK (
    (subject_kind = 'model_application' AND application_id IS NOT NULL AND application_id = subject_id)
    OR (subject_kind = 'registration_application' AND application_id IS NULL)
    OR (subject_kind = 'manufacturer_onboarding_application' AND application_id IS NULL)
  );
ALTER TABLE notification DROP CONSTRAINT IF EXISTS notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check
  CHECK (kind IN ('returned', 'rejected', 'fee_due', 'approved', 'applicant_resubmitted',
    'manufacturer_onboarding_director_review', 'manufacturer_onboarding_information'));

ALTER TABLE notification_command DROP CONSTRAINT IF EXISTS notification_command_subject_kind_check;
ALTER TABLE notification_command ADD CONSTRAINT notification_command_subject_kind_check
  CHECK (subject_kind IN ('registration_application', 'model_application', 'manufacturer_onboarding_application'));
ALTER TABLE notification_command DROP CONSTRAINT IF EXISTS notification_command_kind_check;
ALTER TABLE notification_command ADD CONSTRAINT notification_command_kind_check
  CHECK (kind IN ('returned', 'rejected', 'fee_due', 'approved', 'applicant_resubmitted',
    'manufacturer_onboarding_director_review', 'manufacturer_onboarding_information'));

CREATE OR REPLACE FUNCTION notification_foundation_subject_message(p_kind text, p_id uuid, p_suffix text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE prefix text;
BEGIN
  IF p_kind = 'model_application' THEN
    SELECT a.reference || ' (' || a.brand_name || ' ' || a.model_number || ') ' INTO prefix FROM model_application a WHERE a.id = p_id;
  ELSIF p_kind = 'registration_application' THEN
    SELECT a.reference || ' (' || a.brand_name || ') ' INTO prefix FROM registration_application a WHERE a.id = p_id;
  ELSIF p_kind = 'manufacturer_onboarding_application' THEN
    SELECT a.reference || ' (' || a.legal_name || ') ' INTO prefix FROM manufacturer_onboarding_application a WHERE a.id = p_id;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workflow_subject_kind_invalid';
  END IF;
  IF prefix IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_missing';
  END IF;
  RETURN prefix || p_suffix;
END $$;

CREATE OR REPLACE FUNCTION notification_foundation_fan_out(
  p_subject_kind text, p_subject_id uuid, p_kind text, p_message text
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer; org_id uuid;
BEGIN
  IF p_subject_kind = 'manufacturer_onboarding_application' THEN
    IF p_kind = 'manufacturer_onboarding_director_review' THEN
      INSERT INTO notification (recipient_account_id, application_id, subject_kind, subject_id, kind, message)
      SELECT DISTINCT ra.user_id, NULL::uuid, p_subject_kind, p_subject_id, p_kind, p_message
        FROM role_assignment ra
        JOIN capability_grant g ON g.role = ra.role AND g.capability = 'manufacturer_onboarding_director'
        JOIN user_account u ON u.id = ra.user_id
       WHERE ra.active AND u.status = 'active';
    ELSIF p_kind = 'manufacturer_onboarding_information' THEN
      INSERT INTO notification (recipient_account_id, application_id, subject_kind, subject_id, kind, message)
      SELECT DISTINCT ra.user_id, NULL::uuid, p_subject_kind, p_subject_id, p_kind, p_message
        FROM role_assignment ra
        JOIN user_account u ON u.id = ra.user_id
       WHERE ra.active AND u.status = 'active' AND ra.role IN ('finance', 'programme') AND ra.scope = 'all';
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_kind_invalid';
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END IF;
  IF p_subject_kind = 'model_application' THEN
    SELECT organisation_id INTO org_id FROM model_application WHERE id = p_subject_id;
  ELSE
    SELECT organisation_id INTO org_id FROM registration_application WHERE id = p_subject_id;
  END IF;
  IF org_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_missing';
  END IF;
  INSERT INTO notification (recipient_account_id, application_id, subject_kind, subject_id, kind, message)
  SELECT DISTINCT m.user_id,
         CASE WHEN p_subject_kind = 'model_application' THEN p_subject_id ELSE NULL END,
         p_subject_kind, p_subject_id, p_kind, p_message
    FROM organisation_membership m
    JOIN organisation o ON o.id = m.organisation_id
    JOIN user_account u ON u.id = m.user_id
   WHERE m.organisation_id = org_id AND m.active AND o.status = 'active' AND u.status = 'active'
     AND now() >= m.valid_from AND now() < m.valid_to;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION workflow_validate_subject(p_kind text, p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_kind = 'registration_application' THEN
    IF NOT EXISTS (SELECT 1 FROM registration_application WHERE id = p_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_missing';
    END IF;
  ELSIF p_kind = 'model_application' THEN
    IF NOT EXISTS (SELECT 1 FROM model_application WHERE id = p_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_missing';
    END IF;
  ELSIF p_kind = 'manufacturer_onboarding_application' THEN
    IF NOT EXISTS (SELECT 1 FROM manufacturer_onboarding_application WHERE id = p_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'workflow_subject_missing';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workflow_subject_kind_invalid';
  END IF;
END $$;

REVOKE ALL ON FUNCTION manufacturer_onboarding_assert_applicant_writer(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_merge_draft_payload(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_trusted_create(uuid, uuid, text, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_trusted_patch_draft(uuid, uuid, uuid, integer, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_trusted_append_document(uuid, uuid, uuid, text, char(64), bigint, text, text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_run_automated_checks(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_orchestrate_submit(uuid, uuid, text, integer, numeric, text, integer, text, text, text, uuid, char(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_next_reference(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_next_permittee(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_sim_receipt_number() FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_maint_observation_close_as_of(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_maint_close_expired_observations(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_orchestrate_director_decision(uuid, uuid, integer, text, text, uuid, char(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_orchestrate_raise_anomaly(uuid, uuid, text, integer, text, uuid, char(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_orchestrate_resolve_anomaly(uuid, uuid, integer, text, text, uuid, char(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufacturer_onboarding_orchestrate_observation_close(uuid, uuid, text, integer, uuid, char(64)) FROM PUBLIC;

DO $$
DECLARE home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.manufacturer_onboarding_command_evidence TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.manufacturer_onboarding_application TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.manufacturer_onboarding_event TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.manufacturer_onboarding_automated_check TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.manufacturer_onboarding_payment_link TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.manufacturer_onboarding_fee_snapshot TO bee_local_maint', home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.manufacturer_onboarding_document, %I.manufacturer_onboarding_document_version TO bee_local_maint', home_schema, home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.manufacturer_onboarding_director_decision, %I.manufacturer_onboarding_observation, %I.manufacturer_onboarding_anomaly, %I.manufacturer_onboarding_permittee_activation TO bee_local_maint',
      home_schema, home_schema, home_schema, home_schema);
    EXECUTE format('GRANT SELECT, DELETE ON %I.payment_callback, %I.payment_event, %I.payment TO bee_local_maint', home_schema, home_schema, home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT SELECT ON %I.manufacturer_onboarding_application TO bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I.manufacturer_onboarding_application FROM bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.manufacturer_onboarding_trusted_create(uuid, uuid, text, integer, jsonb) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.manufacturer_onboarding_trusted_patch_draft(uuid, uuid, uuid, integer, text, jsonb) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.manufacturer_onboarding_trusted_append_document(uuid, uuid, uuid, text, char(64), bigint, text, text, date, date) TO bee_runtime', home_schema);
    EXECUTE format('REVOKE SELECT, UPDATE ON %I.manufacturer_onboarding_allocator FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT ON %I.manufacturer_onboarding_event FROM bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.manufacturer_onboarding_event TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.manufacturer_onboarding_anomaly, %I.manufacturer_onboarding_director_decision, %I.manufacturer_onboarding_observation, %I.manufacturer_onboarding_permittee_activation TO bee_runtime',
      home_schema, home_schema, home_schema, home_schema);
    EXECUTE format('GRANT SELECT ON %I.manufacturer_onboarding_payment_link TO bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I.manufacturer_onboarding_document, %I.manufacturer_onboarding_document_version FROM bee_runtime', home_schema, home_schema);
    EXECUTE format('GRANT SELECT ON %I.manufacturer_onboarding_document, %I.manufacturer_onboarding_document_version TO bee_runtime', home_schema, home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I.manufacturer_onboarding_command_evidence FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I.manufacturer_onboarding_automated_check FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I.manufacturer_onboarding_director_decision FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I.manufacturer_onboarding_permittee_activation FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I.manufacturer_onboarding_observation FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I.manufacturer_onboarding_anomaly FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I.manufacturer_onboarding_fee_snapshot FROM bee_runtime', home_schema);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I.manufacturer_onboarding_payment_link FROM bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.manufacturer_onboarding_command_evidence, %I.manufacturer_onboarding_automated_check, %I.manufacturer_onboarding_fee_snapshot TO bee_runtime',
      home_schema, home_schema, home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.manufacturer_onboarding_orchestrate_submit(uuid, uuid, text, integer, numeric, text, integer, text, text, text, uuid, char(64)) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.manufacturer_onboarding_orchestrate_director_decision(uuid, uuid, integer, text, text, uuid, char(64)) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.manufacturer_onboarding_orchestrate_raise_anomaly(uuid, uuid, text, integer, text, uuid, char(64)) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.manufacturer_onboarding_orchestrate_resolve_anomaly(uuid, uuid, integer, text, text, uuid, char(64)) TO bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.manufacturer_onboarding_orchestrate_observation_close(uuid, uuid, text, integer, uuid, char(64)) TO bee_runtime', home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.manufacturer_onboarding_maint_observation_close_as_of(uuid, date) TO bee_local_maint', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.manufacturer_onboarding_maint_close_expired_observations(date) TO bee_local_maint', home_schema);
  END IF;
END $$;
