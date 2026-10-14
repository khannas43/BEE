-- WP04.2b-1 (owner's defaults, 14 October 2026): brand and agency registration, draft to fee due. Provisional local rules, not BEE rules.
--
-- A manufacturer registers a brand, or an agency asks to act for a manufacturer's brand (R1). This migration holds the application, its
-- single trade-licence PDF, the submission event with a fee snapshot, the transition events and Finance's fee confirmation. Recommend,
-- approve, return, reject and the write into brand / agency_authorisation are WP04.2b-2; nothing here creates a brand or an authorisation.
--
-- The fee reuses the fee-rule machinery. Registration fees are rules under the pseudo category REG (REG:brand_registration and
-- REG:agency_registration); REG is not a model category and is not in master_category, so it never appears in a model form or a rating scheme.
-- The same two-person fee_rule_decide proposes and approves a change to them.

INSERT INTO fee_application_type (code, label) VALUES ('brand_registration', 'Brand registration'), ('agency_registration', 'Agency registration');

INSERT INTO master_fee_rule (rule_key, version, effective_from, effective_to, source_reference, verification_status, note, legacy_id,
                             category_code, application_type, amount_inr)
VALUES
  ('REG:brand_registration', 1, DATE '2026-01-01', NULL, 'Owner default 14 October 2026 (WP04.2b plan; local placeholder, no source)', 'synthetic',
   'Provisional registration fee for a brand; not a BEE rule.', NULL, 'REG', 'brand_registration', 5000.00),
  ('REG:agency_registration', 1, DATE '2026-01-01', NULL, 'Owner default 14 October 2026 (WP04.2b plan; local placeholder, no source)', 'synthetic',
   'Provisional registration fee for an agency; not a BEE rule.', NULL, 'REG', 'agency_registration', 3000.00);

-- fee_rule_decide as in V33, with one change: the category must exist in master_category unless it is REG.
CREATE OR REPLACE FUNCTION fee_rule_decide(p_proposal uuid, p_decider uuid, p_decision text, p_note text)
RETURNS TABLE (out_state text, out_version integer, out_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  p        fee_rule_proposal%ROWTYPE;
  today    date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  holds    boolean;
  v_key    text;
  v_open   record;
  v_next   integer;
  v_json   jsonb;
BEGIN
  IF p_decision NOT IN ('approve', 'reject', 'withdraw') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'validation_failed';
  END IF;
  SELECT * INTO p FROM fee_rule_proposal WHERE id = p_proposal FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;
  IF p.state <> 'pending' THEN
    RETURN QUERY SELECT 'not_pending'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM role_assignment ra JOIN capability_grant g ON g.role = ra.role AND g.capability = 'fee_rule_manage'
                  WHERE ra.user_id = p_decider AND ra.active) INTO holds;
  IF NOT holds THEN
    RETURN QUERY SELECT 'not_permitted'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;

  IF p_decision = 'withdraw' THEN
    IF p_decider <> p.proposed_by THEN
      RETURN QUERY SELECT 'only_proposer'::text, NULL::integer, NULL::text;
    RETURN;
    END IF;
    UPDATE fee_rule_proposal SET state = 'withdrawn', decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
    RETURN QUERY SELECT 'withdrawn'::text, NULL::integer, (p.category_code || ':' || p.application_type)::text;
    RETURN;
  END IF;

  -- Approving or rejecting is the second person's step, never the proposer's own.
  IF p_decider = p.proposed_by THEN
    RETURN QUERY SELECT 'same_person'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;
  IF p_decision = 'reject' THEN
    UPDATE fee_rule_proposal SET state = 'rejected', decided_by = p_decider, decided_at = now(), decision_note = p_note WHERE id = p.id;
    RETURN QUERY SELECT 'rejected'::text, NULL::integer, (p.category_code || ':' || p.application_type)::text;
    RETURN;
  END IF;

  -- Approve: the rule may not start in the past, however long the proposal waited.
  IF p.effective_from < today THEN
    RETURN QUERY SELECT 'date_passed'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;
  v_key := p.category_code || ':' || p.application_type;
  PERFORM pg_advisory_xact_lock(hashtext(current_schema() || '.master_fee_rule'), hashtext(v_key));
  IF p.category_code <> 'REG' AND NOT EXISTS (SELECT 1 FROM master_category c WHERE c.rule_key = p.category_code AND c.effective_from <= p.effective_from
                  AND (c.effective_to IS NULL OR c.effective_to > p.effective_from)) THEN
    RETURN QUERY SELECT 'rule_conflict'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;

  v_json := jsonb_build_object('category_code', p.category_code, 'application_type', p.application_type, 'amount_inr', p.amount_inr,
                               'tax_rate_percent', p.tax_rate_percent, 'source_reference', btrim(p.source_reference),
                               'verification_status', 'provisional', 'note', btrim(p.reason));
  SELECT t.version, t.effective_from INTO v_open FROM master_fee_rule t
    LEFT JOIN master_closure c ON c.master_table = 'master_fee_rule' AND c.rule_key = t.rule_key AND c.version = t.version
   WHERE t.rule_key = v_key AND coalesce(c.effective_to, t.effective_to) IS NULL;
  BEGIN
    IF v_open.version IS NOT NULL THEN
      -- The rule in force (or already queued) is open-ended: end it on the new date and start the successor, in one step.
      v_next := master_supersede('master_fee_rule', v_key, v_open.version, p.effective_from, p_decider::text,
                                 btrim(p.source_reference), btrim(p.reason), v_json);
    ELSE
      -- Nothing open (no rule yet, or the last one has ended): start version max + 1, refused if it would overlap.
      SELECT coalesce(max(f.version), 0) + 1 INTO v_next FROM master_fee_rule f WHERE f.rule_key = v_key;
      INSERT INTO master_fee_rule SELECT * FROM jsonb_populate_record(NULL::master_fee_rule,
        v_json || jsonb_build_object('id', gen_random_uuid(), 'rule_key', v_key, 'version', v_next, 'effective_from', p.effective_from,
                                     'legacy_id', NULL, 'recorded_at', now()));
    END IF;
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '23P01' OR SQLSTATE '23505' THEN
    -- Everything the block did is rolled back; report the clash as a refusal.
    v_next := NULL;
  END;
  IF v_next IS NULL THEN
    RETURN QUERY SELECT 'rule_conflict'::text, NULL::integer, NULL::text;
    RETURN;
  END IF;
  UPDATE fee_rule_proposal SET state = 'approved', decided_by = p_decider, decided_at = now(), decision_note = p_note, applied_version = v_next
   WHERE id = p.id;
  RETURN QUERY SELECT 'approved'::text, v_next, v_key::text;
END $$;

REVOKE ALL ON FUNCTION fee_rule_decide(uuid, uuid, text, text) FROM PUBLIC;

CREATE TABLE registration_allocator (
  scope      text PRIMARY KEY,
  next_value integer NOT NULL CHECK (next_value >= 0)
);

CREATE TABLE registration_application (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference                  text NOT NULL UNIQUE,
  kind                       text NOT NULL CHECK (kind IN ('brand', 'agency')),
  organisation_id            uuid NOT NULL REFERENCES organisation (id),
  principal_organisation_id  uuid REFERENCES organisation (id),
  brand_id                   uuid REFERENCES brand (id),
  brand_name                 text NOT NULL CHECK (char_length(btrim(brand_name)) BETWEEN 1 AND 120),
  valid_from                 date,
  valid_to                   date,
  state                      text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'fee_due', 'programme_review', 'director_approval', 'approved', 'returned', 'rejected')),
  version                    integer NOT NULL DEFAULT 0,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'brand' OR (brand_id IS NOT NULL AND principal_organisation_id IS NOT NULL)),
  CHECK (kind = 'agency' OR (brand_id IS NULL AND principal_organisation_id IS NULL AND valid_from IS NULL AND valid_to IS NULL)),
  CHECK (valid_to IS NULL OR (valid_from IS NOT NULL AND valid_to > valid_from))
);
CREATE INDEX registration_application_organisation ON registration_application (organisation_id);
CREATE INDEX registration_application_state ON registration_application (state);
-- One live request per manufacturer and brand name, and one per agency and brand (a rejected one frees the name again).
CREATE UNIQUE INDEX registration_application_brand_name ON registration_application (organisation_id, lower(btrim(brand_name)))
  WHERE kind = 'brand' AND state <> 'rejected';
