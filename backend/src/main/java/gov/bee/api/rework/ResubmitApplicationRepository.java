package gov.bee.api.rework;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * The applicant resubmits a returned application (FIRST_SLICE.md section 4). It goes back to the stage that returned it, or
 * to rating when the rating already existed and a rating input changed since the return, in which case the rating is
 * superseded (the earlier rating stays as an earlier version; Programme computes a new one). The state change, the
 * append-only transition event and the resubmission record commit together or not at all. The officer's assignment was
 * left open at the return, so an assigned stage shows the application to the same officer again.
 */
@Repository
public class ResubmitApplicationRepository {

    public static final String FROM_STATE = "returned";
    public static final String ACTION = "resubmit";

    public enum Outcome { RESUBMITTED, STALE }

    public record Result(Outcome outcome, int versionAfter, Instant resubmittedAt) {
        static Result of(Outcome outcome) {
            return new Result(outcome, 0, null);
        }
    }

    /** The latest return that no resubmission has answered yet, with the rating-input fingerprint taken at the return. */
    public record OpenReturn(UUID id, String returnedFromState, BigDecimal declaredIseer, String laboratoryCode, LocalDate testedOn, int reportVersions) {
    }

    private final JdbcTemplate jdbc;

    public ResubmitApplicationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<OpenReturn> openReturn(UUID applicationId) {
        return jdbc.query(
            "SELECT r.id, r.returned_from_state, r.fp_declared_iseer, r.fp_laboratory_code, r.fp_tested_on, r.fp_report_versions "
                + "FROM model_application_return r LEFT JOIN model_application_resubmission s ON s.return_id = r.id "
                + "WHERE r.application_id = ? AND s.id IS NULL ORDER BY r.returned_at DESC LIMIT 1",
            (rs, i) -> new OpenReturn(rs.getObject("id", UUID.class), rs.getString("returned_from_state"), rs.getBigDecimal("fp_declared_iseer"),
                rs.getString("fp_laboratory_code"), rs.getObject("fp_tested_on", LocalDate.class), rs.getInt("fp_report_versions")),
            applicationId).stream().findFirst();
    }

    /** True when any rating input differs from what it was when the application was returned. */
    public boolean ratingInputsChanged(UUID applicationId, OpenReturn open) {
        return jdbc.queryForObject(
            "SELECT (a.declared_iseer IS DISTINCT FROM ?) OR (a.laboratory_code IS DISTINCT FROM ?) OR (a.tested_on IS DISTINCT FROM ?) "
                + "OR ((SELECT count(*) FROM model_application_document_version v JOIN model_application_document d ON d.id = v.document_id "
                + "WHERE d.application_id = a.id) <> ?) FROM model_application a WHERE a.id = ?",
            Boolean.class, open.declaredIseer(), open.laboratoryCode(), open.testedOn() == null ? null : java.sql.Date.valueOf(open.testedOn()),
            open.reportVersions(), applicationId);
    }

    @Transactional
    public Result resubmit(UUID applicationId, int expectedVersion, UUID actorAccountId, String actorRole, UUID returnId,
                           String resumedState, boolean ratingSuperseded, String note) {
        int updated = jdbc.update(
            "UPDATE model_application SET state = ?, version = version + 1 WHERE id = ? AND state = ? AND version = ?",
            resumedState, applicationId, FROM_STATE, expectedVersion);
        if (updated != 1) {
            return Result.of(Outcome.STALE);
        }
        int versionAfter = expectedVersion + 1;
        UUID eventId = UUID.randomUUID();
        Timestamp at = jdbc.queryForObject(
            "INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING occurred_at",
            Timestamp.class, eventId, applicationId, ACTION, FROM_STATE, resumedState, actorAccountId, actorRole, versionAfter);
        jdbc.update(
            "INSERT INTO model_application_resubmission (id, application_id, return_id, transition_event_id, resumed_state, rating_superseded, note, "
                + "resubmitted_by_account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            UUID.randomUUID(), applicationId, returnId, eventId, resumedState, ratingSuperseded, note, actorAccountId);
        return new Result(Outcome.RESUBMITTED, versionAfter, at.toInstant());
    }
}
