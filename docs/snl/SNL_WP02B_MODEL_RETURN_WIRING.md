# SNL WP02B-2 — model return/resubmit wiring (Brief 19B)

**Branch:** `cursor/snl-wp02b-model-return-wiring`
**Migration:** V71
**Transaction owner:** existing `@Transactional` on `StageReturnService` / `ResubmitApplicationService`; `WorkflowReturnResponseWiring` runs in the same transaction after legacy repository writes.

## Linkage

| Object | Role |
| --- | --- |
| `model_return_response_cycle` | One row per application while a return loop is active; holds `review_stage` (original return stage), `task_id`, `discrepancy_id`, optional `last_resumed_stage` |
| `model_return_response_wiring_evidence` | Append-only command ids + payload hashes for return/resubmit wiring and notifications (replay) |

First **return** creates the cycle, task (`{review_stage}` / `review`), SLA clock (policy anchor = return instant), discrepancy line `return_response`, clock `start` + `pause` (applicant), applicant notification via V70 command.

**Resubmit** on an existing cycle: next discrepancy response (neutral text if note absent), clock `resume`, officer notification only.

**Re-return** after a response: disposition `needs_more` on the latest undisposed response, clock `pause` again, applicant notification (new HTTP idempotency → new notify command).

**Pre-V71 returned row:** first **resubmit** lazily creates the cycle; clock `start`/`pause` are anchored at the open return’s `returned_at` (no bulk backfill).

## Assignee rule (officer resubmit notification)

| Resumed stage | Recipient |
| --- | --- |
| `iame_scrutiny`, `bee_scrutiny`, `rating` | Exactly one active `assignment` row for `subject_id` + `stage` |
| `director_review`, `secretary_approval` | `returned_by_account_id` on the open `model_application_return` (the officer who returned; all-scope stages have no assignment) |

Zero or multiple candidates → wiring throws → full rollback.

## Applicant return notification (V39 compatibility)

Before inserting `model_application_return`, the repository sets `bee.model_return_wired=true` for the transaction. `notify_on_return` skips when that GUC is set. Wiring delivers exactly one applicant `returned` notification (reference, reason, due date, edit instruction) via `notification_foundation_deliver`.

## Replay keys

`commandId = UUID.nameUUIDFromBytes((idempotencyKey + "|" + purpose + "|" + applicationId).getBytes(UTF_8))`

Purposes: `model_return_wiring`, `model_resubmit_wiring`, `model_return_notify`, `model_resubmit_notify`.

Payload hashes cover the fields listed in `WorkflowReturnResponseWiring` (including officer recipient id for resubmit notify).

## Deferrals (19B-2)

Closing the review task and discrepancy `accepted` on stage forward after resubmit remains with existing forward services; not part of this slice.

## Proof

| Brief 19B item | Test |
| --- | --- |
| 1 first return | `firstReturnCreatesTaskClockDiscrepancyAndOneApplicantNotification` |
| 2 policy/due in message | same (message contains `Respond by`) |
| 3 resubmit + officer notify | `resubmitAddsResponseResumeAndOfficerNotificationOnly` |
| 4 neutral note | `resubmitWithNoNoteUsesNeutralResponseBody` |
| 5–6 return cycles | `returnResubmitReturnCycleUsesNeedsMoreAndSameTask`, `fullDoubleCycleKeepsOneTaskAndContiguousResponses` |
| 8 lazy pre-V71 link | `lazyLinksPreV71OpenReturnOnFirstWiredResubmit` |
| 9 replay / conflict | `replayAddsNoExtraWiringEvidence`, `changedPayloadOnSameIdempotencyKeyConflicts` |
| 7 rating officer, 10 concurrency, 11 rollback, 12 ambiguous assignee, 13 runtime grants | deferred to 19B-2 follow-on or covered indirectly by V70/V69 suites; officer rule exercised via IAME assignment in item 3 |
| 14 legacy green | full `mvn test` + existing `ReworkDatabaseTest` (unwired return still uses V39 trigger) |
