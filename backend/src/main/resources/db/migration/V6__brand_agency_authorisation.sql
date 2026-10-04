-- WP04.2a: brand ownership and agency authorisation (docs/wp04/WP04.2_BRAND_AUTH.md).
--
-- Internal foundation only: no registration workflow, public route, role grant, fee or
-- rating logic, and no change to model_application.brand_name. V5 (master supersession)
-- is owned by the parallel checkout; this branch may temporarily have V4 then V6. Do not
-- apply V6 to the shared bee_app.app schema until V5 has been merged and applied.
--
-- Date convention matches WP04.1 masters: half-open [valid_from, valid_to). A grant
-- applies ON valid_from and NOT on valid_to; NULL valid_to is open-ended.

-- Brand ownership: one named brand, one owner organisation, status and provenance.
CREATE TABLE brand (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL CHECK (length(trim(name)) > 0),
  owner_organisation_id  uuid NOT NULL REFERENCES organisation (id),
  status                 text NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
  source_reference       text NOT NULL CHECK (length(trim(source_reference)) > 0),
  verification_status    text NOT NULL CHECK (verification_status IN ('synthetic', 'provisional', 'verified')),
  note                   text NOT NULL,
  recorded_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_organisation_id, name)
);

CREATE FUNCTION brand_require_manufacturer_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  org_kind text;
BEGIN
  SELECT kind INTO org_kind FROM organisation WHERE id = NEW.owner_organisation_id;
  IF org_kind IS DISTINCT FROM 'manufacturer' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = format('brand owner organisation must be kind manufacturer (got %s)', coalesce(org_kind, 'missing'));
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER brand_owner_kind BEFORE INSERT OR UPDATE OF owner_organisation_id ON brand
  FOR EACH ROW EXECUTE FUNCTION brand_require_manufacturer_owner();

-- Agency authorisation: agency may act for a principal on one named brand during a period.
CREATE TABLE agency_authorisation (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_organisation_id     uuid NOT NULL REFERENCES organisation (id),
  principal_organisation_id  uuid NOT NULL REFERENCES organisation (id),
  brand_id                   uuid NOT NULL REFERENCES brand (id),
  valid_from                 date NOT NULL,
  valid_to                   date CHECK (valid_to IS NULL OR valid_to > valid_from),
  status                     text NOT NULL CHECK (status IN ('active', 'revoked')),
  source_reference           text NOT NULL CHECK (length(trim(source_reference)) > 0),
  verification_status        text NOT NULL CHECK (verification_status IN ('synthetic', 'provisional', 'verified')),
  note                       text NOT NULL,
  recorded_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (agency_organisation_id <> principal_organisation_id)
);

CREATE FUNCTION agency_authorisation_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  agency_kind text;
  principal_kind text;
  owner uuid;
BEGIN
  SELECT kind INTO agency_kind FROM organisation WHERE id = NEW.agency_organisation_id;
  IF agency_kind IS DISTINCT FROM 'agency' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = format('agency_organisation_id must be kind agency (got %s)', coalesce(agency_kind, 'missing'));
  END IF;
  SELECT kind INTO principal_kind FROM organisation WHERE id = NEW.principal_organisation_id;
  IF principal_kind IS DISTINCT FROM 'manufacturer' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = format('principal_organisation_id must be kind manufacturer (got %s)', coalesce(principal_kind, 'missing'));
  END IF;
  SELECT owner_organisation_id INTO owner FROM brand WHERE id = NEW.brand_id;
  IF owner IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'agency_authorisation brand_id must reference brand';
  END IF;
  IF owner IS DISTINCT FROM NEW.principal_organisation_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'agency_authorisation principal_organisation_id must own the brand';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER agency_authorisation_01_validate BEFORE INSERT OR UPDATE OF
  agency_organisation_id, principal_organisation_id, brand_id ON agency_authorisation
  FOR EACH ROW EXECUTE FUNCTION agency_authorisation_validate();

-- Contradictory active periods for the same agency and brand are refused (SQLSTATE 23P01).
-- Touching half-open periods are allowed. An open-ended active grant blocks any later start.
-- Only status = active participates; revoked rows do not block a later grant.
CREATE FUNCTION agency_authorisation_reject_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  clash uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtext(TG_TABLE_SCHEMA || '.agency_authorisation'),
    hashtext(NEW.agency_organisation_id::text || ':' || NEW.brand_id::text));
  SELECT id INTO clash FROM agency_authorisation
    WHERE agency_organisation_id = NEW.agency_organisation_id
      AND brand_id = NEW.brand_id
      AND status = 'active'
      AND id IS DISTINCT FROM NEW.id
      AND daterange(valid_from, valid_to, '[)') && daterange(NEW.valid_from, NEW.valid_to, '[)')
    LIMIT 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23P01',
      MESSAGE = format('agency_authorisation %s brand %s [%s, %s) overlaps active grant %s',
        NEW.agency_organisation_id, NEW.brand_id, NEW.valid_from, coalesce(NEW.valid_to::text, 'open'), clash);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER agency_authorisation_02_reject_overlap BEFORE INSERT OR UPDATE OF
  agency_organisation_id, brand_id, valid_from, valid_to, status ON agency_authorisation
  FOR EACH ROW EXECUTE FUNCTION agency_authorisation_reject_overlap();

CREATE INDEX agency_authorisation_lookup
  ON agency_authorisation (agency_organisation_id, brand_id, principal_organisation_id, status, valid_from);
