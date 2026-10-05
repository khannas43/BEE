package gov.bee.api.feecorrections;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Corrections to a fee confirmation (the receipt reference and the date the money was received). The confirmation itself is
 * append-only and never changes; a correction is a proposal that a second person decides, in one database function (V36), and the
 * effective values are the latest approved correction. Provisional local rules (the owner's assumption B11).
 */
@Repository
public class FeeCorrectionRepository {

    public static final String CAPABILITY = "fee_confirmation_correct";

    /** A confirmation with the values that are in effect now. */
    public record Confirmation(UUID confirmationId, UUID applicationId, String reference, String brand, String modelNumber, String state,
                               String receiptReference, LocalDate receivedOn, BigDecimal amountInr, String confirmedBy, Instant confirmedAt,
                               String correctedReceiptReference, LocalDate correctedReceivedOn, String correctionApprovedBy, Instant correctionApprovedAt,
                               UUID pendingProposalId) {
        public String effectiveReceiptReference() {
            return correctedReceiptReference != null ? correctedReceiptReference : receiptReference;
        }

        public LocalDate effectiveReceivedOn() {
            return correctedReceivedOn != null ? correctedReceivedOn : receivedOn;
        }
    }

    public record Proposal(UUID id, UUID applicationId, String reference, String previousReceiptReference, LocalDate previousReceivedOn, String receiptReference,
                           LocalDate receivedOn, String reason, UUID proposedById, String proposedBy, Instant proposedAt, String state, String decidedBy,
                           Instant decidedAt, String decisionNote) {
    }

    public record NewProposal(UUID applicationId, UUID confirmationId, String previousReceiptReference, LocalDate previousReceivedOn, String receiptReference,
                              LocalDate receivedOn, String reason) {
    }

    public enum Outcome { DONE, NOT_FOUND, NOT_PENDING, NOT_PERMITTED, SAME_PERSON, ONLY_PROPOSER, SEGREGATED }

    public record Decided(Outcome outcome, String state) {
        static Decided of(Outcome o) {
            return new Decided(o, null);
        }
    }

    private static final String CONFIRMATION = "SELECT fc.id, fc.application_id, a.reference, a.brand_name, a.model_number, a.state, fc.receipt_reference, "
        + "fc.received_on, fc.amount_inr, u.display_name AS confirmed_by, fc.confirmed_at, cr.receipt_reference AS corrected_ref, cr.received_on AS corrected_on, "
        + "cd.display_name AS corrected_by, cr.decided_at AS corrected_at, "
        + "(SELECT p.id FROM fee_correction_proposal p WHERE p.fee_confirmation_id = fc.id AND p.state = 'pending') AS pending_id "
        + "FROM model_application_fee_confirmation fc JOIN model_application a ON a.id = fc.application_id "
        + "JOIN user_account u ON u.id = fc.confirmed_by_account_id "
        + "LEFT JOIN LATERAL (SELECT p.* FROM fee_correction_proposal p WHERE p.fee_confirmation_id = fc.id AND p.state = 'approved' ORDER BY p.decided_at DESC LIMIT 1) cr ON true "
        + "LEFT JOIN user_account cd ON cd.id = cr.decided_by";

    private static final String PROPOSAL = "SELECT p.id, p.application_id, a.reference, p.previous_receipt_reference, p.previous_received_on, p.receipt_reference, "
        + "p.received_on, p.reason, p.proposed_by, u.display_name AS proposed_by_name, p.proposed_at, p.state, d.display_name AS decided_by_name, p.decided_at, "
        + "p.decision_note FROM fee_correction_proposal p JOIN model_application a ON a.id = p.application_id JOIN user_account u ON u.id = p.proposed_by "
        + "LEFT JOIN user_account d ON d.id = p.decided_by";

    private final JdbcTemplate jdbc;

    public FeeCorrectionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Set<String> rolesHolding(String capability) {
        return Set.copyOf(jdbc.queryForList("SELECT role FROM capability_grant WHERE capability = ?", String.class, capability));
    }

    /** The most recently confirmed fees, newest first. */
    public List<Confirmation> recentConfirmations(int limit) {
        return jdbc.query(CONFIRMATION + " ORDER BY fc.confirmed_at DESC LIMIT " + Math.max(1, Math.min(limit, 100)), this::mapConfirmation);
    }

    public Optional<Confirmation> confirmationOf(UUID applicationId) {
        return jdbc.query(CONFIRMATION + " WHERE fc.application_id = ?", this::mapConfirmation, applicationId).stream().findFirst();
    }

    /** True when the person belongs to the paying organisation or acted on the application at a stage other than the fee. */
    public boolean segregated(UUID applicationId, UUID accountId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT fee_correction_segregated(?, ?)", Boolean.class, applicationId, accountId));
    }

    public List<Proposal> pending() {
        return jdbc.query(PROPOSAL + " WHERE p.state = 'pending' ORDER BY p.proposed_at", this::mapProposal);
    }

    public List<Proposal> recentDecided(int limit) {
        return jdbc.query(PROPOSAL + " WHERE p.state <> 'pending' ORDER BY p.decided_at DESC LIMIT " + Math.max(1, Math.min(limit, 100)), this::mapProposal);
    }

    public Optional<Proposal> proposal(UUID id) {
        return jdbc.query(PROPOSAL + " WHERE p.id = ?", this::mapProposal, id).stream().findFirst();
    }

    public Proposal insert(UUID proposerAccountId, NewProposal p) {
        UUID id = jdbc.queryForObject(
            "INSERT INTO fee_correction_proposal (application_id, fee_confirmation_id, previous_receipt_reference, previous_received_on, receipt_reference, received_on, reason, proposed_by) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id", UUID.class,
            p.applicationId(), p.confirmationId(), p.previousReceiptReference(), Date.valueOf(p.previousReceivedOn()), p.receiptReference(), Date.valueOf(p.receivedOn()),
            p.reason(), proposerAccountId);
        return proposal(id).orElseThrow();
    }

    /** Approve, reject or withdraw. A refusal comes back as a result (not an error), so the surrounding transaction stays usable. */
    public Decided decide(UUID proposalId, UUID deciderAccountId, String decision, String note) {
        return jdbc.query("SELECT out_state FROM fee_correction_decide(?, ?, ?, ?)", rs -> {
            rs.next();
            String state = rs.getString("out_state");
            if (state.equals("approved") || state.equals("rejected") || state.equals("withdrawn")) {
                return new Decided(Outcome.DONE, state);
            }
            return Decided.of(Outcome.valueOf(state.toUpperCase()));
        }, proposalId, deciderAccountId, decision, note);
    }

    private Confirmation mapConfirmation(ResultSet rs, int i) throws SQLException {
        Date correctedOn = rs.getDate("corrected_on");
        java.sql.Timestamp correctedAt = rs.getTimestamp("corrected_at");
        return new Confirmation(rs.getObject("id", UUID.class), rs.getObject("application_id", UUID.class), rs.getString("reference"), rs.getString("brand_name"),
            rs.getString("model_number"), rs.getString("state"), rs.getString("receipt_reference"), rs.getDate("received_on").toLocalDate(), rs.getBigDecimal("amount_inr"),
            rs.getString("confirmed_by"), rs.getTimestamp("confirmed_at").toInstant(), rs.getString("corrected_ref"), correctedOn == null ? null : correctedOn.toLocalDate(),
            rs.getString("corrected_by"), correctedAt == null ? null : correctedAt.toInstant(), rs.getObject("pending_id", UUID.class));
    }

    private Proposal mapProposal(ResultSet rs, int i) throws SQLException {
        java.sql.Timestamp d = rs.getTimestamp("decided_at");
        return new Proposal(rs.getObject("id", UUID.class), rs.getObject("application_id", UUID.class), rs.getString("reference"), rs.getString("previous_receipt_reference"),
            rs.getDate("previous_received_on").toLocalDate(), rs.getString("receipt_reference"), rs.getDate("received_on").toLocalDate(), rs.getString("reason"),
            rs.getObject("proposed_by", UUID.class), rs.getString("proposed_by_name"), rs.getTimestamp("proposed_at").toInstant(), rs.getString("state"),
            rs.getString("decided_by_name"), d == null ? null : d.toInstant(), rs.getString("decision_note"));
    }
}
