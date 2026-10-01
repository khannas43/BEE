package gov.bee.api.brand;

import gov.bee.api.brand.BrandAuth.AgencyAuthorisation;
import gov.bee.api.brand.BrandAuth.Brand;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Resolves brand ownership and agency authorisation at an explicit calendar date (IST; the
 * caller converts any instant). Scopes a grant to the named brand and principal, requires
 * that brand ownership matches the principal, and uses half-open [from, to) periods.
 * Returns a denial for missing, expired, revoked or wrong-brand records.
 *
 * <p>Internal only: no controller, permission, registration workflow or model-application
 * policy uses this yet. Ownership of a brand does <strong>not</strong> grant the owner
 * read access to agency-filed model applications (WP02.2 policy; visibility remains a
 * later reviewed rule).
 */
@Service
public class BrandAuthService {

    public enum Outcome {
        AUTHORISED,
        NO_AUTHORISATION,
        EXPIRED,
        REVOKED,
        WRONG_BRAND,
        PRINCIPAL_MISMATCH,
        BRAND_INACTIVE
    }

    public record Decision(Outcome outcome, Optional<Brand> brand, Optional<AgencyAuthorisation> authorisation) {
        public boolean authorised() {
            return outcome == Outcome.AUTHORISED;
        }
    }

    private final BrandAuthRepository repository;

    public BrandAuthService(BrandAuthRepository repository) {
        this.repository = repository;
    }

    /** Active brand owned by the organisation, if any. */
    public Optional<Brand> ownedBrand(UUID brandId, UUID ownerOrganisationId) {
        return repository.brandOwnedBy(brandId, ownerOrganisationId);
    }

    /**
     * Whether the agency is authorised for the named brand and principal on {@code at}.
     * Wrong-brand, expired, revoked, missing and principal/ownership mismatches deny.
     */
    public Decision agencyAuthorisation(UUID agencyOrganisationId, UUID brandId, UUID principalOrganisationId,
                                        LocalDate at) {
        Optional<Brand> brand = repository.brand(brandId);
        if (brand.isEmpty()) {
            if (repository.hasAuthorisationForOtherBrand(agencyOrganisationId, principalOrganisationId, brandId)) {
                return deny(Outcome.WRONG_BRAND, Optional.empty(), Optional.empty());
            }
            return deny(Outcome.NO_AUTHORISATION, Optional.empty(), Optional.empty());
        }
        Brand b = brand.get();
        if (!b.ownerOrganisationId().equals(principalOrganisationId)) {
            return deny(Outcome.PRINCIPAL_MISMATCH, brand, Optional.empty());
        }
        if (!b.active()) {
            return deny(Outcome.BRAND_INACTIVE, brand, Optional.empty());
        }
        Optional<AgencyAuthorisation> active = repository.activeAuthorisation(
            agencyOrganisationId, brandId, principalOrganisationId, at);
        if (active.isPresent()) {
            return new Decision(Outcome.AUTHORISED, brand, active);
        }
        Optional<AgencyAuthorisation> latest = repository.latestAuthorisation(
            agencyOrganisationId, brandId, principalOrganisationId);
        if (latest.isEmpty()) {
            if (repository.hasAuthorisationForOtherBrand(agencyOrganisationId, principalOrganisationId, brandId)) {
                return deny(Outcome.WRONG_BRAND, brand, Optional.empty());
            }
            return deny(Outcome.NO_AUTHORISATION, brand, Optional.empty());
        }
        AgencyAuthorisation row = latest.get();
        if ("revoked".equals(row.status())) {
            return deny(Outcome.REVOKED, brand, latest);
        }
        if (!row.covers(at)) {
            return deny(Outcome.EXPIRED, brand, latest);
        }
        return deny(Outcome.NO_AUTHORISATION, brand, latest);
    }

    private static Decision deny(Outcome outcome, Optional<Brand> brand, Optional<AgencyAuthorisation> auth) {
        return new Decision(outcome, brand, auth);
    }
}
