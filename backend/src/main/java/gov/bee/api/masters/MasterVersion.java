package gov.bee.api.masters;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * The shared columns of one immutable master version. The period is half-open:
 * the version applies on {@code effectiveFrom} and not on {@code effectiveUntil()}.
 * {@code effectiveTo} is the end recorded with the version (null: open-ended); a later
 * {@link Closure} can end an open-ended version without changing the version row.
 */
public record MasterVersion(UUID id, String ruleKey, int version, LocalDate effectiveFrom, LocalDate effectiveTo,
                            String sourceReference, Verification verification, String note, String legacyId, Closure closure) {

    /** synthetic: made up locally; provisional: cited but not confirmed by BEE; verified: confirmed by BEE. */
    public enum Verification {
        SYNTHETIC, PROVISIONAL, VERIFIED;

        static Verification of(String db) {
            return valueOf(db.toUpperCase());
        }
    }

    /** Who ended an open-ended version, on what authority and why; {@code successorVersion} starts on {@code effectiveTo}. */
    public record Closure(LocalDate effectiveTo, int successorVersion, String closedBy, String sourceReference, String reason, Instant recordedAt) {
    }

    /** The first date this version no longer applies, or null if it is still open-ended. */
    public LocalDate effectiveUntil() {
        return closure != null ? closure.effectiveTo() : effectiveTo;
    }

    public boolean appliesOn(LocalDate date) {
        LocalDate until = effectiveUntil();
        return !date.isBefore(effectiveFrom) && (until == null || date.isBefore(until));
    }

    /** True only for a BEE-confirmed version; no seeded version is. */
    public boolean beeVerified() {
        return verification == Verification.VERIFIED;
    }
}
