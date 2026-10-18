# SNL WP02B-2 — model return/resubmit wiring (Brief 19B / 19B-B / 19B-2)

**Branch:** `cursor/snl-wp02b-model-forward-closure` (19B-2)
**Migrations:** V71 (return/resubmit), V72 (cycle lifecycle + forward closure)
**Status:** 19B and 19B-2 accepted 18 Oct 2026; V72 merged to `main` at `798667e`

## Transaction boundary

`@Transactional` on stage commands (`StageReturnService`, `ResubmitApplicationService`, and each resumed-stage forward service). Production wiring calls only V71/V72 **orchestrate** commands in the same transaction as the legacy transition row. Post-wiring failures call `TransactionAspectSupport.currentTransactionStatus().setRollbackOnly()` before mapped HTTP errors so legacy rows roll back. SQL `DataAccessException` paths that map to `assignee_unavailable` skip `idempotency.abandon` on resubmit/return where PostgreSQL would reject cleanup on an aborted transaction.

| Phase | Owner | Trusted call |
| --- | --- | --- |
| Return | `StageReturnService` | `model_return_response_orchestrate_wired_return` |
| Resubmit | `ResubmitApplicationService` | `model_return_response_orchestrate_resubmit` |
| Accepted forward (resumed stage) | `IameRecommendationService`, `ReviewerForwardService`, `RatingService`, `DirectorRecommendationService`, `SecretaryApprovalService` | `model_return_response_orchestrate_forward_closure` via `WorkflowReturnResponseWiring.afterAcceptedForward` |

Hooks run only after a **new** legacy write (`Outcome` success), never on HTTP idempotency replay.

## Return cycle model (V72)

Each `model_return_response_cycle` row is one auditable return episode:

| Field | Role |
| --- | --- |
| `cycle_seq` | Stable per-application sequence (1, 2, …); never rewritten |
| `status` | `open` while the applicant may respond and officers work the return task; `closed` after accepted forward |
| `review_stage`, `task_id`, `discrepancy_id` | Immutable identity for the episode |
| `last_resumed_stage` | Updated on wired resubmit only while `open` |
| `closure_*` | Set once on close: transition event id, from/to state, `closed_at` |
| `model_return_response_cycle_return` | Append-only `(cycle_id, return_id)` link; each return binds to exactly one cycle |

Rules:

- At most **one** `open` cycle per application (partial unique index).
- `UNIQUE (application_id, cycle_seq)`, `UNIQUE (task_id)`, `UNIQUE (discrepancy_id)`; declarative open/closed lifecycle `CHECK`.
- Resubmit, notify, response resume and forward closure use the **latest return bound to the open cycle**; stale returns from closed cycles are refused.
- V71 rows migrate to `cycle_seq = 1`, `status = open` with history untouched.
- **Re-return before accepted forward** (same open cycle): existing V71 `needs_more` + same task/discrepancy.
- **Return after accepted forward** (prior cycle closed): new task, clock, discrepancy, and cycle row; `workflow_discrepancy` subject uniqueness on `(subject_kind, subject_id, line_code)` is dropped so multiple `return_response` discrepancies can exist across closed cycles (cycle ↔ discrepancy id is the occurrence key).
- Closed cycles reject new responses, dispositions (except those already recorded), and clock events on their pinned task.

## Stage-forward transition map (19B-2)

| Resumed stage (`last_resumed_stage`) | Legacy action | From → to | Service |
| --- | --- | --- | --- |
| `iame_scrutiny` | `iame_recommend` | `iame_scrutiny` → `bee_scrutiny` | `IameRecommendationService` |
| `bee_scrutiny` | `reviewer_forward` | `bee_scrutiny` → `rating` | `ReviewerForwardService` |
| `rating` | `compute_rating` | `rating` → `director_review` | `RatingService` |
| `director_review` | `director_recommend` | `director_review` → `secretary_approval` or `approved` | `DirectorRecommendationService` |
| `secretary_approval` | `secretary_approve` | `secretary_approval` → `approved` | `SecretaryApprovalService` |

