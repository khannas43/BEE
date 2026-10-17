# Brief 18A — SNL WP02A review corrections

## Purpose

Correct the blocking integrity, transaction, replay and SLA-clock findings in Brief 18 before WP2A is accepted. Continue on `cursor/snl-wp02a-workflow-foundation`. Keep the slice internal: no journey wiring, HTTP API, OpenAPI, Next.js UI or scheduled job.

`V69__workflow_foundation.sql` is unmerged and may be corrected in place. Do not add a compensating V70 for defects in an unaccepted migration.

## Blocking findings to resolve

### 1. Make every multi-row command atomic

`WorkflowFoundationRepository` currently performs related writes using separate auto-commit statements. A failed second statement can leave a task without its creation event, a false reassignment event after an optimistic-lock failure, a response without the parent status change, or a disposition without the final status change.

- Give every multi-row command an explicit transaction boundary that works in production and in tests. Follow the project’s existing transactional-repository pattern.
- Creation, reassignment, task completion/cancellation/due-date changes, response, disposition and clock commands must commit all rows or none.
- For reassignment, no event may survive when the expected version is stale.
- Add failure-injection/constraint tests proving rollback, not merely success-path row counts.

### 2. Make idempotency payload-safe and durable

- The same `command_id` with the same canonical payload must replay the original result without another event.
- The same `command_id` with a different subject, stage, action, owner role/account or operation must fail as an idempotency conflict; it must never return an unrelated task.
- `command_id` must remain recorded after a task is completed or cancelled. Remove the constraint that permits a command ID only while status is `open`.
- Add tests for identical replay, conflicting replay and replay after terminal task status.

### 3. Prevent unaudited mutation

Broad runtime `UPDATE` grants currently allow callers to change task subject/stage/action/owner/status/due date or discrepancy identity/status without a matching immutable event.

- Make task identity fields immutable after insert.
- Ensure owner, status and due-date changes can occur only through reviewed commands that also append the corresponding event in the same transaction.
- Make discrepancy identity, summary and opener immutable. Status changes must follow the response/disposition lifecycle and cannot be arbitrary runtime updates.
- Tighten grants and/or add database guards so direct runtime tampering is refused.
- Test every protected class of field, not only `workflow_task_event` updates.

### 4. Support repeated discrepancy cycles correctly

The current unique disposition per discrepancy makes `needs_more` terminal and prevents a second response/review cycle.

- Support: open discrepancy → response 1 → disposition `needs_more` → response 2 → final `accepted` or `rejected`.
- Bind each disposition to the response version it reviews; preserve every response and disposition as append-only evidence.
- `needs_more` must leave the discrepancy awaiting another applicant response. `accepted`/`rejected` must close it.
- Refuse response after a final disposition, disposition without an undisposed response, duplicate disposition for one response, and invalid/gapped sequencing as appropriate to the chosen design.
- Add database tests for the full two-cycle journey and all refusals.

### 5. Make policy versioning concurrency-safe and reproducible

- Define effective ranges explicitly as half-open `[effective_from, effective_to)`.
- Adjacent versions must be accepted in either insertion order.
- Overlapping versions must be refused under concurrent inserts, not only sequential trigger checks. Use a database-enforced exclusion/locking design compatible with this repository.
- Clock/task evidence must reference the exact applied policy-version ID, not a free `policy_key`, so historical calculations remain reproducible.
- An applied policy version must not be editable or deletable. Test the immutability rule.

### 6. Enforce valid SLA clock sequences

- Define `responsible_party` semantics clearly in the design note.
- Refuse invalid sequences such as resume before start/pause, duplicate start, nested pause, stop while paused without an explicit rule, events after stop, or non-monotonic event time.
- Java derivation must reject malformed sequences deterministically.
- An applicant pause that is still open must be calculable up to an injected `asOf`/end instant; dashboards cannot fail merely because the application is currently waiting on the applicant.
- Prevent double subtraction from overlapping pause intervals, either by rejecting overlap or normalizing it.
- Replace weak “less than” assertions with exact expected elapsed durations, including same-day, weekend/closure, open-pause and year-boundary cases.

### 7. Close subject-integrity and privilege gaps

- The polymorphic subject guard validates child insertion but does not itself prevent later parent deletion. Either enforce parent-delete integrity in the database or prove and document an existing database rule that prevents orphaning for both subject types.
- Test both registration and model parent-deletion behavior.
- Verify the runtime cannot edit calendars/policies and cannot bypass task, discrepancy or event history. Verify maintenance behavior remains sufficient for isolated test cleanup without granting production runtime powers.

## Documentation and plan

Update `docs/snl/SNL_WP02A_WORKFLOW_FOUNDATION.md` to match the corrected semantics and transactional/security boundaries. Remove claims that are not proven.

Update `docs/snl/BEE_SNL_IMPLEMENTATION_PLAN.md` truthfully. WP2 remains `In progress`; do not mark WP2A evidence accepted until ChatGPT review. Check only items actually proven after this correction pass. Use the next backlog ID only for a genuinely deferred gap, not for a defect fixed here.

## Required checks

- Focused `WorkingDaySlaTest` and `WorkflowFoundationDatabaseTest`.
- Full default backend suite: `cd backend && mvn test`.
- Full DB-tagged backend suite, not only the new test class: `cd backend && mvn test -Dgroups=db -Dbee.test.excludedGroups=none`.
- `npx tsc --noEmit`.
- `npm run web:test`.
- `git diff --check main..HEAD` after the correction commit.
- Clean working tree before handback.

## Boundaries

- No existing registration/model transition behavior or backfill.
- No controller, OpenAPI, BFF, UI, notification outbox or scheduler.
- No hard-coded resolution of A08/BL-255 or BL-256.
- No Word/PDF changes and no push.

When complete, run `/bee-handback`. Map every numbered finding above to its code/schema/test resolution and report exact pass counts.
