# SNL WP02C — registration return/resubmit trusted database boundary (Brief 19C-A / 19C-A1 / 19C-A2 / 19C-A3)

**Branch:** `cursor/snl-wp02c-registration-db-boundary`
**Migration:** V73 (`V73__snl_wp02c_registration_return_wiring.sql`) — corrected in place through Brief 19C-A3
**Design:** [SNL_WP02C_REGISTRATION_RETURN_DESIGN.md](SNL_WP02C_REGISTRATION_RETURN_DESIGN.md)
**Status:** Brief 19C-A3 implemented / **review pending**. No HTTP, OpenAPI, BFF or UI wiring. **V73 and 19C are not accepted.**

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
| `registration_return_response_orchestrate_wired_return` | Atomic return bundle |
| `registration_return_response_orchestrate_resubmit` | Atomic resubmit bundle |

All other `registration_return_response_*` helpers are `SECURITY DEFINER` with pinned `search_path`; `REVOKE EXECUTE` from `PUBLIC` and `bee_runtime`. **`bee_app`** owns migration-created functions (Flyway session); Spring connects as **`bee_runtime`**.

**Privilege audit honesty (19C-A3):** Tests prove **`bee_runtime`** may execute only the two orchestrators and **`PUBLIC`** has no execute on security-definer registration helpers. Helpers are owned by **`bee_app`** because Flyway applies V73 as `bee_app`; reassigning owners to a locked maint role inside the same migration requires `SET ROLE` the Flyway user does not hold. **`bee_app` is not exercised as a JDBC caller** in these proofs — only catalog ownership is recorded. Runtime tamper proofs use **`bee_runtime`**.

**Maintenance EXECUTE (not registration closure):** `app_disposable_registration_cleanup` only. There is **no** production cycle-closure command; forward closure remains 19C-C.

## Canonical wiring payload (19C-A3)

Caller-supplied `p_wiring_payload_hash` remains on both orchestrators for Java compatibility. The database **always** recomputes the canonical hash and:

- on **fresh** execution: rejects when `p_wiring_payload_hash` ≠ computed hash; persists **computed** hash in `registration_return_response_wiring_evidence`;
- on **replay**: compares computed hash to stored evidence **before** returning success; any material orchestrator input change (including notify suffix and task payload hash) → `registration_return_response_wiring_idempotency_conflict`; requires matching `return_id` / `resubmission_id` and transition identity.

Timestamps in the hash use **`registration_return_response_wiring_instant_ms(timestamptz)`** (UTC epoch milliseconds), not timezone-dependent text.

### Return hash (`registration_return_response_wiring_return_hash`)

SHA-256 over UTF-8:

`registration_return_wiring|{application_id}|{transition_event_id}|{return_id}|{from_stage}|{reason}|{returned_by}|{returned_at_ms}|{actor_role}|{notify_command_id}|{notify_payload_hash}|{notify_message_suffix}|{task_command_id}|{task_payload_hash}|{task_owner_role}|{task_owner_account}|{due_at_ms}|{policy_version_id}|{actor_account}`

### Resubmit hash (`registration_return_response_wiring_resubmit_hash`)

SHA-256 over UTF-8:

`registration_resubmit_wiring|{application_id}|{return_id}|{resubmission_id}|{transition_event_id}|{returned_from_stage}|{returned_at_ms}|{return_reason}|{resumed_stage}|{coalesce(response_body,'')}|{resubmitted_at_ms}|{responded_by}|{responded_role}|{notify_command_id}|{task_command_id}|{task_payload_hash}|{task_owner_role}|{task_owner_account}|{due_at_ms}|{policy_version_id}|{actor_account}`

Notify/task payload hashes remain separate V70/foundation checks; wiring evidence stores the wiring canonical hashes above.

## Trusted derivation (19C-A1 + A2 + A3)

Orchestrators acquire the wiring advisory lock and read wiring evidence **before** requiring the live application to remain in `returned` / `programme_review` on replay.

| Input | Rule |
| --- | --- |
| Stage ↔ role | **`assert_stage_actor` before transition match** so wrong-role rollbacks surface `registration_return_response_stage_role_mismatch` |
| Transition | Must match persisted `registration_transition_event` (action, from/to, note, actor, role, `occurred_at`) |
| Application state | `returned` (return) or `programme_review` (resubmit) on first completion only |
| **Role validity time** | Return officer: `role_assignment` covers **`returned_at`**. Resubmit officer notify: covers **`resubmitted_at`**. |
| Audit actor | Must equal persisted transition actor (`registration_return_response_actor_mismatch`) |
| Task owner | Must equal returning officer account and stage role from the return row |
| Policy / due | Applicable `snl_return_response` version and `workflow_sla_due_at_end_of_working_days` |
| Return notify | Canonical suffix + hash (**A18**: no officer in applicant copy) |
| Resubmit return facts | Caller return stage/time/reason must match persisted return on open cycle |
| Wiring replay | Computed wiring hash must match evidence; persisted return/resubmission id must match |

## Transaction and privilege boundary

- Advisory lock on wiring `command_id`; wiring hash mismatch → `registration_return_response_wiring_idempotency_conflict` (Java: `WorkflowIdempotencyConflictException`).
- Notifications only through V70 deliver (return) and `registration_return_response_officer_resubmit_notify` (resubmit officer).
- Runtime: no direct INSERT/UPDATE/DELETE on return/resubmission/cycle/cycle-return binding/wiring evidence tables; SELECT on cycle/evidence/link tables.