Forward closure enforces the table map above (refuses `return`, `reject`, and every other action/destination), validates the persisted `model_application_transition_event` (id, action, from/to, version, actor) against the open cycle and current application state/version, requires the event `occurred_at` to be after the latest applicant clock `resume`, requires exactly one latest undisposed applicant response, then atomically: `accepted` disposition, clock `stop` at stored event time, task `completed` + task event, cycle close, wiring evidence (`forward_closure`). No caller-supplied forward timestamp parameter.

No open cycle → orchestrate forward closure is a **no-op** (no evidence row).

## Trusted command boundary

| Function | Runtime EXECUTE | Purpose |
| --- | --- | --- |
| `model_return_response_orchestrate_wired_return` | yes | V71 bundle; V72 selects **open** cycle or creates cycle `cycle_seq+1` when none open |
| `model_return_response_orchestrate_resubmit` | yes | V71 bundle; open cycle only |
| `model_return_response_orchestrate_forward_closure` | yes | Accepted-forward closure bundle (V72) |
| `notification_foundation_deliver` (V70) | yes | Applicant return notify inside wired return |
| Internal helpers (`bind_cycle_return`, `insert_return`, `link_cycle`, `append_response`, …) | no | Revoked from PUBLIC and `bee_runtime`; `bind_cycle_return` requires an **open** cycle; `search_path` pinned |

**Runtime table access:** unchanged — SELECT only on cycle/evidence; no runtime INSERT on `model_application_return`.

## Replay keys

`commandId = UUID.nameUUIDFromBytes((idempotencyKey + "|" + purpose + "|" + applicationId).getBytes(UTF_8))`.

Purposes include `model_forward_closure` for accepted-forward wiring.

## Test seam

`WorkflowReturnResponseWiring.testMidWiringFailureHook` (test-only) and test-schema triggers for post-disposition rollback proofs.

## Proof map (Brief 19B-2 / 19B-2A / 19B-2B)

| Section | Named tests |
| --- | --- |
| 1 Privilege / cycle binding | `runtimeCannotExecuteCycleReturnBindingHelper`, `closedCycleCannotReceiveReturnBindingThroughInternalHelper`, `runtimeExecuteListContainsOnlyDocumentedHighLevelCommands`; `v71ReturnsBackfillIntoMigratedCycle` (Flyway target 71 → 72 isolated schema); `eachNewAndRepeatReturnIsBoundToExactlyOneCycle`, `oldCycleReturnCannotResubmitOrNotifyCurrentCycle` (persisted resubmission id), `currentCycleLatestReturnResubmitsNormally`, plus cycle normalization tests in `SnlWp02bModelForwardClosureDatabaseTest` |
| 2 Forward closure command | `stalePreResubmitForwardEventCannotCloseCurrentCycle`, `rejectionOrReturnTransitionCannotCloseCycleAsAccepted` (return event + persisted `StageRejectRepository` rejection), `forgedForwardTimestampCannotChangeAuditOrClockTime`, `allAllowedForwardMappingsStillCloseNormally`, `forwardClosureAcceptsLatestResponseStopsClockAndCompletesTask`, `forwardClosureWithoutOpenCycleIsNoOp`, `forwardClosureReplayIsStableAndChangedPayloadConflicts`, `runtimeHighLevelClosureRejectsStaleRejectionAndWrongCycleInputs` (full survivor set), `duplicateCycleSeqTaskOrDiscrepancyRefused` (SQLSTATE `23505` + constraint names), `incompleteOpenOrClosedCycleLifecycleRefused` |
| 3 Service wiring | Per-stage `*AcceptedForwardClosesReturnCycle`; `SnlWp02bModelForwardServiceDatabaseTest`: post-legacy `forward_closure` wiring-evidence conflict (not route idempotency replay), full legacy rollback bundle, route idempotency row rolled back; `serviceInjectedClosureFailureRollsBackCompleteBundle`; `concurrentChangedForwardPayloadHasOneWinnerAndOneConflict` (single closure bundle, no idempotency residue) |
| 4 Multi-cycle journeys | IAME→BEE two-cycle, director/rating/secretary path, re-return before forward |

Prior 19B proof map (items 1–14) remains in git history for V71 acceptance; regression covered by existing `SnlWp02bModelReturnWiringDatabaseTest` on V72 schema.

## Deferrals

- **19C–19D:** registration wiring and consolidated read/concurrency plan evidence.
