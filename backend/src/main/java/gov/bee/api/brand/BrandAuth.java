package gov.bee.api.brand;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Typed brand ownership and agency authorisation rows (V6__brand_agency_authorisation.sql).
 * Nothing here is BEE-approved unless {@link Provenance#beeVerified()} is true; seeded rows
 * are synthetic.
 */
public final class BrandAuth {

    private BrandAuth() {
    }

    public enum Verification {
        SYNTHETIC, PROVISIONAL, VERIFIED;

        static Verification of(String raw) {
            return Verification.valueOf(raw.toUpperCase());
        }
    }

    public record Provenance(String sourceReference, Verification verification, String note) {
        public boolean beeVerified() {
            return verification == Verification.VERIFIED;
        }
    }

    public record Brand(UUID id, String name, UUID ownerOrganisationId, String status, Provenance provenance) {
        public boolean active() {
            return "active".equals(status);
        }
    }

    public record AgencyAuthorisation(UUID id, UUID agencyOrganisationId, UUID principalOrganisationId, UUID brandId,
                                      LocalDate validFrom, LocalDate validTo, String status, Provenance provenance) {
        public boolean activeStatus() {
            return "active".equals(status);
        }

        /** Half-open [validFrom, validTo): applies on validFrom, not on validTo; null validTo is open-ended. */
        public boolean covers(LocalDate at) {
            return !at.isBefore(validFrom) && (validTo == null || at.isBefore(validTo));
        }
    }
}
