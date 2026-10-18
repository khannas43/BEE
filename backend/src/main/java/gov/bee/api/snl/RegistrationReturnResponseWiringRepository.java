package gov.bee.api.snl;

import gov.bee.api.workflow.WorkflowFoundationRepository;
import gov.bee.api.workflow.WorkflowIdempotencyConflictException;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
/** Trusted database commands for registration return/resubmit wiring (Brief 19C-A). Not a Spring bean until 19C-B. */
public class RegistrationReturnResponseWiringRepository {

    public record CycleRow(
        UUID id,
        UUID applicationId,
        int cycleSeq,
        String status,
        String reviewStage,
        UUID taskId,
        UUID discrepancyId,
        String lastResumedStage) {
    }

    public record OrchestrateWiredReturnCommand(
        UUID returnId,
        UUID applicationId,
        UUID transitionEventId,
        String fromStage,
        String reason,
        UUID returnedBy,
        Instant returnedAt,
        String actorRole,
        UUID notifyCommandId,
        String notifyPayloadHash,
        String notifyMessageSuffix,
        UUID taskCommandId,
        String taskPayloadHash,
        String taskOwnerRole,
        UUID taskOwnerAccount,
        Instant dueAt,
        UUID policyVersionId,
        UUID wiringCommandId,
        String wiringPayloadHash,
        UUID actorAccount) {
    }

    public record OrchestrateResubmitCommand(
        UUID applicationId,
        UUID returnId,
        UUID resubmissionId,
        UUID transitionEventId,
        String returnedFromStage,
        Instant returnedAt,
        String returnReason,
        String resumedStage,
        String responseBody,
        Instant resubmittedAt,
        UUID respondedBy,
        String respondedRole,
        UUID wiringCommandId,
        String wiringPayloadHash,
        UUID notifyCommandId,
        UUID taskCommandId,
        String taskPayloadHash,
        String taskOwnerRole,
        UUID taskOwnerAccount,
        Instant dueAt,
        UUID policyVersionId,
        UUID actorAccount) {
    }

    private final JdbcTemplate jdbc;

    public RegistrationReturnResponseWiringRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<CycleRow> findOpenCycle(UUID applicationId) {
        return jdbc.query(
            "SELECT id, application_id, cycle_seq, status, review_stage, task_id, discrepancy_id, last_resumed_stage "
                + "FROM registration_return_response_cycle WHERE application_id = ? AND status = 'open'",
            (rs, i) -> new CycleRow(
                rs.getObject("id", UUID.class),
                rs.getObject("application_id", UUID.class),
                rs.getInt("cycle_seq"),
                rs.getString("status"),
                rs.getString("review_stage"),
                rs.getObject("task_id", UUID.class),
                rs.getObject("discrepancy_id", UUID.class),
                rs.getString("last_resumed_stage")),
            applicationId).stream().findFirst();
    }

    public UUID orchestrateWiredReturn(OrchestrateWiredReturnCommand cmd) {
        try {
            return jdbc.queryForObject(
                "SELECT registration_return_response_orchestrate_wired_return(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                UUID.class,
                cmd.returnId(),
                cmd.applicationId(),
                cmd.transitionEventId(),
                cmd.fromStage(),
                cmd.reason(),
                cmd.returnedBy(),
                java.sql.Timestamp.from(cmd.returnedAt()),
                cmd.actorRole(),
                cmd.notifyCommandId(),
                cmd.notifyPayloadHash(),
                cmd.notifyMessageSuffix(),
                cmd.taskCommandId(),
                cmd.taskPayloadHash(),
                cmd.taskOwnerRole(),
                cmd.taskOwnerAccount(),
                java.sql.Timestamp.from(cmd.dueAt()),
                cmd.policyVersionId(),
                cmd.wiringCommandId(),
                cmd.wiringPayloadHash(),
                cmd.actorAccount());
        } catch (DataAccessException ex) {
            if (WorkflowFoundationRepository.isSqlMessage(ex, "registration_return_response_wiring_idempotency_conflict")) {
                throw new WorkflowIdempotencyConflictException();
            }
            throw ex;
        }
    }

    public void orchestrateResubmit(OrchestrateResubmitCommand cmd) {
        try {
            jdbc.query(
                "SELECT registration_return_response_orchestrate_resubmit(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                rs -> {
                },
                cmd.applicationId(),
                cmd.returnId(),
                cmd.resubmissionId(),
                cmd.transitionEventId(),
                cmd.returnedFromStage(),
                java.sql.Timestamp.from(cmd.returnedAt()),
                cmd.returnReason(),
                cmd.resumedStage(),
                cmd.responseBody(),
                java.sql.Timestamp.from(cmd.resubmittedAt()),
                cmd.respondedBy(),
                cmd.respondedRole(),
                cmd.wiringCommandId(),
                cmd.wiringPayloadHash(),
                cmd.notifyCommandId(),
                cmd.taskCommandId(),
                cmd.taskPayloadHash(),
                cmd.taskOwnerRole(),
                cmd.taskOwnerAccount(),
                java.sql.Timestamp.from(cmd.dueAt()),
                cmd.policyVersionId(),
                cmd.actorAccount());
        } catch (DataAccessException ex) {
            if (WorkflowFoundationRepository.isSqlMessage(ex, "registration_return_response_wiring_idempotency_conflict")) {
                throw new WorkflowIdempotencyConflictException();
            }
            throw ex;
        }
    }

    public Optional<String> wiringEvidenceHash(UUID commandId) {
        return jdbc.query(
            "SELECT payload_hash FROM registration_return_response_wiring_evidence WHERE command_id = ?",
            (rs, i) -> rs.getString("payload_hash"),
            commandId).stream().findFirst();
    }

    public int countDiscrepancyResponses(UUID discrepancyId) {
        Integer n = jdbc.queryForObject("SELECT count(*)::int FROM workflow_discrepancy_response WHERE discrepancy_id = ?", Integer.class, discrepancyId);
        return n == null ? 0 : n;
    }
}
