# SNL WP02B-2 — model return/resubmit wiring (Brief 19B / 19B-B)

**Branch:** `cursor/snl-wp02b-model-return-wiring`
**Migration:** V71 (corrected in place for 19B-B)
**Status:** review pending — do not mark 19B complete before ChatGPT acceptance

**Transaction owner:** `@Transactional` on `StageReturnService` / `ResubmitApplicationService`. Production wiring calls only V71 **orchestrate** commands in the same transaction. Post-wiring failures call `TransactionAspectSupport.currentTransactionStatus().setRollbackOnly()` before mapped HTTP errors so legacy rows roll back. SQL `DataAccessException` paths that map to `assignee_unavailable` skip `idempotency.abandon` so PostgreSQL does not reject cleanup on an aborted transaction.

## Trusted command boundary (V71)

| Function | Runtime EXECUTE | Purpose |
| --- | --- | --- |
| `model_return_response_orchestrate_wired_return` | yes | Atomic first/re-return bundle: V70 applicant notification (reason-bound), foundation return row, task/clock/discrepancy/cycle (first return) or re-return disposition/pause, wiring evidence |
| `model_return_response_orchestrate_resubmit` | yes | Atomic resubmit bundle: validates persisted resubmission + resumed stage, lazy cycle if needed, response/resume, officer notify, wiring evidence |
| `model_return_response_insert_return` | no | Internal — return row only with delivered, reason-bound foundation notification + transition match |
| `model_return_response_link_cycle` | no | Internal — cycle insert with task/discrepancy validation |
| `model_return_response_update_last_resumed_stage` | no | Internal — requires matching `model_application_resubmission` row and allowed stage |
| `model_return_response_record_wiring_evidence` | no | Internal — idempotent evidence only from orchestrate |
| `model_return_response_append_response` | no | Internal — locked next discrepancy response seq |
| `model_return_response_officer_resubmit_notify` | no | Internal — fixed kind/message; requires resubmission row; hash binds return id, resumed stage, recipient |
| `model_return_response_resolve_officer` | no | Internal helper |
| `notification_foundation_deliver` (V70) | yes | Used inside orchestrate for applicant return notify only in production path |

**Runtime table access:** `SELECT` only on `model_return_response_cycle` and `model_return_response_wiring_evidence`; **REVOKE INSERT** on `model_application_return`. Cycle identity columns are immutable via trigger; `last_resumed_stage` only via orchestrated resubmit.

## Wired return sequence (production)

1. `StageReturnService`: legacy transition to `returned`
2. `WorkflowReturnResponseWiring.completeWiredReturn` → `model_return_response_orchestrate_wired_return` (notification + return + workflow + evidence)

## Resubmit sequence (production)

1. `ResubmitApplicationService`: legacy resubmit row (includes `resubmissionId` in repository result)
2. `WorkflowReturnResponseWiring.afterResubmit` → `model_return_response_orchestrate_resubmit`

## Officer resubmit notification

`model_return_response_officer_resubmit_notify(command_id, application_id, return_id, resubmission_id, resumed_stage, actor)` — no suffix parameter; recipient and payload hash derived in the database from resubmission, return cycle, stage and assignment rules.

## Replay keys

Unchanged: `commandId = UUID.nameUUIDFromBytes((idempotencyKey + "|" + purpose + "|" + applicationId).getBytes(UTF_8))`.

## Test seam

`WorkflowReturnResponseWiring.testMidWiringFailureHook` (static volatile, test-only) runs before orchestrate calls to prove service-level rollback.

## Deferrals

- **19B-2:** task/disposition closure on stage forward after resubmit.
- **19C–19D:** registration wiring and consolidated read/concurrency plan evidence.

## Proof map (Brief 19B items 1–14)

| # | Test |
| --- | --- |
| 1 | `firstReturnCreatesTaskClockDiscrepancyAndOneApplicantNotification`, `wiredReturnCommandCreatesOrValidatesCompleteBundleAtomically` |
| 2 | `wiredReturnPersistsAndNotifiesExactCalendarDueDate`, `policyDueDateUsesPersistedCalendarForKnownReturnAnchor` |
| 3 | `resubmitAddsResponseResumeAndOfficerNotificationOnly`, `officerResubmitNotificationTargetsAssignedOfficerOnly`, `officerNotificationRequiresMatchingPersistedResubmission` |
| 4 | `resubmitWithNoNoteUsesNeutralResponseBody` |
| 5–6 | `returnResubmitReturnCycleUsesNeedsMoreAndSameTask`, `fullDoubleCycleKeepsOneTaskAndContiguousResponses` |
| 7 | `ratingSupersededResubmitReturnsToRatingAndNotifiesProgrammeAssignee` |
| 8 | `lazyLinksPreV71OpenReturnOnFirstWiredResubmit` |
| 9 | `replayAddsNoExtraWiringEvidence`, `changedPayloadOnSameIdempotencyKeyConflicts`, `trustedResubmitRecordsEvidenceAndStageExactlyOnce` |
| 10 | `concurrentServiceReturnCreatesOneCompleteOutcome`, `concurrentServiceResubmitCreatesOneCompleteOutcome`, `concurrentChangedPayloadHasOneWinnerAndOneConflict` |
| 11 | `wiringConflictRollsBackLegacyReturnAndAllFoundationWrites`, `serviceWiringConflictReturns409AndRollsBackEverything`, `wiredReturnInjectedFailureAfterTaskRollsBackAllWrites`, `serviceInjectedMidWorkflowFailureRollsBackEverything` |
| 12 | `assigneeUnavailableRollsBackLegacyResubmitAndWorkflowWrites`, `serviceAssigneeUnavailableReturns409AndRollsBackEverything` |
| 13 | `runtimeCannotForgeOrRewriteCycleOrEvidence`, `runtimeCannotForgeEvidenceThroughGrantedFunctions`, `runtimeCannotSetArbitraryOrUnmatchedResumedStage`, `runtimeCannotInsertReturnWithNotificationOnly`, `runtimeCannotInsertReturnWithMismatchedReasonStageActorOrTransition`, `settingLegacyGucCannotBypassFoundationReturnInsert` |
| 14 | Full `mvn test` + `mvn test -Dgroups=db -Dbee.test.excludedGroups=none` + `ReworkDatabaseTest` (legacy owner insert / V39) |
