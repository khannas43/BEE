# SNL WP02A — workflow foundation (implementation note)

**Status:** Foundation slice complete; journey wiring deferred to WP2B.
**Date:** 18 October 2026
**Migration:** `V69__workflow_foundation.sql`
**Code:** `gov.bee.api.workflow.WorkingDaySla`, `WorkflowFoundationRepository`
**Tests:** `WorkingDaySlaTest`, `WorkflowFoundationDatabaseTest`

## Relation to existing journeys

Registration and model applications keep their current state columns and transition tables (`registration_application`, `model_application_*` events). WP2A tables are **parallel**: they key off `subject_kind` + `subject_id` without triggers on existing applications. No backfill and no change to existing APIs or screens.

| Existing | WP2A foundation |
|---|---|
| `registration_application.state` | Optional future link via `workflow_task.subject_kind = registration_application` |
| `model_application_return` / `resubmission` | Future mapping to `workflow_discrepancy` + responses |
| Ad hoc assignments | Future mapping to `workflow_task` owner fields + `workflow_task_event` |

## Tables

| Table | Purpose | Mutable by runtime | Retention |
|---|---|---|---|
| `workflow_calendar` | Named calendar, `Asia/Kolkata`, ISO weekday non-working set | Admin/maint configure | Indefinite |
| `workflow_calendar_closure` | Dated public holidays / closures | Admin/maint | Indefinite |
| `workflow_sla_policy_version` | Effective-dated SLA policy (**working_day_limit** is data, not 7/12/15/60) | Admin/maint insert; overlap refused | Version history |
| `workflow_task` | Open work item per subject/stage/action | Update status, owner, due, version | Life of subject |
| `workflow_task_event` | Immutable audit of create/reassign/complete/cancel | Append-only | Permanent |
| `workflow_discrepancy` | Structured line item | Status only | Permanent |
| `workflow_discrepancy_response` | Applicant reply versions | Append-only | Permanent |
| `workflow_discrepancy_disposition` | Reviewer outcome (requires ≥1 response) | Append-only, one per discrepancy | Permanent |
| `workflow_sla_clock_event` | Start/pause/resume/stop for SLA proof | Append-only | Permanent |

**Subject integrity:** only `registration_application` and `model_application` kinds; `workflow_validate_subject()` checks row existence (polymorphic FK pattern).

## Task ownership and concurrency

- At most **one open** task per `(subject_kind, subject_id, stage, action)` (partial unique index).
- **Optimistic locking:** `workflow_task.version` must increment by exactly 1 per update (`workflow_task_version_guard`).
- **Reassignment:** append `workflow_task_event` with from/to owner and reason, then update task owner and version.
- **Idempotency:** optional `command_id` UUID with unique index; duplicate command returns existing task (repository helper).

## SLA semantics (A17 provisional)

- Calendar days use **Asia/Kolkata** (`WorkingDaySla.ZONE`).
- **Due date:** `dueAtEndOfWorkingDay(start, working_day_limit, calendar)` — limit comes from `workflow_sla_policy_version`, not hard-coded manual tables.
- **Pause:** `workflow_sla_clock_event` with `responsible_party = applicant` marks applicant-wait; `WorkingDaySla.elapsedWorkingMillis` subtracts pause intervals.
- **A08 / BL-255 / BL-256:** which limit and whether expiry means cancel vs reject are **not** encoded in this slice.

## Discrepancy linkage

1. Officer opens `workflow_discrepancy` (`line_code` stable per subject).
2. Applicant appends `workflow_discrepancy_response` (monotonic `response_seq`).
3. Reviewer appends `workflow_discrepancy_disposition` (DB trigger requires a response first).
4. Status on parent discrepancy moves `open` → `responded` → `disposed`.

## Notifications (deferred)

Later WP2 slice will insert notification/outbox rows in the **same transaction** as task/discrepancy transitions. No outbox table in WP2A.

## Explicit deferrals (WP2B+)

- Common transition HTTP APIs and OpenAPI
- Next.js workflow UI, My work, supervisor queue
- Wiring registration/model services to foundation tables
- Notification outbox in transition transaction
- 60-day scheduled job (BL-253) and cancel/reject normalization (BL-256)
- Supervisor queue (legacy B15) as first-class tasks

## Evidence

- Flyway **V69** on throwaway schema through existing chain (rank 69).
- Database tests under `WorkflowFoundationDatabaseTest` (@Tag `db`).
- Unit tests under `WorkingDaySlaTest`.
