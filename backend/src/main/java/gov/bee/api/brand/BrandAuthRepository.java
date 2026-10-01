package gov.bee.api.brand;

import gov.bee.api.brand.BrandAuth.AgencyAuthorisation;
import gov.bee.api.brand.BrandAuth.Brand;
import gov.bee.api.brand.BrandAuth.Provenance;
import gov.bee.api.brand.BrandAuth.Verification;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Read access to brand ownership and agency authorisation. Resolution uses half-open
 * [valid_from, valid_to) periods at an explicit calendar date. Internal only: no controller
 * or model-application policy calls this yet.
 */
@Repository
public class BrandAuthRepository {

    private static final String BRAND_COLS =
        "id, name, owner_organisation_id, status, source_reference, verification_status, note";
    private static final String AUTH_COLS =
        "id, agency_organisation_id, principal_organisation_id, brand_id, valid_from, valid_to, status, "
            + "source_reference, verification_status, note";

    private final JdbcTemplate jdbc;

    public BrandAuthRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Brand> brand(UUID id) {
        List<Brand> rows = jdbc.query("SELECT " + BRAND_COLS + " FROM brand WHERE id = ?", this::mapBrand, id);
        return rows.stream().findFirst();
    }

    public Optional<Brand> brandOwnedBy(UUID brandId, UUID ownerOrganisationId) {
        List<Brand> rows = jdbc.query(
            "SELECT " + BRAND_COLS + " FROM brand WHERE id = ? AND owner_organisation_id = ? AND status = 'active'",
            this::mapBrand, brandId, ownerOrganisationId);
        return rows.stream().findFirst();
    }

    /**
     * Active authorisation for the named agency, brand and principal whose period covers {@code at}.
     * At most one active overlapping period exists per agency and brand (database guard).
     */
    public Optional<AgencyAuthorisation> activeAuthorisation(UUID agencyOrganisationId, UUID brandId,
                                                             UUID principalOrganisationId, LocalDate at) {
        Date d = Date.valueOf(at);
        List<AgencyAuthorisation> rows = jdbc.query(
            "SELECT " + AUTH_COLS + " FROM agency_authorisation WHERE agency_organisation_id = ? AND brand_id = ? "
                + "AND principal_organisation_id = ? AND status = 'active' "
                + "AND valid_from <= ? AND (valid_to IS NULL OR ? < valid_to) ORDER BY valid_from LIMIT 2",
            this::mapAuthorisation, agencyOrganisationId, brandId, principalOrganisationId, d, d);
        if (rows.size() > 1) {
            throw new IllegalStateException("agency_authorisation has overlapping active grants for one agency and brand");
        }
        return rows.stream().findFirst();
    }

    /** Any authorisation row for the agency and principal on a different brand (any status or period). */
    public boolean hasAuthorisationForOtherBrand(UUID agencyOrganisationId, UUID principalOrganisationId, UUID notBrandId) {
        Integer n = jdbc.queryForObject(
            "SELECT count(*) FROM agency_authorisation WHERE agency_organisation_id = ? AND principal_organisation_id = ? "
                + "AND brand_id <> ?",
            Integer.class, agencyOrganisationId, principalOrganisationId, notBrandId);
        return n != null && n > 0;
    }

    /** Latest matching authorisation for agency/brand/principal regardless of status or date (for denial reasons). */
    public Optional<AgencyAuthorisation> latestAuthorisation(UUID agencyOrganisationId, UUID brandId,
                                                             UUID principalOrganisationId) {
        List<AgencyAuthorisation> rows = jdbc.query(
            "SELECT " + AUTH_COLS + " FROM agency_authorisation WHERE agency_organisation_id = ? AND brand_id = ? "
                + "AND principal_organisation_id = ? ORDER BY valid_from DESC, recorded_at DESC LIMIT 1",
            this::mapAuthorisation, agencyOrganisationId, brandId, principalOrganisationId);
        return rows.stream().findFirst();
    }

    public List<AgencyAuthorisation> authorisationsForAgencyAndBrand(UUID agencyOrganisationId, UUID brandId) {
        return jdbc.query(
            "SELECT " + AUTH_COLS + " FROM agency_authorisation WHERE agency_organisation_id = ? AND brand_id = ? "
                + "ORDER BY valid_from, recorded_at",
            this::mapAuthorisation, agencyOrganisationId, brandId);
    }

    private Brand mapBrand(ResultSet rs, int i) throws SQLException {
        return new Brand(rs.getObject("id", UUID.class), rs.getString("name"),
            rs.getObject("owner_organisation_id", UUID.class), rs.getString("status"), provenance(rs));
    }

    private AgencyAuthorisation mapAuthorisation(ResultSet rs, int i) throws SQLException {
        Date to = rs.getDate("valid_to");
        return new AgencyAuthorisation(rs.getObject("id", UUID.class), rs.getObject("agency_organisation_id", UUID.class),
            rs.getObject("principal_organisation_id", UUID.class), rs.getObject("brand_id", UUID.class),
            rs.getDate("valid_from").toLocalDate(), to == null ? null : to.toLocalDate(), rs.getString("status"),
            provenance(rs));
    }

    private static Provenance provenance(ResultSet rs) throws SQLException {
        return new Provenance(rs.getString("source_reference"), Verification.of(rs.getString("verification_status")),
            rs.getString("note"));
    }
}
