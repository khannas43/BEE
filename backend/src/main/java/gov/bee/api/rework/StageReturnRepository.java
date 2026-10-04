package gov.bee.api.rework;

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
 * A stage owner returns an application to the applicant with a reason (FIRST_SLICE.md section 4). The state change, the
 * append-only transition event and the return record commit together or not at all. The record keeps the stage the
 * application came from and a fingerprint of the rating inputs at that moment, so a later resubmission can tell whether a
 * rating input changed. The officer's own assignment is left open: when the application comes back to that stage, the
 * same officer sees it again.
 */
@Repository
public class StageReturnRepository {

    public static final String TO_STATE = "returned";
    public static final String ACTION = "return";

    public enum Outcome { RETURNED, STALE }

    public record Result(Outcome outcome, int versionAfter, Instant returnedAt) {
        static Result of(Outcome outcome) {
            return new Result(outcome, 0, null);
        }
    }

    /** The rating inputs as they stand: the declared figure, the laboratory, the test date and how many report versions exist. */
    public record Fingerprint(BigDecimal declaredIseer, String laboratoryCode, LocalDate testedOn, int reportVersions) {
    }

    private final JdbcTemplate jdbc;

    public StageReturnRepository(JdbcTemplate jdbc) {
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
    public Result doReturn(UUID applicationId, int expectedVersion, UUID actorAccountId, String actorRole, String fromState, String reason) {
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
            "INSERT INTO model_application_return (id, application_id, transition_event_id, returned_from_state, reason, fp_declared_iseer, "
                + "fp_laboratory_code, fp_tested_on, fp_report_versions, returned_by_account_id) "
                + "SELECT ?, a.id, ?, ?, ?, a.declared_iseer, a.laboratory_code, a.tested_on, "
                + "(SELECT count(*) FROM model_application_document_version v JOIN model_application_document d ON d.id = v.document_id WHERE d.application_id = a.id), ? "
                + "FROM model_application a WHERE a.id = ?",
            UUID.randomUUID(), eventId, fromState, reason, actorAccountId, applicationId);
        return new Result(Outcome.RETURNED, versionAfter, at.toInstant());
    }
}
