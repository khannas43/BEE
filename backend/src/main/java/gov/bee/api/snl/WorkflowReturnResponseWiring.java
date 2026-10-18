package gov.bee.api.snl;

import gov.bee.api.notifications.NotificationCommandRepository;
import gov.bee.api.policy.StageReturn;
import gov.bee.api.workflow.SnlReturnResponsePolicyRepository;
import gov.bee.api.workflow.WorkflowFoundationRepository;
import gov.bee.api.workflow.WorkflowIdempotencyConflictException;
import java.nio.charset.StandardCharsets;
import org.springframework.dao.DataAccessException;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** WP2B model return/resubmit wiring in the caller's transaction (Brief 19B). */
@Component
public class WorkflowReturnResponseWiring {

    static final String SUBJECT = WorkflowFoundationRepository.SUBJECT_MODEL;
    static final String DISCREPANCY_LINE = "return_response";
    static final String TASK_ACTION = "review";
    static final String NEUTRAL_RESUBMIT_BODY = "Applicant resubmitted the application.";
    static final DateTimeFormatter DUE_LABEL = DateTimeFormatter.ofPattern("d MMM uuuu", Locale.ENGLISH).withZone(ZoneId.of("Asia/Kolkata"));

    /** Test-only hook invoked after legacy transition and before trusted orchestration (Brief 19B-B). */
    static volatile Runnable testMidWiringFailureHook;

    private final ModelReturnResponseWiringRepository wiringRepo;
    private final WorkflowFoundationRepository foundation;
    private final SnlReturnResponsePolicyRepository policyRepo;

    public WorkflowReturnResponseWiring(ModelReturnResponseWiringRepository wiringRepo, WorkflowFoundationRepository foundation,
                                        SnlReturnResponsePolicyRepository policyRepo, NotificationCommandRepository notifications) {
        this.wiringRepo = wiringRepo;
        this.foundation = foundation;
        this.policyRepo = policyRepo;
    }

    public void completeWiredReturn(UUID applicationId, UUID returnId, UUID transitionEventId, String fromStage, String reason, Instant returnedAt,
                                    UUID actorAccountId, String actorRole, String idempotencyKey) {
        Runnable hook = testMidWiringFailureHook;
        if (hook != null) {
            hook.run();
        }
        var policy = policyRepo.requireApplicableVersion(returnedAt);
        Instant dueAt = policyRepo.dueAtEndOfWorkingDays(returnedAt, policy);
        String dueText = DUE_LABEL.format(dueAt);
        UUID notifyCommand = commandId(idempotencyKey, "model_return_notify", applicationId);
        String notifySuffix = "was returned to you: " + reason + " Respond by " + dueText + ". Edit it and send it again.";
        String notifyHash = NotificationCommandRepository.payloadHash(new NotificationCommandRepository.DeliverCommand(SUBJECT, applicationId, "returned", notifySuffix));
        StageReturn stageReturn = StageReturn.forState(fromStage).orElseThrow();
        UUID taskCommand = commandId(idempotencyKey, "model_return_task", applicationId);
        var taskCmd = new WorkflowFoundationRepository.TaskCommand(SUBJECT, applicationId, fromStage, TASK_ACTION, stageReturn.actor().role(), actorAccountId,
            dueAt, policy.id(), returnedAt);
        UUID wiringCommand = commandId(idempotencyKey, "model_return_wiring", applicationId);
        String wiringHash = sha256(returnId + "|" + fromStage + "|" + reason + "|" + returnedAt + "|return");
        try {
            wiringRepo.orchestrateWiredReturn(new ModelReturnResponseWiringRepository.OrchestrateWiredReturnCommand(
                returnId, applicationId, transitionEventId, fromStage, reason, actorAccountId, returnedAt, actorRole,
                notifyCommand, notifyHash, notifySuffix, taskCommand, WorkflowFoundationRepository.payloadHash(taskCmd), stageReturn.actor().role(), actorAccountId,
                dueAt, policy.id(), wiringCommand, wiringHash, actorAccountId));
        } catch (DataAccessException ex) {
            if (WorkflowFoundationRepository.isSqlMessage(ex, "model_return_response_wiring_idempotency_conflict")) {
                throw new WorkflowIdempotencyConflictException();
            }
            throw ex;
        }
    }

    public void afterResubmit(UUID applicationId, UUID returnId, UUID resubmissionId, String returnedFromStage, Instant returnedAt, String returnReason,
                              String resumedStage, String note, Instant resubmittedAt, UUID actorAccountId, String actorRole, String idempotencyKey) {
        Runnable hook = testMidWiringFailureHook;
        if (hook != null) {
            hook.run();
        }
        UUID wiringCommand = commandId(idempotencyKey, "model_resubmit_wiring", applicationId);
        String wiringHash = sha256(returnId + "|" + resumedStage + "|" + (note == null ? "" : note) + "|" + resubmittedAt + "|resubmit");
        String body = note == null || note.isBlank() ? NEUTRAL_RESUBMIT_BODY : note.trim();
        UUID notifyCommand = commandId(idempotencyKey, "model_resubmit_notify", applicationId);
        var policy = policyRepo.requireApplicableVersion(returnedAt);
        Instant dueAt = policyRepo.dueAtEndOfWorkingDays(returnedAt, policy);
        StageReturn stageReturn = StageReturn.forState(returnedFromStage).orElseThrow();
        UUID ownerAccount = wiringRepo.returnedByAccount(returnId);
        UUID taskCommand = commandId(idempotencyKey, "model_return_task", applicationId);
        var taskCmd = new WorkflowFoundationRepository.TaskCommand(SUBJECT, applicationId, returnedFromStage, TASK_ACTION, stageReturn.actor().role(), ownerAccount,
            dueAt, policy.id(), returnedAt);
        try {
            wiringRepo.orchestrateResubmit(new ModelReturnResponseWiringRepository.OrchestrateResubmitCommand(
                applicationId, returnId, resubmissionId, returnedFromStage, returnedAt, returnReason, resumedStage, body, resubmittedAt, actorAccountId, actorRole,
                wiringCommand, wiringHash, notifyCommand, taskCommand, WorkflowFoundationRepository.payloadHash(taskCmd), stageReturn.actor().role(), ownerAccount,
                dueAt, policy.id(), actorAccountId));
        } catch (DataAccessException ex) {
            if (WorkflowFoundationRepository.isSqlMessage(ex, "model_return_response_wiring_idempotency_conflict")) {
                throw new WorkflowIdempotencyConflictException();
            }
            throw ex;
        }
    }

    static UUID commandId(String idempotencyKey, String purpose, UUID applicationId) {
        return UUID.nameUUIDFromBytes((idempotencyKey + "|" + purpose + "|" + applicationId).getBytes(StandardCharsets.UTF_8));
    }

    static String sha256(String canonical) {
        return NotificationCommandRepository.sha256(canonical);
    }
}