CREATE UNIQUE INDEX registration_application_agency_brand ON registration_application (organisation_id, brand_id)
  WHERE kind = 'agency' AND state <> 'rejected';

CREATE FUNCTION registration_application_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  org_kind text;
  b        record;
BEGIN
  SELECT kind INTO org_kind FROM organisation WHERE id = NEW.organisation_id;
  IF NEW.kind = 'brand' AND org_kind IS DISTINCT FROM 'manufacturer' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'a brand is registered by a manufacturer';
  END IF;
  IF NEW.kind = 'agency' THEN
    IF org_kind IS DISTINCT FROM 'agency' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'an agency registration is filed by an agency';
    END IF;
    SELECT owner_organisation_id, name, status INTO b FROM brand WHERE id = NEW.brand_id;
    IF NOT FOUND OR b.status <> 'active' OR b.owner_organisation_id IS DISTINCT FROM NEW.principal_organisation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'an agency registration names an active brand and its owner';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER registration_application_01_validate BEFORE INSERT OR UPDATE OF kind, organisation_id, principal_organisation_id, brand_id
  ON registration_application FOR EACH ROW EXECUTE FUNCTION registration_application_validate();

CREATE TABLE registration_submission_event (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id         uuid NOT NULL REFERENCES registration_application (id),
  from_state             text NOT NULL,
  to_state               text NOT NULL,
  actor_account_id       uuid NOT NULL REFERENCES user_account (id),
  actor_role             text NOT NULL,
  filing_organisation_id uuid NOT NULL REFERENCES organisation (id),
  occurred_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_submission_event_one UNIQUE (application_id)
);

