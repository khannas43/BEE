# SNL WP02A — workflow foundation (implementation note)

**Status:** Foundation slice accepted by ChatGPT on 18 October 2026. Journey wiring deferred to WP2B.
**Date:** 18 October 2026
**Migration:** `V69__workflow_foundation.sql` (editable in place until merge)
**Code:** `gov.bee.api.workflow.WorkingDaySla`, `WorkflowFoundationRepository`
**Tests:** `WorkingDaySlaTest`, `WorkflowFoundationDatabaseTest`

## Relation to existing journeys

Registration and model applications keep their current state columns and transition tables. WP2A tables are **parallel** (`subject_kind` + `subject_id`). No backfill and no change to existing APIs or screens.

## SLA clock identity

Each SLA-governed **`workflow_task`** has at most one **`workflow_sla_clock`** row (1:1, immutable `policy_version_id` and `policy_anchor_at`). Clock **events** append to **`workflow_sla_clock_event.clock_id`**, not to the application id. A subject may therefore run **`stop`** on one stage clock and later **`start`** a new clock on another task. Advisory locking is per **clock id**.

Policy applicability is checked at task/clock creation: the `policy_anchor_at` date in **Asia/Kolkata** must fall in the version’s half-open `[effective_from, effective_to)` range. Events do not carry a policy argument; the aggregate pins the version for the life of the clock.

## Database command boundaries

Runtime **`bee_runtime`** executes WP2A **`SECURITY DEFINER`** functions only (each pinned `search_path = <schema>, pg_temp`; V69 does **not** alter unrelated definer functions):

| Function | Effect |
| --- | --- |
| `workflow_foundation_create_task` | Task (+ optional SLA bundle) and exactly one `created` event when the row is new; idempotent via `ON CONFLICT` on `command_id` |
| `workflow_foundation_reassign_task` / `_terminal_task` | Versioned task change plus matching event |
| `workflow_foundation_discrepancy_respond` / `_dispose` | Locked response/disposition plus status |
| `workflow_foundation_append_clock_event` | Per-clock lock, strict monotonic time, state machine insert |

## SLA task creation

For an SLA task, **`due_at`**, **`policy_version_id`** and **`policy_anchor_at`** must all be present; for a non-SLA task, all three must be absent. **`due_at`** is immutable after insert (no `due_changed` event in WP2A). Idempotency hash covers due time and policy fields plus clock association on replay.

## Idempotency, discrepancies, policy, subject integrity

Unchanged from Brief 18B: payload-safe command replay, multi-cycle discrepancies, immutable policy version rows (delete only when unreferenced and maint), subject delete guards.

## Explicit deferrals (WP2B+)

Common transition APIs, UI, journey wiring, notification outbox, supervisor queue, 60-day job (BL-253), cancel/reject normalization (BL-256). A08/BL-255 remain unresolved in code.

## Evidence

- Flyway **V69** on throwaway schemas.
- **`WorkingDaySlaTest`** and **`WorkflowFoundationDatabaseTest`** (@Tag `db`), including per-clock concurrency, multi-clock subject cases and the India-date policy boundary.
- Final acceptance checks: backend **160/160**, database **287/287**, web **251/251**, and TypeScript clean.
