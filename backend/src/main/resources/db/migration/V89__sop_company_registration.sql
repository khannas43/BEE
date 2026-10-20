-- Company registration aligned with section 1.1 of the SOP for the BEE S&L portal (Company / Brand Registration + Appliance / Equipment Registration).
-- (1) The draft gets one more top-level key, "sop": the SOP's fields (category, scale, equipment, brand, business contact details, company
--     registration details, the choice of payment method). (2) Six more document kinds: the list of authorised retailers or dealers, the trade mark and
--     company registration certificate, the quality management system certificate (ISO 9001), the authorised letter for the signatory, the ID proof of
--     the signatory and the small-scale industry certificate. (3) The automated checks follow the SOP: CIN and GSTIN become optional (checked for format
--     only when given), the SOP's company, registration and document requirements are checked. Records submitted earlier are not re-checked.
-- Local demonstration on the owner's assumptions, not BEE rules.

-- 1. document kinds
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'manufacturer_onboarding_document'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%document_kind%' LOOP
    EXECUTE format('ALTER TABLE manufacturer_onboarding_document DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE manufacturer_onboarding_document ADD CONSTRAINT manufacturer_onboarding_document_document_kind_check CHECK (document_kind IN (
  'trade_licence', 'certificate_of_incorporation', 'gst_certificate', 'pan_card', 'signatory_photo_id',
  'facility_address_proof', 'signed_declaration', 'signed_agreement', 'annexure_supporting',
  'retailers_list', 'trademark_company_registration', 'qms_iso9001', 'signatory_authority_letter', 'signatory_id_proof', 'ssi_certificate'));

