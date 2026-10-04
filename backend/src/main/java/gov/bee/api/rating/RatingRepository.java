package gov.bee.api.rating;

import java.math.BigDecimal;
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
 * First slice step 5 (Programme computes and records the star rating, rating to director_review). The state change, the
 * append-only transition event and the versioned rating record commit together or not at all. PROVISIONAL LOCAL
 * DEMONSTRATION: the bands come from rating_demo_band, not from a BEE-approved formula (decision A2 is unanswered), and
 * every record says so. Directors read the next stage by role, so no officer is assigned.
 */
@Repository
public class RatingRepository {

    public static final String FROM_STATE = "rating";
    public static final String TO_STATE = "director_review";
    public static final String ACTION = "compute_rating";
    public static final String BASIS = "local_demo";

    public enum Outcome { COMPUTED, STALE }

    public record Result(Outcome outcome, int versionAfter, int ratingVersion, Instant computedAt) {
        static Result of(Outcome outcome) {
            return new Result(outcome, 0, 0, null);
        }
    }

    /** One band of the scheme in force: the lowest efficiency figure that earns these stars. */
    public record Band(String schemeKey, int stars, BigDecimal minIseer) {
    }

    private final JdbcTemplate jdbc;

    public RatingRepository(JdbcTemplate jdbc) {
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

    /** The bands of the latest local demonstration scheme for the category that has started by that date; empty if none. */
    public List<Band> bandsInForce(String category, LocalDate at) {
        return jdbc.query(
            "SELECT scheme_key, stars, min_iseer FROM rating_demo_band WHERE category_code = ? AND scheme_key = ("
                + "SELECT scheme_key FROM rating_demo_band WHERE category_code = ? AND effective_from <= ? "
                + "ORDER BY effective_from DESC, scheme_key DESC LIMIT 1) ORDER BY stars",
            (rs, i) -> new Band(rs.getString("scheme_key"), rs.getInt("stars"), rs.getBigDecimal("min_iseer")),
            category, category, java.sql.Date.valueOf(at));
    }

    @Transactional
    public Result compute(UUID applicationId, int expectedVersion, UUID actorAccountId, String actorRole, String schemeKey,
                          BigDecimal declaredIseer, BigDecimal verifiedIseer, int stars) {
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
        int ratingVersion = jdbc.queryForObject(
            "SELECT coalesce(max(rating_version), 0) + 1 FROM model_application_rating WHERE application_id = ?", Integer.class, applicationId);
        jdbc.update(
            "INSERT INTO model_application_rating (id, application_id, transition_event_id, rating_version, basis, scheme_key, declared_iseer, "
                + "verified_iseer, stars, computed_by_account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            UUID.randomUUID(), applicationId, eventId, ratingVersion, BASIS, schemeKey, declaredIseer, verifiedIseer, stars, actorAccountId);
        return new Result(Outcome.COMPUTED, versionAfter, ratingVersion, at.toInstant());
    }
}
