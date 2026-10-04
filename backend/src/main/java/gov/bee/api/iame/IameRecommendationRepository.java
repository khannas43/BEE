package gov.bee.api.iame;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * First slice step 3 (the assigned IAME officer records a verification and recommends forwarding, iame_scrutiny to
 * bee_scrutiny). The state change, the append-only transition event, the recommendation record, the closing of the
 * officer's assignment and the assignment of the next reviewer commit together or not at all.
 */
@Repository
public class IameRecommendationRepository {

    public static final String FROM_STATE = "iame_scrutiny";
    public static final String TO_STATE = "bee_scrutiny";
    public static final String ACTION = "iame_recommend";

    public enum Outcome { RECOMMENDED, STALE, NO_ASSIGNEE }

    public record Result(Outcome outcome, int versionAfter, Instant recommendedAt) {
        static Result of(Outcome outcome) {
            return new Result(outcome, 0, null);
        }
    }

    private final JdbcTemplate jdbc;

    public IameRecommendationRepository(JdbcTemplate jdbc) {
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

    /**
     * Provisional rule D2 (not a BEE rule): the next reviewer is the active reviewer account with the fewest open
     * bee_scrutiny assignments, ties broken by account id. Empty when no reviewer is available, in which case nothing is written.
     */
    Optional<UUID> nextReviewer() {
        return jdbc.queryForList(
            "SELECT u.id FROM user_account u JOIN role_assignment r ON r.user_id = u.id "
                + "WHERE r.role = 'reviewer' AND r.scope = 'assigned' AND r.active AND now() BETWEEN r.valid_from AND r.valid_to "
                + "AND u.status = 'active' "
                + "ORDER BY (SELECT count(*) FROM assignment a WHERE a.user_id = u.id AND a.stage = 'bee_scrutiny' AND a.active), u.id LIMIT 1",
            UUID.class).stream().findFirst();
    }

    @Transactional
    public Result recommend(UUID applicationId, int expectedVersion, UUID actorAccountId, String actorRole, String verification, String note) {
        Optional<UUID> reviewer = nextReviewer();
        if (reviewer.isEmpty()) {
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
            "INSERT INTO model_application_iame_recommendation (id, application_id, transition_event_id, verification, note, recommended_by_account_id) "
                + "VALUES (?, ?, ?, ?, ?, ?)",
            UUID.randomUUID(), applicationId, eventId, verification, note, actorAccountId);
        jdbc.update(
            "UPDATE assignment SET active = false WHERE subject_type = 'model_application' AND subject_id = ? AND stage = ? AND user_id = ? AND active",
            applicationId, FROM_STATE, actorAccountId);
        jdbc.update(
            "INSERT INTO assignment (user_id, subject_type, subject_id, stage, active) VALUES (?, 'model_application', ?, ?, true)",
            reviewer.get(), applicationId, TO_STATE);
        return new Result(Outcome.RECOMMENDED, versionAfter, at.toInstant());
    }
}
