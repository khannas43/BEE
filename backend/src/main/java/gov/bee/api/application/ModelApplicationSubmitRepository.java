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
                                 String verificationStatus, String sourceReference, String note, Instant capturedAt,
                                 BigDecimal taxRatePercent, BigDecimal taxInr, BigDecimal totalInr) {
        /** A snapshot with no tax line: tax 0, total equal to the amount. */
        public FeeSnapshotRow(UUID id, BigDecimal amountInr, String currency, String feeRuleKey, int feeRuleVersion,
                              String verificationStatus, String sourceReference, String note, Instant capturedAt) {
            this(id, amountInr, currency, feeRuleKey, feeRuleVersion, verificationStatus, sourceReference, note, capturedAt,
                BigDecimal.ZERO.setScale(2), BigDecimal.ZERO.setScale(2), amountInr);
        }
    }

    private static final String SNAPSHOT_COLUMNS =
        "id, amount_inr, currency, fee_rule_key, fee_rule_version, verification_status, source_reference, note, captured_at, tax_rate_percent, tax_inr, total_inr";

    private static FeeSnapshotRow snapshot(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new FeeSnapshotRow(rs.getObject("id", UUID.class), rs.getBigDecimal("amount_inr"), rs.getString("currency"),
            rs.getString("fee_rule_key"), rs.getInt("fee_rule_version"), rs.getString("verification_status"),
            rs.getString("source_reference"), rs.getString("note"), rs.getTimestamp("captured_at").toInstant(),
            rs.getBigDecimal("tax_rate_percent"), rs.getBigDecimal("tax_inr"), rs.getBigDecimal("total_inr"));
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

    /** The open return of an application (the latest return that no resubmission has answered). */
    public record ReturnRow(String fromState, String reason, java.time.Instant returnedAt) {
    }

    public Optional<ReturnRow> findOpenReturn(UUID applicationId) {
        return jdbc.query(
            "SELECT r.returned_from_state, r.reason, r.returned_at FROM model_application_return r "
                + "LEFT JOIN model_application_resubmission s ON s.return_id = r.id "
                + "WHERE r.application_id = ? AND s.id IS NULL ORDER BY r.returned_at DESC LIMIT 1",
            (rs, i) -> new ReturnRow(rs.getString("returned_from_state"), rs.getString("reason"), rs.getTimestamp("returned_at").toInstant()),
            applicationId).stream().findFirst();
    }

    /** The permanent rejection of an application (one per application; rejected is terminal). */
    public record RejectionRow(String fromState, String reason, java.time.Instant rejectedAt) {
    }

    public Optional<RejectionRow> findRejection(UUID applicationId) {
        return jdbc.query(
            "SELECT rejected_from_state, reason, rejected_at FROM model_application_rejection WHERE application_id = ?",
            (rs, i) -> new RejectionRow(rs.getString("rejected_from_state"), rs.getString("reason"), rs.getTimestamp("rejected_at").toInstant()),
            applicationId).stream().findFirst();
    }

    /** The certificate issued when the application was approved (a local demonstration, never a BEE certificate). */
    public record CertificateRow(String registrationId, java.time.LocalDate validFrom, java.time.LocalDate validTo, int stars,
                                 java.math.BigDecimal declaredIseer, java.math.BigDecimal verifiedIseer, String schemeKey, java.time.Instant issuedAt) {
    }

    public Optional<CertificateRow> findCertificate(UUID applicationId) {
        return jdbc.query(
            "SELECT registration_id, valid_from, valid_to, stars, declared_iseer, verified_iseer, scheme_key, issued_at FROM certificate WHERE application_id = ?",
            (rs, i) -> new CertificateRow(rs.getString("registration_id"), rs.getDate("valid_from").toLocalDate(), rs.getDate("valid_to").toLocalDate(), rs.getInt("stars"),
                rs.getBigDecimal("declared_iseer"), rs.getBigDecimal("verified_iseer"), rs.getString("scheme_key"), rs.getTimestamp("issued_at").toInstant()),
            applicationId).stream().findFirst();
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
        var rows = jdbc.query("SELECT " + SNAPSHOT_COLUMNS + " FROM model_application_fee_snapshot WHERE application_id = ?", ModelApplicationSubmitRepository::snapshot, applicationId);
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

    /** Submits with no tax line (rate 0). */
    public Optional<SubmissionResult> submit(UUID applicationId, UUID filingOrganisationId, int expectedVersion,
                                             UUID actorAccountId, String actorRole, BigDecimal amountInr, String feeRuleKey,
                                             int feeRuleVersion, String verificationStatus, String sourceReference, String note) {
        return submit(applicationId, filingOrganisationId, expectedVersion, actorAccountId, actorRole, amountInr, BigDecimal.ZERO, feeRuleKey,
            feeRuleVersion, verificationStatus, sourceReference, note);
    }

    @Transactional
    public Optional<SubmissionResult> submit(UUID applicationId, UUID filingOrganisationId, int expectedVersion,
                                             UUID actorAccountId, String actorRole, BigDecimal amountInr, BigDecimal taxRatePercent, String feeRuleKey,
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
            "INSERT INTO model_application_fee_snapshot (id, application_id, submission_event_id, amount_inr, tax_rate_percent, currency, fee_rule_key, fee_rule_version, verification_status, source_reference, note) "
                + "VALUES (?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?)",
            feeId, applicationId, eventId, amountInr, taxRatePercent, feeRuleKey, feeRuleVersion, verificationStatus, sourceReference, note);
        if (fees != 1) {
            throw new IllegalStateException("fee snapshot not written");
        }
        Optional<ModelApplicationRepository.Row> row = applications.findOwned(applicationId, filingOrganisationId);
        if (row.isEmpty()) {
            return Optional.empty();
        }
        FeeSnapshotRow fee = jdbc.queryForObject("SELECT " + SNAPSHOT_COLUMNS + " FROM model_application_fee_snapshot WHERE application_id = ?", ModelApplicationSubmitRepository::snapshot, applicationId);
        return Optional.of(new SubmissionResult(row.get(), eventId, fee));
    }
}
