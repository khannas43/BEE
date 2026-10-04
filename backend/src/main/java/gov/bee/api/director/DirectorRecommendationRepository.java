package gov.bee.api.director;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * First slice step 6 (the Program Director reviews the rating and recommends approval). The state change, the append-only
 * transition event and the recommendation record commit together or not at all. PROVISIONAL LOCAL ASSUMPTION (decision
 * D1, chosen by the owner, not by BEE): the recommendation is final for the categories whose latest director_final_rule
 * row says so, and then the application goes straight to approved; otherwise it goes to the Secretary. The Secretary reads
 * their stage by role, so no officer is assigned.
 */
@Repository
public class DirectorRecommendationRepository {

    public static final String FROM_STATE = "director_review";
    public static final String TO_SECRETARY = "secretary_approval";
    public static final String TO_APPROVED = "approved";
    public static final String ACTION = "director_recommend";

    public enum Outcome { RECOMMENDED, STALE }

    public record Result(Outcome outcome, int versionAfter, String toState, Instant recommendedAt) {
        static Result of(Outcome outcome) {
            return new Result(outcome, 0, null, null);
        }
    }

    private final JdbcTemplate jdbc;

    public DirectorRecommendationRepository(JdbcTemplate jdbc) {
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

    /** Whether the Director's recommendation is final for the category on that date; false when no rule has started (fail safe). */
    public boolean directorFinal(String category, LocalDate at) {
        List<Boolean> rows = jdbc.queryForList(
            "SELECT director_final FROM director_final_rule WHERE category_code = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1",
            Boolean.class, category, java.sql.Date.valueOf(at));
        return !rows.isEmpty() && rows.get(0);
    }

    @Transactional
    public Result recommend(UUID applicationId, int expectedVersion, UUID actorAccountId, String actorRole, String note, boolean directorFinal) {
        String toState = directorFinal ? TO_APPROVED : TO_SECRETARY;
        int updated = jdbc.update(
            "UPDATE model_application SET state = ?, version = version + 1 WHERE id = ? AND state = ? AND version = ?",
            toState, applicationId, FROM_STATE, expectedVersion);
        if (updated != 1) {
            return Result.of(Outcome.STALE);
        }
        int versionAfter = expectedVersion + 1;
        UUID eventId = UUID.randomUUID();
        Timestamp at = jdbc.queryForObject(
            "INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING occurred_at",
            Timestamp.class, eventId, applicationId, ACTION, FROM_STATE, toState, actorAccountId, actorRole, versionAfter);
        jdbc.update(
            "INSERT INTO model_application_director_recommendation (id, application_id, transition_event_id, note, director_final, resulting_state, "
                + "recommended_by_account_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
            UUID.randomUUID(), applicationId, eventId, note, directorFinal, toState, actorAccountId);
        return new Result(Outcome.RECOMMENDED, versionAfter, toState, at.toInstant());
    }
}
