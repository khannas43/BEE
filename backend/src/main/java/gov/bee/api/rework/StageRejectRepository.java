package gov.bee.api.rework;

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
 * A stage owner rejects an application permanently, with a reason (FIRST_SLICE.md section 4). Rejected is terminal: the
 * state change, the append-only transition event and the rejection record commit together or not at all, and every open
 * assignment of the application is closed because nobody has anything left to do with it. The model number is freed for
 * a new application because the one-live-application-per-model index already ignores rejected applications.
 */
@Repository
public class StageRejectRepository {

    public static final String TO_STATE = "rejected";
    public static final String ACTION = "reject";

    public enum Outcome { REJECTED, STALE }

    public record Result(Outcome outcome, int versionAfter, Instant rejectedAt) {
        static Result of(Outcome outcome) {
            return new Result(outcome, 0, null);
        }
    }

    private final JdbcTemplate jdbc;

    public StageRejectRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Accounts that acted on this application at a stage other than the given one; an earlier action at the same stage does not count. */
    public Set<UUID> actorsAtOtherStages(UUID applicationId, String stage) {
        List<UUID> rows = jdbc.queryForList(
            "SELECT actor_account_id FROM model_application_submission_event WHERE application_id = ? "
                + "UNION SELECT actor_account_id FROM model_application_transition_event WHERE application_id = ? AND from_state <> ?",
            UUID.class, applicationId, applicationId, stage);
        return new HashSet<>(rows);
    }

    @Transactional
    public Result doReject(UUID applicationId, int expectedVersion, UUID actorAccountId, String actorRole, String fromState, String reason) {
        int updated = jdbc.update(
            "UPDATE model_application SET state = ?, version = version + 1 WHERE id = ? AND state = ? AND version = ?",
            TO_STATE, applicationId, fromState, expectedVersion);
        if (updated != 1) {
            return Result.of(Outcome.STALE);
        }
        int versionAfter = expectedVersion + 1;
        UUID eventId = UUID.randomUUID();
        Timestamp at = jdbc.queryForObject(
            "INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING occurred_at",
            Timestamp.class, eventId, applicationId, ACTION, fromState, TO_STATE, actorAccountId, actorRole, versionAfter);
        jdbc.update(
            "INSERT INTO model_application_rejection (id, application_id, transition_event_id, rejected_from_state, reason, rejected_by_account_id) "
                + "VALUES (?, ?, ?, ?, ?, ?)",
            UUID.randomUUID(), applicationId, eventId, fromState, reason, actorAccountId);
        jdbc.update("UPDATE assignment SET active = false WHERE subject_type = 'model_application' AND subject_id = ? AND active", applicationId);
        return new Result(Outcome.REJECTED, versionAfter, at.toInstant());
    }
}