CREATE OR REPLACE FUNCTION manufacturer_onboarding_trusted_append_document(
  p_actor uuid, p_application uuid, p_organisation uuid, p_document_kind text,
  p_content_sha256 char(64), p_size_bytes bigint, p_original_filename text, p_label text,
  p_issue_on date, p_expires_on date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE a manufacturer_onboarding_application%ROWTYPE; doc_id uuid; next_ver integer;
  kinds text[] := ARRAY['trade_licence', 'certificate_of_incorporation', 'gst_certificate', 'pan_card', 'signatory_photo_id',
    'facility_address_proof', 'signed_declaration', 'signed_agreement', 'annexure_supporting',
    'retailers_list', 'trademark_company_registration', 'qms_iso9001', 'signatory_authority_letter', 'signatory_id_proof', 'ssi_certificate'];
BEGIN
  PERFORM manufacturer_onboarding_assert_applicant_writer(p_actor, p_organisation, p_application);
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.state NOT IN ('draft', 'automatic_checks_failed', 'returned') THEN
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

-- 2. the draft key
CREATE OR REPLACE FUNCTION manufacturer_onboarding_merge_draft_payload(p_existing jsonb, p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path FROM CURRENT AS $$
DECLARE allowed text[] := ARRAY['cin', 'gstin', 'declarationAccepted', 'agreementAccepted', 'registeredAddress', 'authorisedSignatory', 'facilities', 'contacts', 'annexureNotes', 'sop'];
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

-- 3. the automated checks
CREATE OR REPLACE FUNCTION manufacturer_onboarding_run_automated_checks(p_application uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  a manufacturer_onboarding_application%ROWTYPE;
  d jsonb;
  s jsonb;
  ok boolean := true;
  pass boolean;
  has_doc boolean;
  today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  req text[] := ARRAY['retailers_list', 'trademark_company_registration', 'qms_iso9001', 'signatory_authority_letter', 'signatory_id_proof'];
  kind text;
  exp date;
  plc text;
  cin text;
  gstin text;
BEGIN
  SELECT * INTO a FROM manufacturer_onboarding_application WHERE id = p_application;
  d := coalesce(a.draft_payload, '{}'::jsonb);
  s := coalesce(d -> 'sop', '{}'::jsonb);
  cin := nullif(btrim(coalesce(d ->> 'cin', '')), '');
  gstin := nullif(btrim(coalesce(d ->> 'gstin', '')), '');
  IF s ->> 'scale' = 'small' THEN
    req := req || ARRAY['ssi_certificate'];
  END IF;

  pass := char_length(btrim(a.legal_name)) > 0;
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'legal_name_present', CASE WHEN pass THEN 'pass' ELSE 'fail' END, CASE WHEN pass THEN NULL ELSE 'Name of the firm required' END);
  ok := ok AND pass;

  pass := coalesce((d ->> 'declarationAccepted')::boolean, false) AND coalesce((d ->> 'agreementAccepted')::boolean, false);
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'declaration_accepted', CASE WHEN pass THEN 'pass' ELSE 'fail' END, CASE WHEN pass THEN NULL ELSE 'The disclaimer must be accepted' END);
  ok := ok AND pass;

  pass := (s ->> 'category') IN ('manufacturer', 'importer') AND char_length(btrim(coalesce(s ->> 'equipment', ''))) > 0 AND char_length(btrim(coalesce(s ->> 'brandName', ''))) > 0
          AND (s ->> 'scale') IN ('small', 'large');
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'company_details_complete', CASE WHEN pass THEN 'pass' ELSE 'fail' END,
          CASE WHEN pass THEN NULL ELSE 'Category, scale of industry, equipment and brand name are required' END);
  ok := ok AND pass;

  pass := char_length(btrim(coalesce(s ->> 'companyRegNo', ''))) > 0 AND char_length(btrim(coalesce(s ->> 'companyRegDate', ''))) > 0
          AND char_length(btrim(coalesce(s ->> 'companyPan', ''))) > 0 AND char_length(btrim(coalesce(s ->> 'annualTurnoverLakhs', ''))) > 0;
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'registration_details_complete', CASE WHEN pass THEN 'pass' ELSE 'fail' END,
          CASE WHEN pass THEN NULL ELSE 'Company registration number and date, PAN and annual turnover are required' END);
  ok := ok AND pass;

  pass := cin IS NULL OR cin ~ '^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[A-Za-z]{3}[0-9]{6}$';
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'cin_format', CASE WHEN pass THEN 'pass' ELSE 'fail' END, CASE WHEN pass THEN NULL ELSE 'CIN format invalid' END);
  ok := ok AND pass;

  pass := gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'gstin_format', CASE WHEN pass THEN 'pass' ELSE 'fail' END, CASE WHEN pass THEN NULL ELSE 'GSTIN format invalid' END);
  ok := ok AND pass;

  pass := d -> 'registeredAddress' ?& ARRAY['line1', 'city', 'state', 'pincode'];
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'registered_address_complete', CASE WHEN pass THEN 'pass' ELSE 'fail' END, CASE WHEN pass THEN NULL ELSE 'Business address incomplete' END);
  ok := ok AND pass;

  pass := d -> 'authorisedSignatory' ?& ARRAY['name', 'designation'];
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'authorised_signatory_present', CASE WHEN pass THEN 'pass' ELSE 'fail' END, CASE WHEN pass THEN NULL ELSE 'Contact person (name and designation) required' END);
  ok := ok AND pass;

  SELECT permittee_lifecycle INTO plc FROM organisation WHERE id = a.organisation_id;
  INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
  VALUES (p_application, 'eligible_applicant_organisation', CASE WHEN plc = 'none' THEN 'pass' ELSE 'fail' END,
          CASE WHEN plc = 'none' THEN NULL ELSE format('Organisation lifecycle %s blocks onboarding', plc) END);
  ok := ok AND plc = 'none';

  IF cin IS NOT NULL AND EXISTS (
    SELECT 1 FROM manufacturer_onboarding_application o2
     WHERE o2.id <> p_application AND o2.state NOT IN ('rejected', 'revoked') AND btrim(coalesce(o2.draft_payload ->> 'cin', '')) = cin) THEN
    INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
    VALUES (p_application, 'cin_duplicate', 'fail', 'CIN already used on another live application');
    ok := false;
  END IF;
  IF gstin IS NOT NULL AND EXISTS (
    SELECT 1 FROM manufacturer_onboarding_application o2
     WHERE o2.id <> p_application AND o2.state NOT IN ('rejected', 'revoked') AND btrim(coalesce(o2.draft_payload ->> 'gstin', '')) = gstin) THEN
    INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
    VALUES (p_application, 'gstin_duplicate', 'fail', 'GSTIN already used on another live application');
    ok := false;
  END IF;

  FOREACH kind IN ARRAY req LOOP
    SELECT EXISTS (SELECT 1 FROM manufacturer_onboarding_document doc
      JOIN manufacturer_onboarding_document_version v ON v.document_id = doc.id
      WHERE doc.application_id = p_application AND doc.document_kind = kind) INTO has_doc;
    INSERT INTO manufacturer_onboarding_automated_check (application_id, check_code, outcome, detail)
    VALUES (p_application, 'document_' || kind, CASE WHEN has_doc THEN 'pass' ELSE 'fail' END,
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
