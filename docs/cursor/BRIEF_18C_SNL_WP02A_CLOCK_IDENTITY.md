# Brief 18C — SNL WP02A clock identity and due-date closure

## Purpose

Close the final WP2A design gap found in ChatGPT's review of commit `408db6d`. Continue on `cursor/snl-wp02a-workflow-foundation`; do not begin WP2B.

The Brief 18B command, audit, idempotency and concurrency corrections are accepted as implemented. Keep them intact. `V69__workflow_foundation.sql` is still unmerged and must be corrected in place.

## Review blockers

### 1. Give each SLA clock its own durable identity

The current clock command and event history are keyed only by `(subject_kind, subject_id)`. A subject can therefore have only one clock for its entire lifetime: after one stage records `stop`, a later stage cannot record another `start`. Registration and model journeys contain several review/payment/approval stages and must support more than one SLA clock for the same application.

- Add a durable clock aggregate/identity. Prefer a `workflow_sla_clock` row linked to exactly one `workflow_task`, with its fixed `policy_version_id`; use an equivalent normalized design only if it proves the same invariants.
- Key clock events and advisory locking by clock identity, not by application identity.
- Preserve subject integrity through the linked task; do not duplicate mutable subject/stage data unnecessarily.
- Permit multiple clocks over the life of one registration or model application, including `stop` on one task followed by `start` on a later task.
- Keep one legal `start → (pause → resume)* → stop` sequence per clock and preserve the strict timestamp/concurrency rules from Brief 18B.
- Update repository methods so callers append and load events for one clock identity. Do not expose a loader that merges unrelated stage clocks into one sequence.

### 2. Pin one policy version to the complete clock

The current command validates only that the supplied policy row exists. It does not require later events to use the policy version cited by the first event, so one clock can silently change policy mid-sequence.

- Store `policy_version_id` once on the clock aggregate and do not accept a different policy on individual events.
- Make the policy association immutable.
- Keep referenced policy versions protected from update/deletion.
- At clock/task creation, prove that the chosen policy version is applicable for its policy key and effective date. If policy selection remains a service responsibility, persist the selection anchor date/time and reject an internally inconsistent version; document the exact boundary.

### 3. Make task due time usable through the command boundary

`workflow_task.due_at` exists, but `workflow_foundation_create_task` cannot set it and runtime cannot update it. As a result, the foundation cannot create the due-dated pending tasks required by WP2.

- Extend the reviewed task-creation command and Java `TaskCommand`/mapping so an SLA-governed task atomically persists its due time and its clock/policy association.
- Define and enforce nullability: either all SLA fields are absent for a non-SLA task, or the due time, clock and policy association are all present for an SLA task.
- Do not add an unaudited generic task setter. If due-date changes are supported, use a dedicated versioned command with a `due_changed` event containing before/after values, actor, role and reason. Otherwise make due time immutable after task creation and remove any misleading unused event shape.
- Idempotency payload comparison must include all persisted command inputs, including due time and policy identity.

### 4. Do not rewrite unrelated security-definer functions

The current migration loops over every existing `SECURITY DEFINER` function in the schema and changes its `search_path`. That is outside WP2A's boundary and can change earlier application behaviour.

- Pin a safe `search_path` only on the WP2A functions created by V69.
- Do not alter unrelated pre-existing functions.
- Retain revoked `PUBLIC` execute and explicit `bee_runtime` grants for the WP2A command functions.

## Required proof

Add or revise tests that prove all of the following:

1. one subject can complete clock A and later start/complete clock B;
2. two tasks for different stages/actions of the same subject keep separate event histories;
3. an event cannot switch policy version within a clock (preferably the event does not accept a policy argument at all);
4. an SLA-governed task is created with its due time and clock/policy association in the same transaction;
5. a failed clock/task insert leaves no partial task, clock or creation event;
6. identical command replay returns the same task/clock and a changed due time or policy produces an idempotency conflict;
7. concurrent successors for the same clock still allow only one legal winner, while independent clocks for the same subject do not block or corrupt each other;
8. runtime cannot mutate task due time, clock policy, or clock/event rows directly;
9. the migration does not change the configured `search_path` of a representative pre-V69 security-definer function.

Update `docs/snl/SNL_WP02A_WORKFLOW_FOUNDATION.md` and the WP2 evidence/status in `docs/snl/BEE_SNL_IMPLEMENTATION_PLAN.md` to describe the final model truthfully. Keep WP2 **In progress** and ChatGPT acceptance pending.

## Boundaries

- No existing registration/model journey wiring or backfill.
- No controller, OpenAPI, BFF, UI, notification outbox, supervisor queue, scheduler, 60-day job or demo-data change.
- No hard-coded resolution of A08/BL-255/BL-256.
- No Word/PDF edits and no push.
- Do not add a new migration number; correct unmerged V69 in place.

## Required checks

- Focused workflow unit and database tests.
- `cd backend && mvn test`.
- `cd backend && mvn test -Dgroups=db -Dbee.test.excludedGroups=none`.
- `npx tsc --noEmit`.
- `npm run web:test`.
- `git diff --check main..HEAD` after commit.
- Clean tracked working tree. The owner-controlled untracked `docs/BEE_SNL_DEVELOPMENT_PLAN.docx` must remain untouched and must be reported separately; its presence does not authorize adding it.

## Handback

Run `/bee-handback`. Map every numbered blocker and proof item above to the final schema, code and exact test method. Report pass counts, commit hash, changed files, deferred items, and confirm that the Word file was not modified or added.
