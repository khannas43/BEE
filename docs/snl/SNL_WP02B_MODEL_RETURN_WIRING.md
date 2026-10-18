# SNL WP02B-2 — model return/resubmit wiring (Brief 19B / 19B-A)

**Branch:** `cursor/snl-wp02b-model-return-wiring`
**Migration:** V71 (corrected in place for 19B-A)
**Status:** review corrections pending ChatGPT acceptance

**Transaction owner:** `@Transactional` on `StageReturnService` / `ResubmitApplicationService`; wiring runs in the same transaction. Post-wiring failures call `TransactionAspectSupport.currentTransactionStatus().setRollbackOnly()` before mapped HTTP errors so legacy rows roll back.

## Trusted command boundary (V71)

| Function | Runtime EXECUTE | Purpose |
| --- | --- | --- |
| `model_return_response_insert_return` | yes | Return row only after delivered foundation `returned` notification command; sets `foundation_notify_command_id` (skips V39 duplicate) |
| `model_return_response_link_cycle` | yes | Insert cycle row with task/discrepancy validation |
| `model_return_response_update_last_resumed_stage` | yes | Update `last_resumed_stage` only |
| `model_return_response_record_wiring_evidence` | yes | Idempotent wiring evidence |
| `model_return_response_append_response` | yes | Locked next discrepancy response seq |
| `model_return_response_officer_resubmit_notify` | yes | Fixed kind/suffix; recipient resolved in DB |
| `model_return_response_resolve_officer` | no | Internal helper |

**Runtime table access:** `SELECT` only on `model_return_response_cycle` and `model_return_response_wiring_evidence`; **REVOKE INSERT** on `model_application_return` (wired path uses insert command). Legacy V39 path uses `bee_app` / maint direct insert in tests (`StageReturnRepository.insertLegacyReturn`).

## Wired return sequence (production)

1. `transitionToReturned` (state + transition event)
2. `deliverApplicantReturnBeforeInsert` (V70 command)
3. `model_return_response_insert_return` (foundation FK)
4. `afterReturn` (task, clock, discrepancy, cycle; re-return adds disposition + notify)

## Officer resubmit notification

Resolved inside `model_return_response_officer_resubmit_notify` — Java cannot pass recipient. Director/secretary resumed stages use `returned_by_account_id`; assigned stages require exactly one active `assignment`.

## Replay keys

Unchanged from 19B: `commandId = UUID.nameUUIDFromBytes((idempotencyKey + "|" + purpose + "|" + applicationId).getBytes(UTF_8))`.

## Deferrals

- **19B-2:** task/disposition closure on stage forward after resubmit.
- **19B-A:** HTTP-level concurrent return/resubmit and rating-superseded officer journey (director return + changed rating) — not yet dedicated tests; DB officer rule covered for IAME assignment.

## Proof map (Brief 19B items 1–14)

| # | Test |
| --- | --- |
| 1 | `firstReturnCreatesTaskClockDiscrepancyAndOneApplicantNotification` |
| 2 | `firstReturnCreatesTaskClockDiscrepancyAndOneApplicantNotification`, `policyDueDateUsesPersistedCalendarForKnownReturnAnchor` |
| 3 | `resubmitAddsResponseResumeAndOfficerNotificationOnly`, `officerResubmitNotificationTargetsAssignedOfficerOnly` |
| 4 | `resubmitWithNoNoteUsesNeutralResponseBody` |
| 5–6 | `returnResubmitReturnCycleUsesNeedsMoreAndSameTask`, `fullDoubleCycleKeepsOneTaskAndContiguousResponses` |
| 7 | deferred (rating-superseded resubmit journey) |
| 8 | `lazyLinksPreV71OpenReturnOnFirstWiredResubmit` |
| 9 | `replayAddsNoExtraWiringEvidence`, `changedPayloadOnSameIdempotencyKeyConflicts` |
| 10 | deferred (concurrent HTTP) |
| 11 | `wiringConflictRollsBackLegacyReturnAndAllFoundationWrites`, `assigneeUnavailableRollsBackLegacyResubmitAndWorkflowWrites` |
| 12 | `assigneeUnavailableRollsBackLegacyResubmitAndWorkflowWrites` |
| 13 | `runtimeCannotForgeOrRewriteCycleOrEvidence`, `settingLegacyGucCannotBypassFoundationReturnInsert` |
| 14 | full `mvn test` + `ReworkDatabaseTest` (legacy owner insert / V39) |
