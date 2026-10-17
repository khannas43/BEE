# SNL WP02A — workflow foundation (implementation note)

**Status:** Foundation slice corrected (Brief 18A); ChatGPT acceptance pending. Journey wiring deferred to WP2B.
**Date:** 18 October 2026
**Migration:** `V69__workflow_foundation.sql` (editable in place until merge)
**Code:** `gov.bee.api.workflow.WorkingDaySla`, `WorkflowFoundationRepository`
**Tests:** `WorkingDaySlaTest`, `WorkflowFoundationDatabaseTest`

## Relation to existing journeys

Registration and model applications keep their current state columns and transition tables. WP2A tables are **parallel** (`subject_kind` + `subject_id`). No backfill and no change to existing APIs or screens.

## Transaction and security boundaries

- Multi-row commands use **`TransactionTemplate`** in `WorkflowFoundationRepository` (same pattern as other transactional repositories).
- Runtime **`UPDATE` on `workflow_task` is revoked**; owner/status/due changes go through **`workflow_foundation_set_task_fields`** (SECURITY DEFINER) plus an immutable **`workflow_task_event`** in one transaction.
- Task identity fields (`subject_*`, `stage`, `action`, `command_id`, `command_payload_hash`, `created_at`) are immutable after insert (trigger).
- Discrepancy identity fields are immutable; **status** changes only when `bee.workflow_discrepancy_status=allow` is set inside repository commands.
- **`workflow_sla_policy_version`** rows are append-only for runtime (maint may delete in tests).
- **Calendars/policies:** runtime has **SELECT only**; no calendar closure inserts at runtime.

## Idempotency

- Optional **`command_id`** + **`command_payload_hash`** (SHA-256 of canonical payload) on `workflow_task`.
- Same command + same payload → replay original task (including after **completed/cancelled**); no extra event.
- Same command + different payload → **`WorkflowIdempotencyConflictException`**.

## Policy versions

- Effective ranges are half-open **`[effective_from, effective_to)`** enforced with **`btree_gist` EXCLUDE**.
- Adjacent non-overlapping versions are allowed in either insert order.
- **`workflow_sla_clock_event.policy_version_id`** references the applied version row (not a free-text key).

## SLA clock

- **`responsible_party`:** `bureau` on `start`/`stop`; `applicant` on `pause`/`resume` while applicant must act (A17 pause semantics).
- **`WorkingDaySla.validateClockSequence`** refuses invalid sequences before insert.
- Open applicant pauses use an injected **`asOf`** end instant for elapsed-time calculation (no failure while still waiting).

## Discrepancy cycles

Statuses: `open` → `awaiting_review` → (`needs_more` → …)* → `closed`.

- Each **`workflow_discrepancy_disposition`** references a **`response_seq`** (FK to response); multiple dispositions per discrepancy when cycles continue.
- At most one **`needs_more`** disposition per discrepancy; later cycles must end with **`accepted`** or **`rejected`**. `needs_more` reopens applicant response; finals close the row.

## Subject delete integrity

**`BEFORE DELETE`** triggers on `registration_application` and `model_application` refuse delete when foundation rows reference the subject.

## Explicit deferrals (WP2B+)

Common transition APIs, UI, journey wiring, notification outbox, supervisor queue, 60-day job (BL-253), cancel/reject normalization (BL-256). A08/BL-255 remain unresolved in code.

## Evidence

- Flyway **V69** through rank 69 on throwaway schemas.
- **`WorkingDaySlaTest`** (unit) and **`WorkflowFoundationDatabaseTest`** (@Tag `db`).
