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

    public record TransitionResult(Outcome outcome, int versionAfter, Instant returnedAt, UUID transitionEventId) {
        public static TransitionResult stale() {
            return new TransitionResult(Outcome.STALE, 0, null, null);
        }
    }

    public record Result(Outcome outcome, int versionAfter, Instant returnedAt, UUID returnId) {
        static Result of(Outcome outcome) {
            return new Result(outcome, 0, null, null);
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
    public TransitionResult transitionToReturned(UUID applicationId, int expectedVersion, UUID actorAccountId, String actorRole, String fromState) {
        int updated = jdbc.update(
            "UPDATE model_application SET state = ?, version = version + 1 WHERE id = ? AND state = ? AND version = ?",
            TO_STATE, applicationId, fromState, expectedVersion);
        if (updated != 1) {
            return TransitionResult.stale();
        }
        int versionAfter = expectedVersion + 1;
        UUID eventId = UUID.randomUUID();
        Timestamp at = jdbc.queryForObject(
            "INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING occurred_at",
            Timestamp.class, eventId, applicationId, ACTION, fromState, TO_STATE, actorAccountId, actorRole, versionAfter);
        return new TransitionResult(Outcome.RETURNED, versionAfter, at.toInstant(), eventId);
    }

    public UUID insertFoundationReturn(UUID returnId, UUID applicationId, UUID transitionEventId, String fromState, String reason, UUID returnedBy,
                                       UUID foundationNotifyCommandId) {
        return jdbc.queryForObject(
            "SELECT model_return_response_insert_return(?, ?, ?, ?, ?, ?, ?)",
            UUID.class, returnId, applicationId, transitionEventId, fromState, reason, returnedBy, foundationNotifyCommandId);
    }

    /** Legacy path: direct insert (requires INSERT grant on {@code model_application_return}, e.g. maint tests). */
    public UUID insertLegacyReturn(UUID returnId, UUID applicationId, UUID transitionEventId, String fromState, String reason, UUID returnedBy) {
        return jdbc.queryForObject(
            "INSERT INTO model_application_return (id, application_id, transition_event_id, returned_from_state, reason, fp_declared_iseer, "
                + "fp_laboratory_code, fp_tested_on, fp_report_versions, returned_by_account_id) "
                + "SELECT ?, a.id, ?, ?, ?, a.declared_iseer, a.laboratory_code, a.tested_on, "
                + "(SELECT count(*) FROM model_application_document_version v JOIN model_application_document d ON d.id = v.document_id WHERE d.application_id = a.id), ? "
                + "FROM model_application a WHERE a.id = ? RETURNING id",
            UUID.class, returnId, transitionEventId, fromState, reason, returnedBy, applicationId);
    }

    @Transactional
    public Result doReturn(UUID applicationId, int expectedVersion, UUID actorAccountId, String actorRole, String fromState, String reason) {
        var trans = transitionToReturned(applicationId, expectedVersion, actorAccountId, actorRole, fromState);
        if (trans.outcome() != Outcome.RETURNED) {
            return Result.of(Outcome.STALE);
        }
        UUID returnId = UUID.randomUUID();
        insertLegacyReturn(returnId, applicationId, trans.transitionEventId(), fromState, reason, actorAccountId);
        return new Result(Outcome.RETURNED, trans.versionAfter(), trans.returnedAt(), returnId);
    }

    @Transactional
    public Result doWiredReturn(UUID applicationId, int expectedVersion, UUID actorAccountId, String actorRole, String fromState, String reason,
                                UUID returnId, UUID foundationNotifyCommandId) {
        var trans = transitionToReturned(applicationId, expectedVersion, actorAccountId, actorRole, fromState);
        if (trans.outcome() != Outcome.RETURNED) {
            return Result.of(Outcome.STALE);
        }
        insertFoundationReturn(returnId, applicationId, trans.transitionEventId(), fromState, reason, actorAccountId, foundationNotifyCommandId);
        return new Result(Outcome.RETURNED, trans.versionAfter(), trans.returnedAt(), returnId);
    }
}
