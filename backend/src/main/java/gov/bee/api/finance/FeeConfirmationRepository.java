package gov.bee.api.finance;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * First slice step 2 (Finance confirms the fee received, fee_due to iame_scrutiny). The state change, the append-only
 * transition event, the fee confirmation record and the assignment of the next officer commit together or not at all.
 */
@Repository
public class FeeConfirmationRepository {

    public static final String FROM_STATE = "fee_due";
    public static final String TO_STATE = "iame_scrutiny";
    public static final String ACTION = "confirm_fee";

    public enum Outcome { CONFIRMED, STALE, NO_ASSIGNEE }

    public record Result(Outcome outcome, int versionAfter, Instant confirmedAt) {
        static Result of(Outcome outcome) {
            return new Result(outcome, 0, null);
        }
    }

    private final JdbcTemplate jdbc;

    public FeeConfirmationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Accounts that already acted on this application (it was submitted by one, or earlier steps were done by others). */
    public Set<UUID> actorsAtOtherStages(UUID applicationId) {
        List<UUID> rows = jdbc.queryForList(
            "SELECT actor_account_id FROM model_application_submission_event WHERE application_id = ? "
                + "UNION SELECT actor_account_id FROM model_application_transition_event WHERE application_id = ?",
            UUID.class, applicationId, applicationId);
        return new HashSet<>(rows);
    }

    /**
     * Provisional rule D2 (not a BEE rule): the next officer is the active IAME account with the fewest open assignments at this
     * stage, ties broken by account id. Empty when no IAME officer is available, in which case nothing is written.
     */
    Optional<UUID> nextIameOfficer() {
        return jdbc.queryForList(
            "SELECT u.id FROM user_account u JOIN role_assignment r ON r.user_id = u.id "
                + "WHERE r.role = 'iame' AND r.scope = 'assigned' AND r.active AND now() BETWEEN r.valid_from AND r.valid_to "
                + "AND u.status = 'active' "
                + "ORDER BY (SELECT count(*) FROM assignment a WHERE a.user_id = u.id AND a.stage = 'iame_scrutiny' AND a.active), u.id LIMIT 1",
            UUID.class).stream().findFirst();
    }

    @Transactional
    public Result confirm(UUID applicationId, int expectedVersion, UUID actorAccountId, String actorRole, UUID feeSnapshotId,
                          BigDecimal amountInr, String receiptReference, LocalDate receivedOn) {
        Optional<UUID> officer = nextIameOfficer();
        if (officer.isEmpty()) {
            return Result.of(Outcome.NO_ASSIGNEE);
        }
        int updated = jdbc.update(
            "UPDATE model_application SET state = ?, version = version + 1 WHERE id = ? AND state = ? AND version = ?",
            TO_STATE, applicationId, FROM_STATE, expectedVersion);
        if (updated != 1) {
            return Result.of(Outcome.STALE);
        }
        int versionAfter = expectedVersion + 1;
        UUID eventId = UUID.randomUUID();
        Timestamp at = jdbc.queryForObject(
            "INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING occurred_at",
            Timestamp.class, eventId, applicationId, ACTION, FROM_STATE, TO_STATE, actorAccountId, actorRole, versionAfter);
        jdbc.update(
            "INSERT INTO model_application_fee_confirmation (id, application_id, transition_event_id, fee_snapshot_id, amount_inr, "
                + "receipt_reference, received_on, confirmed_by_account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            UUID.randomUUID(), applicationId, eventId, feeSnapshotId, amountInr, receiptReference, java.sql.Date.valueOf(receivedOn), actorAccountId);
        jdbc.update(
            "INSERT INTO assignment (user_id, subject_type, subject_id, stage, active) VALUES (?, 'model_application', ?, ?, true)",
            officer.get(), applicationId, TO_STATE);
        return new Result(Outcome.CONFIRMED, versionAfter, at.toInstant());
    }
}
