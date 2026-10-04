package gov.bee.api.masters;

import java.math.BigDecimal;

/** Typed master versions (V4__effective_dated_masters.sql). */
public final class Masters {

    private Masters() {
    }

    public record Category(MasterVersion version, String code, String name) {
    }

    public record Standard(MasterVersion version, String categoryCode, String purpose, String standardCode, String title, String edition) {
    }

    public record LabAccreditation(MasterVersion version, String laboratoryCode, String categoryCode, String accreditationBody,
                                   String certificateRef, String status) {
        public boolean active() {
            return "active".equals(status);
        }
    }

    /** A fee amount. Not a BEE-approved fee unless {@code version().beeVerified()}; none is today. */
    public record FeeRule(MasterVersion version, String categoryCode, String applicationType, BigDecimal amountInr) {
    }

    /**
     * Rating-formula metadata only. There is deliberately no compute method: WP05.2 owns
     * the computation, and the database refuses {@code computationAllowed} for any
     * version that is not BEE-verified.
     */
    public record RatingFormula(MasterVersion version, String categoryCode, String formulaLabel, String inputsJson,
                                String definitionJson, boolean computationAllowed) {
    }
}
