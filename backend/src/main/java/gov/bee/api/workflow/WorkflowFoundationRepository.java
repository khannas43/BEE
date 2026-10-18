package gov.bee.api.workflow;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Date;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

/** Transactional persistence for SNL WP2A foundation tables. */
@Repository
public class WorkflowFoundationRepository {

    public static final String SUBJECT_REGISTRATION = "registration_application";
    public static final String SUBJECT_MODEL = "model_application";

    public record TaskRow(UUID id, String subjectKind, UUID subjectId, String stage, String action, String ownerRole, UUID ownerAccountId,
                          String status, int version, Instant dueAt, UUID commandId, String commandPayloadHash) {
    }

    public record SlaClockRow(UUID id, UUID taskId, UUID policyVersionId, Instant policyAnchorAt) {
    }

    public record TaskCommand(String subjectKind, UUID subjectId, String stage, String action, String ownerRole, UUID ownerAccount, Instant dueAt,
                              UUID policyVersionId, Instant policyAnchorAt) {
        public TaskCommand(String subjectKind, UUID subjectId, String stage, String action, String ownerRole, UUID ownerAccount) {
            this(subjectKind, subjectId, stage, action, ownerRole, ownerAccount, null, null, null);
        }
    }

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    @Autowired
    public WorkflowFoundationRepository(JdbcTemplate jdbc) {
        this(jdbc, new TransactionTemplate(new DataSourceTransactionManager(jdbc.getDataSource())));
    }

