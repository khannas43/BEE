package gov.bee.api.reviewer;

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
 * First slice step 4 (the assigned Reviewer verifies and forwards, bee_scrutiny to rating). The state change, the
 * append-only transition event, the forward record and the closing of the reviewer's assignment commit together or not
 * at all. Programme reads the rating stage by role, so no next officer is assigned.
 */
@Repository
public class ReviewerForwardRepository {

    public static final String FROM_STATE = "bee_scrutiny";
    public static final String TO_STATE = "rating";
    public static final String ACTION = "reviewer_forward";

    public enum Outcome { FORWARDED, STALE }

    public record Result(Outcome outcome, int versionAfter, Instant forwardedAt) {
        static Result of(Outcome outcome) {
            return new Result(outcome, 0, null);
        }
    }

    private final JdbcTemplate jdbc;

    public ReviewerForwardRepository(JdbcTemplate jdbc) {
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
    public Result forward(UUID applicationId, int expectedVersion, UUID actorAccountId, String actorRole, String note) {
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
            "INSERT INTO model_application_reviewer_forward (id, application_id, transition_event_id, note, forwarded_by_account_id) VALUES (?, ?, ?, ?, ?)",
            UUID.randomUUID(), applicationId, eventId, note, actorAccountId);
        jdbc.update(
            "UPDATE assignment SET active = false WHERE subject_type = 'model_application' AND subject_id = ? AND stage = ? AND user_id = ? AND active",
            applicationId, FROM_STATE, actorAccountId);
        return new Result(Outcome.FORWARDED, versionAfter, at.toInstant());
    }
}
