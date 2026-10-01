package gov.bee.api.masters;

import java.time.LocalDate;
import java.util.UUID;

/**
 * The shared columns of one immutable master version. The period is half-open:
 * the version applies on {@code effectiveFrom} and not on {@code effectiveTo};
 * a null {@code effectiveTo} is open-ended.
 */
public record MasterVersion(UUID id, String ruleKey, int version, LocalDate effectiveFrom, LocalDate effectiveTo,
                            String sourceReference, Verification verification, String note, String legacyId) {

    /** synthetic: made up locally; provisional: cited but not confirmed by BEE; verified: confirmed by BEE. */
    public enum Verification {
        SYNTHETIC, PROVISIONAL, VERIFIED;

        static Verification of(String db) {
            return valueOf(db.toUpperCase());
        }
    }

    public boolean appliesOn(LocalDate date) {
        return !date.isBefore(effectiveFrom) && (effectiveTo == null || date.isBefore(effectiveTo));
    }

    /** True only for a BEE-confirmed version; no seeded version is. */
    public boolean beeVerified() {
        return verification == Verification.VERIFIED;
    }
}
