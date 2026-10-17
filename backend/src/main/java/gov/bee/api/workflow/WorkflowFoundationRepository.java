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
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Transactional persistence for SNL WP2A foundation tables (internal; not wired to HTTP yet). */
public class WorkflowFoundationRepository {

    public static final String SUBJECT_REGISTRATION = "registration_application";
    public static final String SUBJECT_MODEL = "model_application";

    public record TaskRow(UUID id, String subjectKind, UUID subjectId, String stage, String action, String ownerRole, UUID ownerAccountId,
                          String status, int version, UUID commandId, String commandPayloadHash) {
    }

    public record TaskCommand(String subjectKind, UUID subjectId, String stage, String action, String ownerRole, UUID ownerAccount) {
    }

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    public WorkflowFoundationRepository(JdbcTemplate jdbc) {
        this(jdbc, new TransactionTemplate(new DataSourceTransactionManager(jdbc.getDataSource())));
    }

    public WorkflowFoundationRepository(JdbcTemplate jdbc, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    public static String payloadHash(TaskCommand command) {
        String canonical = command.subjectKind() + "|" + command.subjectId() + "|" + command.stage() + "|" + command.action() + "|"
            + command.ownerRole() + "|" + (command.ownerAccount() == null ? "" : command.ownerAccount());
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
        if (commandId != null) {
            return createTaskIdempotent(command, commandId, actorAccount, actorRole);
        }
        return tx.execute(status -> insertTaskWithEvent(command, null, null, actorAccount, actorRole));
    }

    public TaskRow createTaskIdempotent(TaskCommand command, UUID commandId, UUID actorAccount, String actorRole) {
        String hash = payloadHash(command);
        return tx.execute(status -> {
            Optional<TaskRow> existing = findTaskByCommandId(commandId);
            if (existing.isPresent()) {
                assertSamePayload(existing.get(), command, hash);
                return existing.get();
            }
            try {
                return insertTaskWithEvent(command, commandId, hash, actorAccount, actorRole);
            } catch (DataIntegrityViolationException ex) {
                Optional<TaskRow> raced = findTaskByCommandId(commandId);
                if (raced.isPresent()) {
                    assertSamePayload(raced.get(), command, hash);
                    return raced.get();
                }
                throw ex;
            }
        });
    }

    TaskRow insertTaskWithEvent(TaskCommand command, UUID commandId, String hash, UUID actorAccount, String actorRole) {
        UUID taskId = jdbc.queryForObject(
            "INSERT INTO workflow_task (subject_kind, subject_id, stage, action, owner_role, owner_account_id, command_id, command_payload_hash) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            UUID.class, command.subjectKind(), command.subjectId(), command.stage(), command.action(), command.ownerRole(), command.ownerAccount(), commandId,
            hash);
        jdbc.update(
            "INSERT INTO workflow_task_event (task_id, kind, to_owner_role, to_owner_account, actor_account_id, actor_role) VALUES (?, 'created', ?, ?, ?, ?)",
            taskId, command.ownerRole(), command.ownerAccount(), actorAccount, actorRole);
        return findTask(taskId).orElseThrow();
    }

    void assertSamePayload(TaskRow row, TaskCommand command, String hash) {
        if (!hash.equals(row.commandPayloadHash())
            || !command.subjectKind().equals(row.subjectKind())
            || !command.subjectId().equals(row.subjectId())
            || !command.stage().equals(row.stage())
            || !command.action().equals(row.action())) {
            throw new WorkflowIdempotencyConflictException();
        }
    }

    public Optional<TaskRow> findTaskByCommandId(UUID commandId) {
        return findTaskByColumn("command_id", commandId);
    }

    public Optional<TaskRow> findTask(UUID id) {
        return findTaskByColumn("id", id);
    }

    Optional<TaskRow> findTaskByColumn(String column, UUID value) {
        var list = jdbc.query(
            "SELECT id, subject_kind, subject_id, stage, action, owner_role, owner_account_id, status, version, command_id, command_payload_hash FROM workflow_task WHERE "
                + column + " = ?",
            (rs, i) -> mapTask(rs), value);
        return list.stream().findFirst();
    }

    static TaskRow mapTask(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new TaskRow(rs.getObject("id", UUID.class), rs.getString("subject_kind"), rs.getObject("subject_id", UUID.class), rs.getString("stage"),
            rs.getString("action"), rs.getString("owner_role"), rs.getObject("owner_account_id", UUID.class), rs.getString("status"), rs.getInt("version"),
            rs.getObject("command_id", UUID.class), rs.getString("command_payload_hash"));
    }

    public void reassignTask(UUID taskId, int expectedVersion, String toRole, UUID toAccount, UUID actorAccount, String actorRole, String reason) {
        tx.executeWithoutResult(status -> {
            var before = findTask(taskId).orElseThrow();
            applyTaskFields(taskId, expectedVersion, toRole, toAccount, null, null);
            jdbc.update(
                "INSERT INTO workflow_task_event (task_id, kind, from_owner_role, from_owner_account, to_owner_role, to_owner_account, actor_account_id, actor_role, reason) "
                    + "VALUES (?, 'reassigned', ?, ?, ?, ?, ?, ?, ?)",
                taskId, before.ownerRole(), before.ownerAccountId(), toRole, toAccount, actorAccount, actorRole, reason);
        });
    }

    public void completeTask(UUID taskId, int expectedVersion, UUID actorAccount, String actorRole, String reason) {
        terminalTask(taskId, expectedVersion, "completed", actorAccount, actorRole, reason);
    }

    public void cancelTask(UUID taskId, int expectedVersion, UUID actorAccount, String actorRole, String reason) {
        terminalTask(taskId, expectedVersion, "cancelled", actorAccount, actorRole, reason);
    }

    void terminalTask(UUID taskId, int expectedVersion, String status, UUID actorAccount, String actorRole, String reason) {
        tx.executeWithoutResult(s -> {
            applyTaskFields(taskId, expectedVersion, null, null, status, null);
            jdbc.update(
                "INSERT INTO workflow_task_event (task_id, kind, actor_account_id, actor_role, reason) VALUES (?, ?, ?, ?, ?)",
                taskId, status.equals("completed") ? "completed" : "cancelled", actorAccount, actorRole, reason);
        });
    }

    void applyTaskFields(UUID taskId, int expectedVersion, String ownerRole, UUID ownerAccount, String status, Instant dueAt) {
        jdbc.query(
            "SELECT workflow_foundation_set_task_fields(?, ?, ?, ?, ?, ?)",
            (rs, rowNum) -> rs.getString(1),
            taskId, expectedVersion, ownerRole, ownerAccount, status, dueAt == null ? null : java.sql.Timestamp.from(dueAt));
    }

    public UUID openDiscrepancy(String subjectKind, UUID subjectId, String lineCode, String summary, UUID openedBy) {
        return jdbc.queryForObject(
            "INSERT INTO workflow_discrepancy (subject_kind, subject_id, line_code, summary, opened_by) VALUES (?, ?, ?, ?, ?) RETURNING id",
            UUID.class, subjectKind, subjectId, lineCode, summary, openedBy);
    }

    public void addDiscrepancyResponse(UUID discrepancyId, int responseSeq, String body, UUID respondedBy) {
        tx.executeWithoutResult(s -> {
            String status = jdbc.queryForObject("SELECT status FROM workflow_discrepancy WHERE id = ? FOR UPDATE", String.class, discrepancyId);
            if (!"open".equals(status) && !"needs_more".equals(status)) {
                throw new DataIntegrityViolationException("workflow_discrepancy_not_accepting_response");
            }
            jdbc.update(
                "INSERT INTO workflow_discrepancy_response (discrepancy_id, response_seq, body, responded_by) VALUES (?, ?, ?, ?)",
                discrepancyId, responseSeq, body, respondedBy);
            setDiscrepancyStatus(discrepancyId, "awaiting_review");
        });
    }

    public void disposeDiscrepancy(UUID discrepancyId, int responseSeq, String outcome, String note, UUID disposedBy) {
        tx.executeWithoutResult(s -> {
            String status = jdbc.queryForObject("SELECT status FROM workflow_discrepancy WHERE id = ? FOR UPDATE", String.class, discrepancyId);
            if (!"awaiting_review".equals(status)) {
                throw new DataIntegrityViolationException("workflow_discrepancy_not_awaiting_review");
            }
            if ("needs_more".equals(outcome)) {
                Integer priorNeedsMore = jdbc.queryForObject(
                    "SELECT count(*)::int FROM workflow_discrepancy_disposition WHERE discrepancy_id = ? AND outcome = 'needs_more'",
                    Integer.class, discrepancyId);
                if (priorNeedsMore != null && priorNeedsMore > 0) {
                    throw new DataIntegrityViolationException("workflow_discrepancy_needs_more_once");
                }
            }
            jdbc.update(
                "INSERT INTO workflow_discrepancy_disposition (discrepancy_id, response_seq, outcome, note, disposed_by) VALUES (?, ?, ?, ?, ?)",
                discrepancyId, responseSeq, outcome, note, disposedBy);
            if ("needs_more".equals(outcome)) {
                setDiscrepancyStatus(discrepancyId, "needs_more");
            } else {
                setDiscrepancyStatus(discrepancyId, "closed");
            }
        });
    }

    void setDiscrepancyStatus(UUID discrepancyId, String status) {
        jdbc.queryForObject("SELECT set_config('bee.workflow_discrepancy_status', 'allow', true)", String.class);
        jdbc.update("UPDATE workflow_discrepancy SET status = ? WHERE id = ?", status, discrepancyId);
    }

    public UUID appendClockEvent(String subjectKind, UUID subjectId, UUID policyVersionId, String eventKind, String responsibleParty, Instant at, String note) {
        var prior = loadClockEvents(subjectKind, subjectId);
        WorkingDaySla.validateClockSequence(prior, new WorkingDaySla.ClockEvent(eventKind, responsibleParty, at));
        return jdbc.queryForObject(
            "INSERT INTO workflow_sla_clock_event (subject_kind, subject_id, policy_version_id, event_kind, responsible_party, occurred_at, note) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
            UUID.class, subjectKind, subjectId, policyVersionId, eventKind, responsibleParty, java.sql.Timestamp.from(at), note);
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
