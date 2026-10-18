package gov.bee.api.snl;

import gov.bee.api.notifications.NotificationCommandRepository;
import gov.bee.api.policy.StageReturn;
import gov.bee.api.workflow.SnlReturnResponsePolicyRepository;
import gov.bee.api.workflow.WorkflowFoundationRepository;
import gov.bee.api.workflow.WorkflowIdempotencyConflictException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.Optional;
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

    private final ModelReturnResponseWiringRepository wiringRepo;
    private final WorkflowFoundationRepository foundation;
    private final SnlReturnResponsePolicyRepository policyRepo;
    private final NotificationCommandRepository notifications;

    public WorkflowReturnResponseWiring(ModelReturnResponseWiringRepository wiringRepo, WorkflowFoundationRepository foundation,
                                        SnlReturnResponsePolicyRepository policyRepo, NotificationCommandRepository notifications) {
        this.wiringRepo = wiringRepo;
        this.foundation = foundation;
        this.policyRepo = policyRepo;
        this.notifications = notifications;
    }

    public void afterReturn(UUID applicationId, UUID returnId, String fromStage, String reason, Instant returnedAt, UUID actorAccountId, String actorRole,
                            String idempotencyKey) {
        UUID wiringCommand = commandId(idempotencyKey, "model_return_wiring", applicationId);
        String wiringHash = sha256(returnId + "|" + fromStage + "|" + reason + "|" + returnedAt + "|return");
        if (replayIfComplete(wiringCommand, wiringHash)) {
            return;
        }

        var policy = policyRepo.requireApplicableVersion(returnedAt);
        Instant dueAt = policyRepo.dueAtEndOfWorkingDays(returnedAt, policy);
        String dueText = DUE_LABEL.format(dueAt);

        Optional<ModelReturnResponseWiringRepository.CycleRow> existing = wiringRepo.findCycle(applicationId);
        if (existing.isPresent()) {
            reReturn(existing.get(), reason, returnedAt, actorAccountId, dueText, idempotencyKey, applicationId);
        } else {
            firstReturn(applicationId, fromStage, reason, returnedAt, actorAccountId, actorRole, dueAt, policy.id(), idempotencyKey, dueText);
        }
        wiringRepo.recordWiringEvidence(wiringCommand, applicationId, "model_return_wiring", wiringHash);
    }

    void firstReturn(UUID applicationId, String fromStage, String reason, Instant returnedAt, UUID actorAccountId, String actorRole, Instant dueAt,
                     UUID policyVersionId, String idempotencyKey, String dueText) {
        StageReturn stageReturn = StageReturn.forState(fromStage).orElseThrow();
        UUID taskCommand = commandId(idempotencyKey, "model_return_task", applicationId);
        var taskCmd = new WorkflowFoundationRepository.TaskCommand(SUBJECT, applicationId, fromStage, TASK_ACTION, stageReturn.actor().role(), actorAccountId,
            dueAt, policyVersionId, returnedAt);
        var task = foundation.createTaskIdempotent(taskCmd, taskCommand, actorAccountId, actorRole);
        UUID discrepancyId = foundation.openDiscrepancy(SUBJECT, applicationId, DISCREPANCY_LINE, reason, actorAccountId);
        wiringRepo.insertCycle(applicationId, fromStage, task.id(), discrepancyId);
        var clock = foundation.findClockByTaskId(task.id()).orElseThrow();
        foundation.appendClockEvent(clock.id(), "start", "bureau", returnedAt, null);
        foundation.appendClockEvent(clock.id(), "pause", "applicant", returnedAt.plusMillis(1), null);
        deliverApplicantReturn(applicationId, reason, dueText, actorAccountId, idempotencyKey);
    }

    void reReturn(ModelReturnResponseWiringRepository.CycleRow cycle, String reason, Instant returnedAt, UUID actorAccountId, String dueText,
                  String idempotencyKey, UUID applicationId) {
        String status = wiringRepo.discrepancyStatus(cycle.discrepancyId());
        if ("awaiting_review".equals(status)) {
            int seq = wiringRepo.latestUndisposedResponseSeq(cycle.discrepancyId()).orElseThrow();
            foundation.disposeDiscrepancy(cycle.discrepancyId(), seq, "needs_more", reason, actorAccountId);
        }
        var clock = foundation.findClockByTaskId(cycle.taskId()).orElseThrow();
        foundation.appendClockEvent(clock.id(), "pause", "applicant", returnedAt.plusMillis(1), null);
        deliverApplicantReturn(applicationId, reason, dueText, actorAccountId, idempotencyKey);
    }

    public void afterResubmit(UUID applicationId, UUID returnId, String returnedFromStage, Instant returnedAt, String returnReason, String resumedStage,
                              String note, Instant resubmittedAt, UUID actorAccountId, String actorRole, String idempotencyKey) {
        UUID wiringCommand = commandId(idempotencyKey, "model_resubmit_wiring", applicationId);
        String wiringHash = sha256(returnId + "|" + resumedStage + "|" + (note == null ? "" : note) + "|" + resubmittedAt + "|resubmit");
        if (replayIfComplete(wiringCommand, wiringHash)) {
            return;
        }

        ModelReturnResponseWiringRepository.CycleRow cycle = wiringRepo.findCycle(applicationId)
            .orElseGet(() -> lazyCreateCycle(applicationId, returnId, returnedFromStage, returnedAt, returnReason, actorAccountId, actorRole, idempotencyKey));

        wiringRepo.updateLastResumedStage(applicationId, resumedStage);

        int seq = wiringRepo.nextResponseSeq(cycle.discrepancyId());
        String body = note == null || note.isBlank() ? NEUTRAL_RESUBMIT_BODY : note.trim();
        foundation.addDiscrepancyResponse(cycle.discrepancyId(), seq, body, actorAccountId);

        var clock = foundation.findClockByTaskId(cycle.taskId()).orElseThrow();
        foundation.appendClockEvent(clock.id(), "resume", "applicant", resubmittedAt.plusMillis(1), null);

        UUID officer = resolveOfficer(applicationId, returnId, resumedStage);
        UUID notifyCommand = commandId(idempotencyKey, "model_resubmit_notify", applicationId);
        var notify = new NotificationCommandRepository.RecipientDeliverCommand(SUBJECT, applicationId, "applicant_resubmitted",
            "was resubmitted by the applicant.", officer);
        notifications.deliverToRecipient(notify, notifyCommand, actorAccountId);

        wiringRepo.recordWiringEvidence(wiringCommand, applicationId, "model_resubmit_wiring", wiringHash);
        wiringRepo.recordWiringEvidence(notifyCommand, applicationId, "model_resubmit_notify", NotificationCommandRepository.recipientPayloadHash(notify));
    }

    ModelReturnResponseWiringRepository.CycleRow lazyCreateCycle(UUID applicationId, UUID returnId, String returnedFromStage, Instant returnedAt,
                                                                 String returnReason, UUID actorAccountId, String actorRole, String idempotencyKey) {
        var policy = policyRepo.requireApplicableVersion(returnedAt);
        Instant dueAt = policyRepo.dueAtEndOfWorkingDays(returnedAt, policy);
        StageReturn stageReturn = StageReturn.forState(returnedFromStage).orElseThrow();
        UUID ownerAccount = wiringRepo.returnedByAccount(returnId);
        UUID taskCommand = commandId(idempotencyKey, "model_return_task", applicationId);
        var taskCmd = new WorkflowFoundationRepository.TaskCommand(SUBJECT, applicationId, returnedFromStage, TASK_ACTION, stageReturn.actor().role(), ownerAccount,
            dueAt, policy.id(), returnedAt);
        var task = foundation.createTaskIdempotent(taskCmd, taskCommand, actorAccountId, actorRole);
        UUID discrepancyId = foundation.openDiscrepancy(SUBJECT, applicationId, DISCREPANCY_LINE, returnReason, ownerAccount);
        wiringRepo.insertCycle(applicationId, returnedFromStage, task.id(), discrepancyId);
        var clock = foundation.findClockByTaskId(task.id()).orElseThrow();
        foundation.appendClockEvent(clock.id(), "start", "bureau", returnedAt, null);
        foundation.appendClockEvent(clock.id(), "pause", "applicant", returnedAt.plusMillis(1), null);
        return wiringRepo.findCycle(applicationId).orElseThrow();
    }

    void deliverApplicantReturn(UUID applicationId, String reason, String dueText, UUID actorAccountId, String idempotencyKey) {
        UUID notifyCommand = commandId(idempotencyKey, "model_return_notify", applicationId);
        String suffix = "was returned to you: " + reason + " Respond by " + dueText + ". Edit it and send it again.";
        var cmd = new NotificationCommandRepository.DeliverCommand(SUBJECT, applicationId, "returned", suffix);
        notifications.deliver(cmd, notifyCommand, actorAccountId);
        wiringRepo.recordWiringEvidence(notifyCommand, applicationId, "model_return_notify", NotificationCommandRepository.payloadHash(cmd));
    }

    UUID resolveOfficer(UUID applicationId, UUID returnId, String resumedStage) {
        if ("director_review".equals(resumedStage) || "secretary_approval".equals(resumedStage)) {
            return wiringRepo.returnedByAccount(returnId);
        }
        return wiringRepo.soleActiveAssignee(applicationId, resumedStage)
            .orElseThrow(() -> new IllegalStateException("model_return_officer_ambiguous"));
    }

    boolean replayIfComplete(UUID commandId, String payloadHash) {
        Optional<String> prior = wiringRepo.wiringEvidenceHash(commandId);
        if (prior.isEmpty()) {
            return false;
        }
        if (!prior.get().equals(payloadHash)) {
            throw new WorkflowIdempotencyConflictException();
        }
        return true;
    }

    static UUID commandId(String idempotencyKey, String purpose, UUID applicationId) {
        return UUID.nameUUIDFromBytes((idempotencyKey + "|" + purpose + "|" + applicationId).getBytes(StandardCharsets.UTF_8));
    }

    static String sha256(String canonical) {
        return NotificationCommandRepository.sha256(canonical);
    }
}
