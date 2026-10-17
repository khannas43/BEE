package gov.bee.api.workflow;

import java.sql.Date;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/** Persistence helpers for SNL WP2A foundation tables (internal; not wired to HTTP yet). */
public class WorkflowFoundationRepository {

    public static final String SUBJECT_REGISTRATION = "registration_application";
    public static final String SUBJECT_MODEL = "model_application";

    public record TaskRow(UUID id, String subjectKind, UUID subjectId, String stage, String action, String status, int version, UUID commandId) {
    }

    private final JdbcTemplate jdbc;

    public WorkflowFoundationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public UUID insertPolicyVersion(String policyKey, int version, LocalDate effectiveFrom, LocalDate effectiveTo, String calendarKey,
                                    int workingDayLimit, boolean pauseWhileApplicant) {
        return jdbc.queryForObject(
            "INSERT INTO workflow_sla_policy_version (policy_key, version, effective_from, effective_to, calendar_key, working_day_limit, pause_while_applicant) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
            UUID.class, policyKey, version, Date.valueOf(effectiveFrom), effectiveTo == null ? null : Date.valueOf(effectiveTo), calendarKey, workingDayLimit,
            pauseWhileApplicant);
    }

    public Optional<WorkingDaySla.CalendarSpec> loadCalendarSpec(String calendarKey) {
        var rows = jdbc.query(
            "SELECT non_working_weekdays FROM workflow_calendar WHERE calendar_key = ?",
            (rs, i) -> {
                Object[] raw = (Object[]) rs.getArray("non_working_weekdays").getArray();
                short[] iso = new short[raw.length];
                for (int j = 0; j < raw.length; j++) {
                    iso[j] = ((Number) raw[j]).shortValue();
                }
                return iso;
            }, calendarKey);
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        short[] iso = rows.get(0);
        List<LocalDate> closures = jdbc.query(
            "SELECT closure_date FROM workflow_calendar_closure WHERE calendar_key = ? ORDER BY closure_date",
            (rs, i) -> rs.getDate("closure_date").toLocalDate(), calendarKey);
        return Optional.of(WorkingDaySla.calendarFromDb(iso, closures));
    }

    public TaskRow createTask(String subjectKind, UUID subjectId, String stage, String action, String ownerRole, UUID ownerAccount, UUID commandId,
                              UUID actorAccount, String actorRole) {
        UUID taskId = jdbc.queryForObject(
            "INSERT INTO workflow_task (subject_kind, subject_id, stage, action, owner_role, owner_account_id, command_id) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
            UUID.class, subjectKind, subjectId, stage, action, ownerRole, ownerAccount, commandId);
        jdbc.update(
            "INSERT INTO workflow_task_event (task_id, kind, to_owner_role, to_owner_account, actor_account_id, actor_role) VALUES (?, 'created', ?, ?, ?, ?)",
            taskId, ownerRole, ownerAccount, actorAccount, actorRole);
        return findTask(taskId).orElseThrow();
    }

    /** Idempotent create: same command_id returns the existing open task without duplicating events. */
    public TaskRow createTaskIdempotent(String subjectKind, UUID subjectId, String stage, String action, String ownerRole, UUID ownerAccount, UUID commandId,
                                        UUID actorAccount, String actorRole) {
        try {
            return createTask(subjectKind, subjectId, stage, action, ownerRole, ownerAccount, commandId, actorAccount, actorRole);
        } catch (DataIntegrityViolationException ex) {
            if (commandId == null) {
                throw ex;
            }
            return findTaskByCommandId(commandId).orElseThrow(() -> ex);
        }
    }

    public Optional<TaskRow> findTaskByCommandId(UUID commandId) {
        var list = jdbc.query(
            "SELECT id, subject_kind, subject_id, stage, action, status, version, command_id FROM workflow_task WHERE command_id = ?",
            (rs, i) -> new TaskRow(rs.getObject("id", UUID.class), rs.getString("subject_kind"), rs.getObject("subject_id", UUID.class), rs.getString("stage"),
                rs.getString("action"), rs.getString("status"), rs.getInt("version"), rs.getObject("command_id", UUID.class)), commandId);
        return list.stream().findFirst();
    }

