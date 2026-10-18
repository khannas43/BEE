package gov.bee.api.snl;

import gov.bee.api.notifications.NotificationCommandRepository;
import gov.bee.api.workflow.SnlReturnResponsePolicyRepository;
import gov.bee.api.workflow.WorkflowFoundationRepository;
import gov.bee.api.workflow.WorkflowIdempotencyConflictException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.UUID;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Component;

/** WP2C registration return/resubmit wiring in the caller's transaction (Brief 19C-B). */
@Component
public class RegistrationReturnResponseWiring {

    static final String SUBJECT = WorkflowFoundationRepository.SUBJECT_REGISTRATION;
    static final String TASK_ACTION = "review";
    static final String NEUTRAL_RESUBMIT_BODY = "Applicant resubmitted the registration request.";
    static final DateTimeFormatter DUE_LABEL = DateTimeFormatter.ofPattern("d MMM uuuu", Locale.ENGLISH).withZone(ZoneId.of("Asia/Kolkata"));

    /** Test-only hook invoked after legacy transition and before trusted orchestration. */
    static volatile Runnable testMidWiringFailureHook;

    private final RegistrationReturnResponseWiringRepository wiringRepo;
    private final SnlReturnResponsePolicyRepository policyRepo;

    public RegistrationReturnResponseWiring(RegistrationReturnResponseWiringRepository wiringRepo, SnlReturnResponsePolicyRepository policyRepo) {
        this.wiringRepo = wiringRepo;
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
        UUID notifyCommand = commandId(idempotencyKey, "registration_return_notify", applicationId);
        String notifySuffix = "was returned to you: " + reason + " Respond by " + dueText + ". Edit it and send it again.";
        String notifyHash = NotificationCommandRepository.payloadHash(
            new NotificationCommandRepository.DeliverCommand(SUBJECT, applicationId, "returned", notifySuffix));
        UUID taskCommand = commandId(idempotencyKey, "registration_return_task", applicationId);
        var taskCmd = new WorkflowFoundationRepository.TaskCommand(SUBJECT, applicationId, fromStage, TASK_ACTION, actorRole, actorAccountId, dueAt, policy.id(),
            returnedAt);
        UUID wiringCommand = commandId(idempotencyKey, "registration_return_wiring", applicationId);
        String taskPayloadHash = WorkflowFoundationRepository.payloadHash(taskCmd);
        String wiringHash = wiringRepo.computeReturnHash(applicationId, transitionEventId, returnId, fromStage, reason, actorAccountId, returnedAt, actorRole,
            notifyCommand, notifyHash, notifySuffix, taskCommand, taskPayloadHash, actorRole, actorAccountId, dueAt, policy.id(), actorAccountId);
        try {
            wiringRepo.orchestrateWiredReturn(new RegistrationReturnResponseWiringRepository.OrchestrateWiredReturnCommand(
                returnId, applicationId, transitionEventId, fromStage, reason, actorAccountId, returnedAt, actorRole,
                notifyCommand, notifyHash, notifySuffix, taskCommand, taskPayloadHash, actorRole, actorAccountId,
                dueAt, policy.id(), wiringCommand, wiringHash, actorAccountId));
        } catch (DataAccessException ex) {
            if (WorkflowFoundationRepository.isSqlMessage(ex, "registration_return_response_wiring_idempotency_conflict")) {
                throw new WorkflowIdempotencyConflictException();
            }
            throw ex;
        }
    }

    public void completeResubmit(UUID applicationId, UUID returnId, UUID resubmissionId, UUID transitionEventId, String returnedFromStage, Instant returnedAt,
                                 String returnReason, String note, Instant resubmittedAt, UUID actorAccountId, String actorRole, UUID taskOwnerAccountId,
                                 String taskOwnerRole, String idempotencyKey) {
        Runnable hook = testMidWiringFailureHook;
        if (hook != null) {
            hook.run();
        }
        var policy = policyRepo.requireApplicableVersion(returnedAt);
        Instant dueAt = policyRepo.dueAtEndOfWorkingDays(returnedAt, policy);
        String body = note == null || note.isBlank() ? NEUTRAL_RESUBMIT_BODY : note.trim();
        UUID wiringCommand = commandId(idempotencyKey, "registration_resubmit_wiring", applicationId);
        UUID notifyCommand = commandId(idempotencyKey, "registration_resubmit_notify", applicationId);
        UUID taskCommand = commandId(idempotencyKey, "registration_resubmit_task", applicationId);
        var taskCmd = new WorkflowFoundationRepository.TaskCommand(SUBJECT, applicationId, returnedFromStage, TASK_ACTION, taskOwnerRole, taskOwnerAccountId,
            dueAt, policy.id(), returnedAt);
        String taskPayloadHash = WorkflowFoundationRepository.payloadHash(taskCmd);
        String wiringHash = wiringRepo.computeResubmitHash(applicationId, returnId, resubmissionId, transitionEventId, returnedFromStage, returnedAt, returnReason,
            "programme_review", body, resubmittedAt, actorAccountId, actorRole, notifyCommand, taskCommand, taskPayloadHash, taskOwnerRole, taskOwnerAccountId,
            dueAt, policy.id(), actorAccountId);
        try {
            wiringRepo.orchestrateResubmit(new RegistrationReturnResponseWiringRepository.OrchestrateResubmitCommand(
                applicationId, returnId, resubmissionId, transitionEventId, returnedFromStage, returnedAt, returnReason, "programme_review", body, resubmittedAt,
                actorAccountId, actorRole, wiringCommand, wiringHash, notifyCommand, taskCommand, taskPayloadHash,
                taskOwnerRole, taskOwnerAccountId, dueAt, policy.id(), actorAccountId));
        } catch (DataAccessException ex) {
            if (WorkflowFoundationRepository.isSqlMessage(ex, "registration_return_response_wiring_idempotency_conflict")) {
                throw new WorkflowIdempotencyConflictException();
            }
            throw ex;
        }
    }

    static UUID commandId(String idempotencyKey, String purpose, UUID applicationId) {
        return UUID.nameUUIDFromBytes((idempotencyKey + "|" + purpose + "|" + applicationId).getBytes(StandardCharsets.UTF_8));
    }
}
