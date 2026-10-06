-- WP09.1c (owner's assumption D8, 5 October 2026, not BEE's decision): what anyone may see when verifying a certificate.
-- The public verification route reads ONLY this view, so what it can show is fixed here by construction: the registration ID, brand,
-- model, category, stars, efficiency figure, validity dates and the manufacturer's legal name. It has no personal names, no addresses,
-- no application reference, no notes and no internal ids. Status (valid or expired) is worked out from the dates when it is read.
CREATE VIEW public_certificate WITH (security_barrier = true) AS
  SELECT c.registration_id, c.brand_name, c.model_number, c.category_code, c.stars, c.verified_iseer, c.valid_from, c.valid_to,
         c.organisation_name AS manufacturer
    FROM certificate c;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT ON %I.public_certificate TO bee_runtime', home_schema);
  END IF;
END $$;