CREATE TABLE registration_fee_snapshot (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id       uuid NOT NULL REFERENCES registration_application (id),
  submission_event_id  uuid NOT NULL REFERENCES registration_submission_event (id),
  amount_inr           numeric(14, 2) NOT NULL,
  tax_rate_percent     numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate_percent BETWEEN 0 AND 100),
  tax_inr              numeric(14,2) GENERATED ALWAYS AS (round(amount_inr * tax_rate_percent / 100, 2)) STORED,
  total_inr            numeric(14,2) GENERATED ALWAYS AS (amount_inr + round(amount_inr * tax_rate_percent / 100, 2)) STORED,
  currency             text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  fee_rule_key         text NOT NULL,
  fee_rule_version     integer NOT NULL,
  verification_status  text NOT NULL CHECK (verification_status IN ('synthetic', 'provisional', 'verified')),
  source_reference     text,
  note                 text,
  captured_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_fee_snapshot_one UNIQUE (application_id)
);

CREATE TABLE registration_transition_event (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    uuid NOT NULL REFERENCES registration_application (id),
  action            text NOT NULL CHECK (action ~ '^[a-z_]{3,40}$'),
  from_state        text NOT NULL,
  to_state          text NOT NULL,
  actor_account_id  uuid NOT NULL REFERENCES user_account (id),
  actor_role        text NOT NULL,
  version_after     integer NOT NULL CHECK (version_after >= 1),
  occurred_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX registration_transition_event_application ON registration_transition_event (application_id, occurred_at);

CREATE TABLE registration_fee_confirmation (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id          uuid NOT NULL REFERENCES registration_application (id),
  transition_event_id     uuid NOT NULL UNIQUE REFERENCES registration_transition_event (id),
  fee_snapshot_id         uuid NOT NULL REFERENCES registration_fee_snapshot (id),
  amount_inr              numeric(14, 2) NOT NULL CHECK (amount_inr > 0),
  receipt_reference       text NOT NULL CHECK (char_length(receipt_reference) BETWEEN 1 AND 64),
  received_on             date NOT NULL,
  confirmed_by_account_id uuid NOT NULL REFERENCES user_account (id),
  confirmed_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX registration_fee_confirmation_application ON registration_fee_confirmation (application_id);

-- The trade licence: one logical document per application, immutable PDF versions (as V23 does for a test report).
CREATE TABLE registration_document (
  id              uuid PRIMARY KEY,
  application_id  uuid NOT NULL REFERENCES registration_application (id),
  document_kind   text NOT NULL CHECK (document_kind IN ('trade_licence')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, document_kind)
);
CREATE TABLE registration_document_version (
  id                      uuid PRIMARY KEY,
  document_id             uuid NOT NULL REFERENCES registration_document (id),
  version_number          integer NOT NULL CHECK (version_number >= 1),
  content_sha256          char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes              bigint NOT NULL CHECK (size_bytes > 0),
  media_type              text NOT NULL CHECK (media_type = 'application/pdf'),
  original_filename       text NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 180),
  label                   text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  uploaded_by_account_id  uuid NOT NULL REFERENCES user_account (id),
  uploaded_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number)
);
CREATE INDEX registration_document_application_idx ON registration_document (application_id);
CREATE INDEX registration_document_version_document_idx ON registration_document_version (document_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['registration_submission_event', 'registration_fee_snapshot', 'registration_transition_event',
                           'registration_fee_confirmation', 'registration_document', 'registration_document_version'] LOOP
    EXECUTE format('CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION submission_reject_change()', t);
    EXECUTE format('CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION submission_reject_change()', t);
  END LOOP;
END $$;

-- Next reference REG-<year>-<number>, concurrency-safe (the upsert takes the row lock).
CREATE FUNCTION registration_next_reference(p_year integer) RETURNS text LANGUAGE sql AS $$
  INSERT INTO registration_allocator (scope, next_value) VALUES ('REG-' || p_year, 10002)
  ON CONFLICT (scope) DO UPDATE SET next_value = registration_allocator.next_value + 1
  RETURNING 'REG-' || p_year || '-' || (next_value - 1);
$$;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  -- The local maintenance login removes the rows of a throwaway live check (it alone may delete append-only records, as for model applications).
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.registration_application, %I.registration_submission_event, %I.registration_fee_snapshot, '
                   || '%I.registration_transition_event, %I.registration_fee_confirmation, %I.registration_document, %I.registration_document_version '
                   || 'TO bee_local_maint', home_schema, home_schema, home_schema, home_schema, home_schema, home_schema, home_schema);
  END IF;

  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I.registration_application TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I.registration_allocator TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.registration_submission_event, %I.registration_fee_snapshot, %I.registration_transition_event, '
                   || '%I.registration_fee_confirmation, %I.registration_document, %I.registration_document_version TO bee_runtime',
                   home_schema, home_schema, home_schema, home_schema, home_schema, home_schema);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.registration_submission_event, %I.registration_fee_snapshot, %I.registration_transition_event, '
                   || '%I.registration_fee_confirmation, %I.registration_document, %I.registration_document_version FROM bee_runtime',
                   home_schema, home_schema, home_schema, home_schema, home_schema, home_schema);
    EXECUTE format('REVOKE DELETE, TRUNCATE ON %I.registration_application FROM bee_runtime', home_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.registration_next_reference(integer) TO bee_runtime', home_schema);
  END IF;
END $$;

COMMENT ON TABLE registration_application IS
  'WP04.2b-1 brand or agency registration request: draft, fee_due and (WP04.2b-2) the review states. Provisional local rule, not a BEE rule.';
COMMENT ON TABLE registration_fee_snapshot IS
  'The registration fee in force when the request was submitted, with its rule key and version and the tax line (as for a model application).';