## Recipient resolution

| Event | Recipients | Rule |
| --- | --- | --- |
| Return | All **active** accounts in filing organisation | `organisation_membership.active` + `user_account.status = 'active'`; exact policy-derived respond-by in message |
| Resubmit | Returning officer | From return row; active account with stage role at **`resubmitted_at`** |

## Java boundary

`RegistrationReturnResponseWiringRepository` — internal; calls only the two orchestrators; maps idempotency SQL message to `WorkflowIdempotencyConflictException`. Not wired into `RegistrationReviewService` (19C-B).

## Proof map (`SnlWp02cRegistrationReturnWiringDatabaseTest`, 33 tests)

| # | Test | Section |
| --- | --- | --- |
| 1 | `firstProgrammeReturnCreatesCompleteAtomicBundle` | Atomic first return |
| 2 | `directorReturnUsesPersistedTransitionAndReturningDirectorRule` | Director officer notify |
| 3 | `returnNotificationUsesExactEligibleRecipientSetWithoutOfficerIdentity` | Recipient set + reason/due copy |
| 4 | `returnPersistsAndNotifiesExactCalendarDueDate` | Policy + calendar due |
| 5 | `identicalReturnReplayIsStableAndChangedPayloadConflicts` | Return idempotency |
| 6 | `returnReplayWithOldHashAndChangedMaterialInputConflicts` | Old-hash / material-input tamper |
| 7 | `concurrentReturnHasOneCompleteSurvivorAndAssertedLoser` | Concurrency (loser: `IllegalStateException`, `registration return transition stale`) |
| 8 | `returnFailureLeavesNoLegacyOrWorkflowResidue` | Injected failure → **complete** snapshot rollback |
| 9 | `resubmitRequiresLatestReturnBoundToOpenCycle` | Return/cycle binding |
| 10 | `resubmitAppendsResponseResumesClockAndNotifiesResolvedOfficer` | Resubmit bundle |
| 11 | `identicalResubmitReplayIsStableAndChangedPayloadConflicts` | Resubmit idempotency |
| 12 | `concurrentResubmitHasOneCompleteSurvivorAndAssertedLoser` | Resubmit concurrency (loser: `registration resubmit transition stale`) |
| 13 | `reReturnUsesSameCycleNeedsMoreAndPausesClockAgain` | Same-cycle re-return |
| 14 | `returnAfterClosedCycleStartsNextCycle` | Next cycle (test fixture close) |
| 15 | `runtimeCannotInsertUpdateOrDeleteAnyRegistrationWorkflowHistory` | Runtime INSERT/UPDATE/DELETE on all five history families |
| 16 | `registrationReturnResponseExecutePrivilegeInventory` | Runtime orchestrators only; PUBLIC empty; `bee_app` ownership note |
| 17 | `internalHelperCannotBindReturnToClosedOrDifferentApplicationCycle` | Bind guard |
| 18 | `subjectDeleteBlockedWhileRegistrationWorkflowHistoryExists` | Delete guard |
| 19 | `disposableRegistrationCleanupRemovesNewRowsInDependencyOrder` | Maint cleanup |
| 20 | `productionMaintClosureFunctionIsAbsentFromMigratedSchema` | No production closure bypass |
| 21 | `resubmitReplayWithOldHashAndChangedMaterialInputConflicts` | Resubmit tamper |
| 22 | `notYetValidRoleRollBackCompleteBundle` | Rollback: role not yet valid |
| 23 | `expiredRoleRollBackCompleteBundle` | Rollback: expired role |
| 24 | `wrongRoleRollBackCompleteBundle` | Rollback: wrong stage role |
| 25 | `wrongActorRollBackCompleteBundle` | Rollback: actor mismatch |
| 26 | `inactiveOfficerRollBackCompleteBundle` | Rollback: inactive officer |
| 27 | `resubmitOfficerRoleValidityUsesPersistedResubmitTransitionTime` | Officer role at **resubmit transition time** |
| 28 | `wrongDueTimeIsRejectedWithNoPartialBundle` | Trusted due derivation + complete snapshot |
| 29 | `wrongTaskOwnerIsRejectedAtomically` | Trusted task owner + complete snapshot |
| 30 | `identicalReturnReplayAfterResubmitIsStable` | Lifecycle-stable return replay |
| 31 | `identicalResubmitReplayAfterReReturnIsStable` | Lifecycle-stable resubmit replay |
| 32 | `returnFromApplicationACannotBindToApplicationBCycle` | Cross-application bind guard |
| 33 | `runtimeCannotExecuteInternalRegistrationHelpers` | Internal helper EXECUTE revoked |

**Complete bundle snapshot (`CompleteBundleSnapshot`):** application `state` + `version`, `registration_transition_event` count, all registration return/resubmit/cycle families, full workflow task/event/clock/discrepancy/disposition/response counts, `notification_command` + `notification` delivery counts, and wiring evidence count. Rollback and rejection proofs assert **equality** to baseline (no partial residue).

## Deferrals (19C-B / 19C-C)

- **19C-B:** `RegistrationReturnResponseWiring`, hook `RegistrationReviewService.transition`, HTTP idempotency alignment.
- **19C-C:** Forward closure on recommend/approve, lazy programme task on fee confirm, read repository for 19D.
