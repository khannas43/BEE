-- WP04.3: an approved registration no longer blocks a new request for the same brand name or the same brand. The register itself guards
-- against a second live brand of one name (brand_owner_name_live, V47, and the approval function) and against an overlapping active authorisation
-- (V6), so a revoked brand's name, or a revoked authorisation's brand, can be requested again. A request is "live" while it is not rejected
-- and not yet approved.
DROP INDEX registration_application_brand_name;
CREATE UNIQUE INDEX registration_application_brand_name ON registration_application (organisation_id, lower(btrim(brand_name)))
  WHERE kind = 'brand' AND state NOT IN ('rejected', 'approved');
DROP INDEX registration_application_agency_brand;
CREATE UNIQUE INDEX registration_application_agency_brand ON registration_application (organisation_id, brand_id)
  WHERE kind = 'agency' AND state NOT IN ('rejected', 'approved');
