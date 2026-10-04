package gov.bee.api.application;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** Persists draft → fee_due submission atomically (WP05.1c). */
@Repository
public class ModelApplicationSubmitRepository {

    public record FeeSnapshotRow(UUID id, BigDecimal amountInr, String currency, String feeRuleKey, int feeRuleVersion,
                                 String verificationStatus, String sourceReference, String note, Instant capturedAt) {
    }

    public record SubmissionResult(ModelApplicationRepository.Row application, UUID eventId, FeeSnapshotRow fee) {
    }

    private final JdbcTemplate jdbc;
    private final ModelApplicationRepository applications;

    public ModelApplicationSubmitRepository(JdbcTemplate jdbc, ModelApplicationRepository applications) {
        this.jdbc = jdbc;
        this.applications = applications;
    }

    public int countSubmissionEvents(UUID applicationId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM model_application_submission_event WHERE application_id = ?", Integer.class, applicationId);
        return n == null ? 0 : n;
    }

    public int countFeeSnapshots(UUID applicationId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM model_application_fee_snapshot WHERE application_id = ?", Integer.class, applicationId);
        return n == null ? 0 : n;
    }

    /** The latest rating record of an application (a local demonstration, never a BEE rating). */
    public record RatingRow(int ratingVersion, String schemeKey, java.math.BigDecimal declaredIseer, java.math.BigDecimal verifiedIseer,
                            int stars, java.time.Instant computedAt) {
    }

    public Optional<RatingRow> findLatestRating(UUID applicationId) {
        return jdbc.query(
            "SELECT rating_version, scheme_key, declared_iseer, verified_iseer, stars, computed_at FROM model_application_rating "
                + "WHERE application_id = ? ORDER BY rating_version DESC LIMIT 1",
            (rs, i) -> new RatingRow(rs.getInt("rating_version"), rs.getString("scheme_key"), rs.getBigDecimal("declared_iseer"),
                rs.getBigDecimal("verified_iseer"), rs.getInt("stars"), rs.getTimestamp("computed_at").toInstant()),
            applicationId).stream().findFirst();
    }

    public Optional<FeeSnapshotRow> findFeeSnapshot(UUID applicationId) {
        var rows = jdbc.query(
            "SELECT id, amount_inr, currency, fee_rule_key, fee_rule_version, verification_status, source_reference, note, captured_at "
                + "FROM model_application_fee_snapshot WHERE application_id = ?",
            (rs, i) -> new FeeSnapshotRow(rs.getObject("id", UUID.class), rs.getBigDecimal("amount_inr"), rs.getString("currency"),
                rs.getString("fee_rule_key"), rs.getInt("fee_rule_version"), rs.getString("verification_status"),
                rs.getString("source_reference"), rs.getString("note"), rs.getTimestamp("captured_at").toInstant()),
            applicationId);
        return rows.stream().findFirst();
    }

    /** Keeps the master versions the evidence check resolved. Runs in the submit transaction, after the state change. */
    public void recordEvidenceSnapshot(UUID applicationId, UUID filingOrganisationId, String accreditationRuleKey,
                                       int accreditationVersion, String standardRuleKey, int standardVersion) {
        jdbc.update(
            "UPDATE model_application SET accreditation_rule_key = ?, accreditation_version = ?, standard_rule_key = ?, standard_version = ? "
                + "WHERE id = ? AND organisation_id = ?",
            accreditationRuleKey, accreditationVersion, standardRuleKey, standardVersion, applicationId, filingOrganisationId);
    }

    @Transactional
    public Optional<SubmissionResult> submit(UUID applicationId, UUID filingOrganisationId, int expectedVersion,
                                             UUID actorAccountId, String actorRole, BigDecimal amountInr, String feeRuleKey,
                                             int feeRuleVersion, String verificationStatus, String sourceReference, String note) {
        int updated = jdbc.update(
            "UPDATE model_application SET state = 'fee_due', version = version + 1 "
                + "WHERE id = ? AND organisation_id = ? AND state = 'draft' AND version = ?",
            applicationId, filingOrganisationId, expectedVersion);
        if (updated != 1) {
            return Optional.empty();
        }
        UUID eventId = UUID.randomUUID();
        int events = jdbc.update(
            "INSERT INTO model_application_submission_event (id, application_id, from_state, to_state, actor_account_id, actor_role, filing_organisation_id) "
                + "VALUES (?, ?, 'draft', 'fee_due', ?, ?, ?)",
            eventId, applicationId, actorAccountId, actorRole, filingOrganisationId);
        if (events != 1) {
            throw new IllegalStateException("submission event not written");
        }
        UUID feeId = UUID.randomUUID();
        int fees = jdbc.update(
            "INSERT INTO model_application_fee_snapshot (id, application_id, submission_event_id, amount_inr, currency, fee_rule_key, fee_rule_version, verification_status, source_reference, note) "
                + "VALUES (?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?)",
            feeId, applicationId, eventId, amountInr, feeRuleKey, feeRuleVersion, verificationStatus, sourceReference, note);
        if (fees != 1) {
            throw new IllegalStateException("fee snapshot not written");
        }
        Optional<ModelApplicationRepository.Row> row = applications.findOwned(applicationId, filingOrganisationId);
        if (row.isEmpty()) {
            return Optional.empty();
        }
        FeeSnapshotRow fee = jdbc.queryForObject(
            "SELECT id, amount_inr, currency, fee_rule_key, fee_rule_version, verification_status, source_reference, note, captured_at "
                + "FROM model_application_fee_snapshot WHERE application_id = ?",
            (rs, i) -> new FeeSnapshotRow(rs.getObject("id", UUID.class), rs.getBigDecimal("amount_inr"), rs.getString("currency"),
                rs.getString("fee_rule_key"), rs.getInt("fee_rule_version"), rs.getString("verification_status"),
                rs.getString("source_reference"), rs.getString("note"), rs.getTimestamp("captured_at").toInstant()),
            applicationId);
        return Optional.of(new SubmissionResult(row.get(), eventId, fee));
    }
}
