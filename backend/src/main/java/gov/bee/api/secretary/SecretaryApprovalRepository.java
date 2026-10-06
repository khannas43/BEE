package gov.bee.api.secretary;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * First slice step 7 (the Secretary gives final approval, secretary_approval to approved, the end of the first slice).
 * The state change, the append-only transition event and the approval record commit together or not at all. The
 * Secretary reads their stage by role, so no assignment is made or closed.
 */
@Repository
public class SecretaryApprovalRepository {

    public static final String FROM_STATE = "secretary_approval";
    public static final String TO_STATE = "approved";
    public static final String ACTION = "secretary_approve";

    public enum Outcome { APPROVED, STALE }

    public record Result(Outcome outcome, int versionAfter, Instant approvedAt) {
        static Result of(Outcome outcome) {
            return new Result(outcome, 0, null);
        }
    }

    private final JdbcTemplate jdbc;

    public SecretaryApprovalRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Accounts that already acted on this application at another stage (it was submitted by one, or earlier steps were done by
     * others). An earlier action at this same stage does not count, so a person may act again after a return or a re-rating.
     */
    public Set<UUID> actorsAtOtherStages(UUID applicationId) {
        List<UUID> rows = jdbc.queryForList(
            "SELECT actor_account_id FROM model_application_submission_event WHERE application_id = ? "
                + "UNION SELECT actor_account_id FROM model_application_transition_event WHERE application_id = ? AND from_state <> ?",
            UUID.class, applicationId, applicationId, FROM_STATE);
        return new HashSet<>(rows);
    }

    @Transactional
    public Result approve(UUID applicationId, int expectedVersion, UUID actorAccountId, String actorRole, String note) {
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
            "INSERT INTO model_application_secretary_approval (id, application_id, transition_event_id, note, approved_by_account_id) VALUES (?, ?, ?, ?, ?)",
            UUID.randomUUID(), applicationId, eventId, note, actorAccountId);
        // The certificate is issued in this same transaction; if it cannot be, the approval does not happen.
        jdbc.queryForObject("SELECT issue_certificate(?, ?, ?)", String.class, applicationId, eventId, actorAccountId);
        return new Result(Outcome.APPROVED, versionAfter, at.toInstant());
    }
}
