# SNL WP02C-A — registration return/resubmit trusted database boundary (Brief 19C-A)

**Branch:** `cursor/snl-wp02c-registration-db-boundary`
**Migration:** V73 (`V73__snl_wp02c_registration_return_wiring.sql`)
**Design:** [SNL_WP02C_REGISTRATION_RETURN_DESIGN.md](SNL_WP02C_REGISTRATION_RETURN_DESIGN.md)
**Status:** Implemented — review pending (19C-A). No HTTP, OpenAPI, BFF or UI wiring.

## Schema

| Table | Role |
| --- | --- |
| `registration_application_return` | Durable return linked to one `registration_transition_event` (`return` → `returned`) |
| `registration_application_resubmission` | Resubmit linked to return + `resubmit` transition → `programme_review` |
| `registration_return_response_cycle` | Cycle identity (`cycle_seq`, open/closed), task, discrepancy, closure fields |
| `registration_return_response_cycle_return` | Append-only `(cycle_id, return_id)`; each return binds to one cycle |
| `registration_return_response_wiring_evidence` | Replay-safe command evidence (`registration_return_wiring`, `registration_resubmit_wiring`, notify purposes) |

Return stages: `programme_review` or `director_approval` only. Resubmit resumed stage: `programme_review` (provisional A03).

## Runtime EXECUTE (only orchestrators)

| Function | Purpose |
| --- | --- |
| `registration_return_response_orchestrate_wired_return` | Atomic return bundle: validate transition, notify applicants (V70), insert return, open/re-use cycle, task/clock/discrepancy, pause clock, evidence |
| `registration_return_response_orchestrate_resubmit` | Atomic resubmit bundle: validate transition, bind latest return on open cycle, append response, resume clock, officer notify, evidence |

All other `registration_return_response_*` helpers are `SECURITY DEFINER` with `search_path` pinned; `REVOKE EXECUTE` from `PUBLIC` and `bee_runtime`.

**Maint-only (tests):** `registration_return_response_maint_close_cycle` — closes an open cycle and completes task/clock/discrepancy enough for “next cycle” proofs without a production forward path (19C-C).

## Transaction and privilege boundary

- Orchestrators verify the **persisted** `registration_transition_event` (action, from/to, note, actor, `occurred_at`) — caller-supplied stage/time/reason are not trusted alone.
- Advisory lock on wiring `command_id` before idempotency read; payload hash mismatch → `registration_return_response_wiring_idempotency_conflict` (Java: `WorkflowIdempotencyConflictException`).
- Notifications only through V70 `notification_foundation_deliver` (return) and `registration_return_response_officer_resubmit_notify` (resubmit officer — no arbitrary recipient).
- Runtime: no direct INSERT on return/resubmission tables; SELECT on cycle/evidence/link tables; no UPDATE on workflow history tables.
- `app_disposable_registration_cleanup` extended for maint-only teardown of V73 rows (dependency order includes fee confirmation before transition events).

## Recipient resolution

| Event | Recipients | Rule |
| --- | --- | --- |
| Return | All active accounts in filing organisation | From `registration_application.organisation_id`; V70 org fan-out; message includes reference, reason, policy-derived respond-by (**A18**: no officer identity) |
| Resubmit | Returning officer | From `registration_application_return.returned_by_account_id`; Director return still notifies Director while state resumes to `programme_review` (19C-0 provisional rule — owner confirmation) |

SLA: `snl_return_response` policy via `SnlReturnResponsePolicyRepository` / working-day calendar — **not** hard-coded 7/12/15 in Java or SQL (A08 / BL-255).

## Task / clock / discrepancy lifecycle

- First return: create task (`registration_application`, `review`), discrepancy (`return_response`), start + pause clock at return anchor.
- Resubmit: append one response, resume same clock.
- Re-return (open cycle): dispose latest undisposed response as `needs_more`, bind new return, pause same clock.
- **Not in 19C-A:** recommend/approve forward closure (19C-C); maint test helper simulates closed cycle only.

## Java boundary

`RegistrationReturnResponseWiringRepository` — internal; calls only the two orchestrators; maps idempotency SQL message to `WorkflowIdempotencyConflictException`. Not wired into `RegistrationReviewService` (19C-B).

## Proof map (`SnlWp02cRegistrationReturnWiringDatabaseTest`)

| # | Test | Section |
| --- | --- | --- |
| 1 | `firstProgrammeReturnCreatesCompleteAtomicBundle` | Atomic first return |
| 2 | `directorReturnUsesPersistedTransitionAndReturningDirectorRule` | Director officer notify |
| 3 | `returnNotificationFansOutOnlyToActiveFilingOrganisationAccounts` | Return recipients |
| 4 | `returnPersistsAndNotifiesExactCalendarDueDate` | Policy + calendar due in task/notify |
| 5 | `identicalReturnReplayIsStableAndChangedPayloadConflicts` | Return idempotency |
| 6 | `concurrentReturnCreatesOneCompleteOutcome` | Return concurrency |
| 7 | `returnFailureRollsBackNotificationTaskClockDiscrepancyCycleAndEvidence` | Rollback (test trigger) |
| 8 | `resubmitRequiresLatestReturnBoundToOpenCycle` | Return/cycle binding |
| 9 | `resubmitAppendsResponseResumesClockAndNotifiesResolvedOfficer` | Resubmit bundle |
| 10 | `identicalResubmitReplayIsStableAndChangedPayloadConflicts` | Resubmit idempotency |
| 11 | `concurrentResubmitCreatesOneCompleteOutcome` | Resubmit concurrency |
| 12 | `reReturnUsesSameCycleNeedsMoreAndPausesClockAgain` | Same-cycle re-return |
| 13 | `returnAfterClosedCycleStartsNextCycle` | Next cycle after maint close |
| 14 | `runtimeCannotInsertRewriteOrDeleteRegistrationWorkflowHistory` | Runtime tamper |
| 15 | `runtimeExecuteListContainsOnlyRegistrationHighLevelCommands` | Privilege audit |
| 16 | `internalHelperCannotBindReturnToClosedOrDifferentApplicationCycle` | Bind guard |
| 17 | `subjectDeleteBlockedWhileRegistrationWorkflowHistoryExists` | Delete guard |
| 18 | `disposableRegistrationCleanupRemovesNewRowsInDependencyOrder` | Maint cleanup |

## Manual / assumption references (still open)

- §3, §3.4, §3.10, Table 2 (pp. 22–29), Annexure 1 (pp. 50–53) — traced in 19C-0 design.
- **A02** Programme as registration scrutiniser; **A03** resubmit → `programme_review`; **A08** / **BL-255** 7/12/15-day policy conflict; **A17** pause while applicant; **A18** no officer in applicant copy; **A20** permittee number deferred.

## Deferrals (19C-B / 19C-C)

- **19C-B:** `RegistrationReturnResponseWiring`, hook `RegistrationReviewService.transition`, HTTP idempotency alignment.
- **19C-C:** Forward closure on recommend/approve, lazy programme task on fee confirm, read repository for 19D.
- No supervisor queue, 60-day job (BL-253), cancel/reject normalization (BL-256), demo seed changes beyond disposable cleanup.
