# Brief 18B — SNL WP02A final integrity corrections

## Purpose

Close the remaining database-command and concurrency bypasses found in the second WP2A review. Continue on `cursor/snl-wp02a-workflow-foundation`. This remains an internal foundation; do not add journey wiring or HTTP/UI scope.

`V69__workflow_foundation.sql` is still unmerged and must be corrected in place.

## Remaining blockers

### 1. Remove unaudited task and discrepancy bypasses

The runtime can currently execute `workflow_foundation_set_task_fields` directly and change owner/status/due date without inserting a `workflow_task_event`. It can also call `set_config('bee.workflow_discrepancy_status', 'allow', true)` and then update discrepancy status directly.

- No runtime-executable primitive may change task owner, status or due date without appending the corresponding immutable event in the same database transaction.
- Replace the generic task-field setter with reviewed database command function(s), or otherwise make the event inseparable from the state change. Include expected version, actor, actor role and reason.
- Remove the user-settable GUC authorization mechanism for discrepancy status.
- Runtime must not have direct `UPDATE` on `workflow_discrepancy`; response/disposition command function(s) must append evidence and update status atomically.
- Prefer command functions with `SECURITY DEFINER`, pinned safe `search_path`, revoked `PUBLIC` execute and explicit runtime execute grants. Revoke direct table mutations that bypass them.
- Add tests that call every granted runtime function directly and prove an event/evidence row is inseparable from the state mutation. Prove direct task/discrepancy updates remain refused.

### 2. Make idempotent creation safe under a real concurrent race

The current catch-and-query path runs after a PostgreSQL constraint error inside the same transaction; PostgreSQL marks that transaction aborted, so the recovery query is not reliable under a true simultaneous insert.

- Use a non-aborting pattern such as `INSERT ... ON CONFLICT ... DO NOTHING RETURNING`, a safe command function, or an equivalent design.
- Preserve payload comparison: same command/same payload replays; same command/different payload conflicts.
- Add a two-connection concurrent test with the same command ID. Prove one task, one creation event and the same returned identity, without relying on sequential pre-checks.

### 3. Enforce SLA clock order at the database command boundary

`appendClockEvent` currently performs load → Java validation → insert without a transaction/subject lock. Two callers can both validate stale history and insert an invalid sequence. Direct runtime inserts also bypass Java validation.

- Revoke direct runtime insert on `workflow_sla_clock_event`.
- Add one database command boundary that serializes per subject (row/advisory lock or equivalent), validates strict event time and legal state, and inserts the event.
- Equal timestamps are non-monotonic and must be refused.
- Add two-connection concurrency proof and direct-insert refusal tests.
- Make `WorkingDaySla.validateClockSequence` reject equal timestamps.
- Make `applicantPausesFromClockEvents` validate the complete supplied sequence rather than silently accepting resume-before-pause or events after stop.

### 4. Remove arbitrary discrepancy-cycle limits and enforce sequence

The current “at most one `needs_more`” rule is not in the manual or assumptions and prevents BEE from requesting further evidence more than once.

- Permit any number of `needs_more` cycles until a final accepted/rejected disposition.
- Enforce contiguous response numbering beginning at 1.
- A disposition must target the current undisposed response.
- Preserve row-lock/concurrency protection so two responses or dispositions cannot win.
- Test at least three response cycles, gaps/duplicates, and concurrent attempts.

### 5. Make applied policy versions truly immutable

`workflow_sla_policy_immutable` currently allows `bee_local_maint` to update an applied policy row. That changes historical SLA meaning.

- No role may update a policy version in place.
- Permit maintenance deletion only if genuinely needed and only while unreferenced; referenced policy versions must remain protected by FK/trigger.
- Test owner/maint/runtime behavior and prove a clock-referenced version cannot be changed or deleted.

## Documentation and status

Update `docs/snl/SNL_WP02A_WORKFLOW_FOUNDATION.md` so it describes only the final enforced command boundaries—remove the GUC and generic setter claims.

Keep WP2 `In progress`. Do not mark ChatGPT acceptance complete. Adjust progress/checkmarks only if the corrected proof supports them.

## Required checks

- Focused workflow unit and database tests.
- `cd backend && mvn test`.
- `cd backend && mvn test -Dgroups=db -Dbee.test.excludedGroups=none`.
- `npx tsc --noEmit`.
- `npm run web:test`.
- `git diff --check main..HEAD` after commit.
- Clean working tree.

## Boundaries

- No existing registration/model behavior, backfill, controller, OpenAPI, BFF, UI, outbox or scheduler.
- No hard-coded resolution of A08/BL-255/BL-256.
- No Word/PDF changes and no push.

Run `/bee-handback` when complete. Map each section above to schema, code and tests, including the concurrent-test method names and pass counts.