    /** Tests and same-package callers only; not a Spring bean constructor. */
    WorkflowFoundationRepository(JdbcTemplate jdbc, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    public static String payloadHash(TaskCommand command) {
        String canonical = command.subjectKind() + "|" + command.subjectId() + "|" + command.stage() + "|" + command.action() + "|"
            + command.ownerRole() + "|" + (command.ownerAccount() == null ? "" : command.ownerAccount()) + "|"
            + (command.dueAt() == null ? "" : command.dueAt()) + "|"
            + (command.policyVersionId() == null ? "" : command.policyVersionId()) + "|"
            + (command.policyAnchorAt() == null ? "" : command.policyAnchorAt());
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
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
        List<LocalDate> closures = jdbc.query(
            "SELECT closure_date FROM workflow_calendar_closure WHERE calendar_key = ? ORDER BY closure_date",
            (rs, i) -> rs.getDate("closure_date").toLocalDate(), calendarKey);
        return Optional.of(WorkingDaySla.calendarFromDb(rows.get(0), closures));
    }

    public TaskRow createTask(TaskCommand command, UUID commandId, UUID actorAccount, String actorRole) {
        return createTaskIdempotent(command, commandId, actorAccount, actorRole);
    }

    public TaskRow createTaskIdempotent(TaskCommand command, UUID commandId, UUID actorAccount, String actorRole) {
        String hash = commandId == null ? null : payloadHash(command);
        UUID taskId = invokeCreateTask(command, commandId, hash, actorAccount, actorRole);
        return findTask(taskId).orElseThrow();
    }

    UUID invokeCreateTask(TaskCommand command, UUID commandId, String hash, UUID actorAccount, String actorRole) {
        for (int attempt = 0; attempt < 5; attempt++) {
            try {
                return jdbc.queryForObject(
                    "SELECT workflow_foundation_create_task(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    UUID.class,
                    command.subjectKind(), command.subjectId(), command.stage(), command.action(), command.ownerRole(), command.ownerAccount(), commandId,
                    hash, command.dueAt() == null ? null : java.sql.Timestamp.from(command.dueAt()), command.policyVersionId(),
                    command.policyAnchorAt() == null ? null : java.sql.Timestamp.from(command.policyAnchorAt()), actorAccount, actorRole);
            } catch (DataAccessException ex) {
                if (isSqlMessage(ex, "workflow_idempotency_conflict")) {
                    throw new WorkflowIdempotencyConflictException();
                }
                if (isSqlMessage(ex, "workflow_command_create_race_retry") && attempt + 1 < 5) {
                    continue;
                }
                throw ex;
            }
        }
        throw new IllegalStateException("workflow_command_create_exhausted");
    }

    public static boolean isSqlMessage(DataAccessException ex, String fragment) {
        for (Throwable t = ex; t != null; t = t.getCause()) {
            if (t.getMessage() != null && t.getMessage().contains(fragment)) {
                return true;
            }
        }
        return false;
    }

    public Optional<TaskRow> findTaskByCommandId(UUID commandId) {
        return findTaskByColumn("command_id", commandId);
    }

    public Optional<TaskRow> findTask(UUID id) {
        return findTaskByColumn("id", id);
    }

    public Optional<SlaClockRow> findClockByTaskId(UUID taskId) {
        var list = jdbc.query(
            "SELECT id, task_id, policy_version_id, policy_anchor_at FROM workflow_sla_clock WHERE task_id = ?",
            (rs, i) -> new SlaClockRow(rs.getObject("id", UUID.class), rs.getObject("task_id", UUID.class), rs.getObject("policy_version_id", UUID.class),
                rs.getTimestamp("policy_anchor_at").toInstant()),
            taskId);
        return list.stream().findFirst();
    }

    Optional<TaskRow> findTaskByColumn(String column, UUID value) {
        var list = jdbc.query(
            "SELECT id, subject_kind, subject_id, stage, action, owner_role, owner_account_id, status, version, due_at, command_id, command_payload_hash FROM workflow_task WHERE "
                + column + " = ?",
            (rs, i) -> mapTask(rs), value);
        return list.stream().findFirst();
    }

    static TaskRow mapTask(java.sql.ResultSet rs) throws java.sql.SQLException {
        var due = rs.getTimestamp("due_at");
        return new TaskRow(rs.getObject("id", UUID.class), rs.getString("subject_kind"), rs.getObject("subject_id", UUID.class), rs.getString("stage"),
            rs.getString("action"), rs.getString("owner_role"), rs.getObject("owner_account_id", UUID.class), rs.getString("status"), rs.getInt("version"),
            due == null ? null : due.toInstant(), rs.getObject("command_id", UUID.class), rs.getString("command_payload_hash"));
    }

    public void reassignTask(UUID taskId, int expectedVersion, String toRole, UUID toAccount, UUID actorAccount, String actorRole, String reason) {
        tx.executeWithoutResult(status -> jdbc.query(
            "SELECT workflow_foundation_reassign_task(?, ?, ?, ?, ?, ?, ?)",
            rs -> null,
            taskId, expectedVersion, toRole, toAccount, actorAccount, actorRole, reason));
    }

    public void completeTask(UUID taskId, int expectedVersion, UUID actorAccount, String actorRole, String reason) {
        terminalTask(taskId, expectedVersion, "completed", actorAccount, actorRole, reason);
    }

    public void cancelTask(UUID taskId, int expectedVersion, UUID actorAccount, String actorRole, String reason) {
        terminalTask(taskId, expectedVersion, "cancelled", actorAccount, actorRole, reason);
    }

    void terminalTask(UUID taskId, int expectedVersion, String status, UUID actorAccount, String actorRole, String reason) {
        tx.executeWithoutResult(s -> jdbc.query(
            "SELECT workflow_foundation_terminal_task(?, ?, ?, ?, ?, ?)",
            rs -> null,
            taskId, expectedVersion, status, actorAccount, actorRole, reason));
    }

    public UUID openDiscrepancy(String subjectKind, UUID subjectId, String lineCode, String summary, UUID openedBy) {
        return jdbc.queryForObject(
            "INSERT INTO workflow_discrepancy (subject_kind, subject_id, line_code, summary, opened_by) VALUES (?, ?, ?, ?, ?) RETURNING id",
            UUID.class, subjectKind, subjectId, lineCode, summary, openedBy);
    }

    public void addDiscrepancyResponse(UUID discrepancyId, int responseSeq, String body, UUID respondedBy) {
        tx.executeWithoutResult(s -> jdbc.query(
            "SELECT workflow_foundation_discrepancy_respond(?, ?, ?, ?)",
            rs -> null,
            discrepancyId, responseSeq, body, respondedBy));
    }

    public void disposeDiscrepancy(UUID discrepancyId, int responseSeq, String outcome, String note, UUID disposedBy) {
        tx.executeWithoutResult(s -> jdbc.query(
            "SELECT workflow_foundation_discrepancy_dispose(?, ?, ?, ?, ?)",
            rs -> null,
            discrepancyId, responseSeq, outcome, note, disposedBy));
    }

    public UUID appendClockEvent(UUID clockId, String eventKind, String responsibleParty, Instant at, String note) {
        return jdbc.queryForObject(
            "SELECT workflow_foundation_append_clock_event(?, ?, ?, ?, ?)",
            UUID.class, clockId, eventKind, responsibleParty, java.sql.Timestamp.from(at), note);
    }

    public List<WorkingDaySla.ClockEvent> loadClockEvents(UUID clockId) {
        return jdbc.query(
            "SELECT event_kind, responsible_party, occurred_at FROM workflow_sla_clock_event WHERE clock_id = ? ORDER BY occurred_at, id",
            (rs, i) -> new WorkingDaySla.ClockEvent(rs.getString("event_kind"), rs.getString("responsible_party"), rs.getTimestamp("occurred_at").toInstant()),
            clockId);
    }

    public int countTaskEvents(UUID taskId) {
        Integer n = jdbc.queryForObject("SELECT count(*)::int FROM workflow_task_event WHERE task_id = ?", Integer.class, taskId);
        return n == null ? 0 : n;
    }
}
