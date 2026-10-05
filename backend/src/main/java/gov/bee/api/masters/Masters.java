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
    public record FeeRule(MasterVersion version, String categoryCode, String applicationType, BigDecimal amountInr, BigDecimal taxRatePercent) {
        /** A fee rule with no tax line (rate 0), as every rule was before the tax line existed. */
        public FeeRule(MasterVersion version, String categoryCode, String applicationType, BigDecimal amountInr) {
            this(version, categoryCode, applicationType, amountInr, BigDecimal.ZERO.setScale(2));
        }

        /** Tax = amount x rate / 100, rounded half up to the paisa. The database derives the same figure for the snapshot. */
        public BigDecimal taxInr() {
            return amountInr.multiply(taxRatePercent).divide(BigDecimal.valueOf(100), 2, java.math.RoundingMode.HALF_UP);
        }

        public BigDecimal totalInr() {
            return amountInr.add(taxInr());
        }
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