    public Optional<TaskRow> findTask(UUID id) {
        var list = jdbc.query(
            "SELECT id, subject_kind, subject_id, stage, action, status, version, command_id FROM workflow_task WHERE id = ?",
            (rs, i) -> new TaskRow(rs.getObject("id", UUID.class), rs.getString("subject_kind"), rs.getObject("subject_id", UUID.class), rs.getString("stage"),
                rs.getString("action"), rs.getString("status"), rs.getInt("version"), rs.getObject("command_id", UUID.class)), id);
        return list.stream().findFirst();
    }

    public void reassignTask(UUID taskId, int expectedVersion, String toRole, UUID toAccount, UUID actorAccount, String actorRole, String reason) {
        var task = findTask(taskId).orElseThrow();
        jdbc.update(
            "INSERT INTO workflow_task_event (task_id, kind, from_owner_role, from_owner_account, to_owner_role, to_owner_account, actor_account_id, actor_role, reason) "
                + "SELECT id, 'reassigned', owner_role, owner_account_id, ?, ?, ?, ?, ? FROM workflow_task WHERE id = ?",
            toRole, toAccount, actorAccount, actorRole, reason, taskId);
        int updated = jdbc.update(
            "UPDATE workflow_task SET owner_role = ?, owner_account_id = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'open'",
            toRole, toAccount, taskId, expectedVersion);
        if (updated != 1) {
            throw new DataIntegrityViolationException("workflow_task_version_conflict");
        }
    }

    public UUID openDiscrepancy(String subjectKind, UUID subjectId, String lineCode, String summary, UUID openedBy) {
        return jdbc.queryForObject(
            "INSERT INTO workflow_discrepancy (subject_kind, subject_id, line_code, summary, opened_by) VALUES (?, ?, ?, ?, ?) RETURNING id",
            UUID.class, subjectKind, subjectId, lineCode, summary, openedBy);
    }

    public void addDiscrepancyResponse(UUID discrepancyId, int responseSeq, String body, UUID respondedBy) {
        jdbc.update(
            "INSERT INTO workflow_discrepancy_response (discrepancy_id, response_seq, body, responded_by) VALUES (?, ?, ?, ?)",
            discrepancyId, responseSeq, body, respondedBy);
        jdbc.update("UPDATE workflow_discrepancy SET status = 'responded' WHERE id = ? AND status = 'open'", discrepancyId);
    }

    public void disposeDiscrepancy(UUID discrepancyId, String outcome, String note, UUID disposedBy) {
        jdbc.update(
            "INSERT INTO workflow_discrepancy_disposition (discrepancy_id, outcome, note, disposed_by) VALUES (?, ?, ?, ?)",
            discrepancyId, outcome, note, disposedBy);
        jdbc.update("UPDATE workflow_discrepancy SET status = 'disposed' WHERE id = ?", discrepancyId);
    }

    public void appendClockEvent(String subjectKind, UUID subjectId, String policyKey, String eventKind, String responsibleParty, Instant at, String note) {
        jdbc.update(
            "INSERT INTO workflow_sla_clock_event (subject_kind, subject_id, policy_key, event_kind, responsible_party, occurred_at, note) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?)",
            subjectKind, subjectId, policyKey, eventKind, responsibleParty, java.sql.Timestamp.from(at), note);
    }

    public List<WorkingDaySla.ClockEvent> loadClockEvents(String subjectKind, UUID subjectId) {
        return jdbc.query(
            "SELECT event_kind, responsible_party, occurred_at FROM workflow_sla_clock_event WHERE subject_kind = ? AND subject_id = ? ORDER BY occurred_at, id",
            (rs, i) -> new WorkingDaySla.ClockEvent(rs.getString("event_kind"), rs.getString("responsible_party"), rs.getTimestamp("occurred_at").toInstant()),
            subjectKind, subjectId);
    }

    public int countTaskEvents(UUID taskId) {
        Integer n = jdbc.queryForObject("SELECT count(*)::int FROM workflow_task_event WHERE task_id = ?", Integer.class, taskId);
        return n == null ? 0 : n;
    }
}
