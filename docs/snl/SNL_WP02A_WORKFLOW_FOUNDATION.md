# SNL WP02A — workflow foundation (implementation note)

**Status:** Foundation slice corrected (Brief 18B); ChatGPT acceptance pending. Journey wiring deferred to WP2B.
**Date:** 18 October 2026
**Migration:** `V69__workflow_foundation.sql` (editable in place until merge)
**Code:** `gov.bee.api.workflow.WorkingDaySla`, `WorkflowFoundationRepository`
**Tests:** `WorkingDaySlaTest`, `WorkflowFoundationDatabaseTest`

## Relation to existing journeys

Registration and model applications keep their current state columns and transition tables. WP2A tables are **parallel** (`subject_kind` + `subject_id`). No backfill and no change to existing APIs or screens.

## Database command boundaries

Runtime **`bee_runtime`** may **not** insert or update foundation task rows, task events, discrepancy responses/dispositions, SLA clock rows, calendars or policies directly. It executes **`SECURITY DEFINER`** command functions only (pinned `search_path` ending in `pg_temp`, `PUBLIC` execute revoked):

| Function | Effect |
| --- | --- |
| `workflow_foundation_create_task` | Idempotent task insert (`ON CONFLICT` on `command_id`) plus exactly one `created` event when the row is new |
| `workflow_foundation_reassign_task` | Versioned owner change plus `reassigned` event |
| `workflow_foundation_terminal_task` | `completed` / `cancelled` plus matching event |
| `workflow_foundation_discrepancy_respond` | Row lock, contiguous `response_seq`, response row plus `awaiting_review` status |
| `workflow_foundation_discrepancy_dispose` | Disposition for the current undisposed response plus status (`needs_more` or `closed`) |
| `workflow_foundation_append_clock_event` | Advisory lock per subject, strict monotonic time and state machine, single insert |

Opening a discrepancy remains a direct **`INSERT`** on `workflow_discrepancy` (identity only; no status bypass).

Task identity and discrepancy identity fields stay immutable via triggers. Policy version rows are **never updated**; delete is allowed for **`bee_local_maint`** only when no clock event references the version.

## Idempotency

- **`command_id`** + **`command_payload_hash`** (SHA-256 canonical payload) on `workflow_task`.
- Same command + same payload → replay original task (including after terminal status); no extra event.
- Same command + different payload → **`workflow_idempotency_conflict`** / `WorkflowIdempotencyConflictException`.
- Concurrent creates with the same command ID rely on **`INSERT … ON CONFLICT DO NOTHING`**, not post-abort recovery in the same transaction.

## Policy versions

- Half-open **`[effective_from, effective_to)`** via **`btree_gist` EXCLUDE**.
- **`workflow_sla_clock_event.policy_version_id`** references the applied version row.

## SLA clock

- **`responsible_party`:** `bureau` on `start`/`stop`; `applicant` on `pause`/`resume`.
- DB command boundary enforces monotonic **strict** time (`<=` refused) and legal transitions.
- Java **`WorkingDaySla.validateClockSequence`** mirrors rules for derivation; **`applicantPausesFromClockEvents`** validates the full supplied sequence.

## Discrepancy cycles

Statuses: `open` → `awaiting_review` → (`needs_more` → …)* → `closed`.

- Any number of **`needs_more`** cycles; contiguous **`response_seq`** from 1; disposition must target the latest undisposed response.
- All responses and dispositions are append-only evidence.

## Subject delete integrity

**`BEFORE DELETE`** triggers on `registration_application` and `model_application` refuse delete when foundation rows reference the subject.

## Explicit deferrals (WP2B+)

Common transition APIs, UI, journey wiring, notification outbox, supervisor queue, 60-day job (BL-253), cancel/reject normalization (BL-256). A08/BL-255 remain unresolved in code.

## Evidence

- Flyway **V69** through rank 69 on throwaway schemas.
- **`WorkingDaySlaTest`** (unit) and **`WorkflowFoundationDatabaseTest`** (@Tag `db`), including two-connection concurrency cases.
