package gov.bee.api.workflow;

/** Same command identity was reused with a different canonical payload. */
public class WorkflowIdempotencyConflictException extends RuntimeException {

    public WorkflowIdempotencyConflictException() {
        super("workflow_idempotency_conflict");
    }
}
