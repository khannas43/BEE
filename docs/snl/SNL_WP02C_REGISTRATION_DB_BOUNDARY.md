# SNL WP02C — registration return/resubmit trusted database boundary (Brief 19C-A / 19C-A1 / 19C-A2)

**Branch:** `cursor/snl-wp02c-registration-db-boundary`
**Migration:** V73 (`V73__snl_wp02c_registration_return_wiring.sql`) — corrected in place through Brief 19C-A2
**Design:** [SNL_WP02C_REGISTRATION_RETURN_DESIGN.md](SNL_WP02C_REGISTRATION_RETURN_DESIGN.md)
**Status:** Brief 19C-A2 implemented / **review pending**. No HTTP, OpenAPI, BFF or UI wiring. 19C is not accepted.

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

All other `registration_return_response_*` helpers are `SECURITY DEFINER` with pinned `search_path`; `REVOKE EXECUTE` from `PUBLIC` and `bee_runtime`. **`bee_app`** owns migration objects; Spring connects as **`bee_runtime`**.

**Maintenance EXECUTE (not registration closure):** `app_disposable_registration_cleanup` only. There is **no** production cycle-closure command; forward closure remains 19C-C.

## Canonical wiring payload (19C-A2)

Caller-supplied `p_wiring_payload_hash` remains on both orchestrators for Java compatibility. The database **always** recomputes the canonical hash and:

- on **fresh** execution: rejects when `p_wiring_payload_hash` ≠ computed hash; persists **computed** hash in `registration_return_response_wiring_evidence`;
- on **replay**: compares computed hash to stored evidence **before** returning the persisted outcome; requires matching `return_id` / `resubmission_id` and transition identity, not merely “some row for this transition id”.

### Return hash (`registration_return_response_wiring_return_hash`)

SHA-256 over UTF-8:

`registration_return_wiring|{application_id}|{transition_event_id}|{return_id}|{from_stage}|{reason}|{returned_by}|{returned_at}|{actor_role}|{notify_command_id}|{task_command_id}|{task_owner_role}|{task_owner_account}|{due_at}|{policy_version_id}|{actor_account}`

(`timestamptz` values use PostgreSQL `timestamptz` text form.)

### Resubmit hash (`registration_return_response_wiring_resubmit_hash`)

SHA-256 over UTF-8:

`registration_resubmit_wiring|{application_id}|{return_id}|{resubmission_id}|{transition_event_id}|{returned_from_stage}|{returned_at}|{return_reason}|{resumed_stage}|{coalesce(response_body,'')}|{resubmitted_at}|{responded_by}|{responded_role}|{notify_command_id}|{task_command_id}|{task_owner_role}|{task_owner_account}|{due_at}|{policy_version_id}|{actor_account}`

Notify/task payload hashes remain separate V70/foundation checks; wiring evidence stores only the wiring canonical hashes above (plus notify evidence rows for officer/applicant notify commands).

## Trusted derivation (19C-A1 + A2)

Orchestrators acquire the wiring advisory lock and read wiring evidence **before** requiring the live application to remain in `returned` / `programme_review` on replay.

| Input | Rule |
| --- | --- |
| Transition | Must match persisted `registration_transition_event` (action, from/to, note, actor, role, `occurred_at`) |
| Application state | `returned` (return) or `programme_review` (resubmit) on first completion only |
| Stage ↔ role | `programme_review` → `programme`; `director_approval` → `director` |
| **Role validity time (A2)** | Return: `role_assignment` must cover **`returned_at`** (transition time). Resubmit officer notify: must cover **`resubmitted_at`**. |
| Audit actor | Must equal persisted transition actor |
| Task owner | Must equal returning officer account and stage role from the return row |
| Policy / due | Applicable `snl_return_response` version and `workflow_sla_due_at_end_of_working_days` |
| Return notify | Canonical suffix + hash (**A18**: no officer in applicant copy) |
| Resubmit return facts | Caller return stage/time/reason must match persisted return on open cycle |
| Wiring replay | Computed wiring hash must match evidence; persisted return/resubmission id must match |

## Transaction and privilege boundary

- Advisory lock on wiring `command_id`; wiring hash mismatch → `registration_return_response_wiring_idempotency_conflict` (Java: `WorkflowIdempotencyConflictException`).
- Notifications only through V70 deliver (return) and `registration_return_response_officer_resubmit_notify` (resubmit officer).
- Runtime: no direct INSERT/UPDATE/DELETE on return/resubmission/cycle/evidence tables; SELECT on cycle/evidence/link tables.

## Recipient resolution

| Event | Recipients | Rule |
| --- | --- | --- |
| Return | All **active** accounts in filing organisation | `organisation_membership.active` + `user_account.status = 'active'`; exact policy-derived respond-by in message |
| Resubmit | Returning officer | From return row; active account with stage role at **`resubmitted_at`** |

## Java boundary

`RegistrationReturnResponseWiringRepository` — internal; calls only the two orchestrators; maps idempotency SQL message to `WorkflowIdempotencyConflictException`. Not wired into `RegistrationReviewService` (19C-B).

## Proof map (`SnlWp02cRegistrationReturnWiringDatabaseTest`, 29 tests)

| # | Test | Section |
| --- | --- | --- |
| 1 | `firstProgrammeReturnCreatesCompleteAtomicBundle` | Atomic first return |
| 2 | `directorReturnUsesPersistedTransitionAndReturningDirectorRule` | Director officer notify |
| 3 | `returnNotificationUsesExactEligibleRecipientSetWithoutOfficerIdentity` | Recipient set + reason/due copy |
| 4 | `returnPersistsAndNotifiesExactCalendarDueDate` | Policy + calendar due |
| 5 | `identicalReturnReplayIsStableAndChangedPayloadConflicts` | Return idempotency |
| 6 | `returnReplayWithOldHashAndChangedMaterialInputConflicts` | **A2** old-hash tamper |
| 7 | `returnActorRoleValidityUsesPersistedTransitionTime` | **A2** role window at return time |
| 8 | `wrongActorRoleAndInactiveOfficerRollBackCompleteBundle` | **A2** actor/role rollback |
| 9 | `concurrentReturnHasOneCompleteSurvivorAndAssertedLoser` | **A2** concurrency |
| 10 | `returnFailureLeavesNoLegacyOrWorkflowResidue` | **A2** full-bundle rollback |
| 11 | `resubmitRequiresLatestReturnBoundToOpenCycle` | Return/cycle binding |
| 12 | `resubmitAppendsResponseResumesClockAndNotifiesResolvedOfficer` | Resubmit bundle |
| 13 | `identicalResubmitReplayIsStableAndChangedPayloadConflicts` | Resubmit idempotency |
| 14 | `resubmitReplayWithOldHashAndChangedMaterialInputConflicts` | **A2** resubmit tamper |
| 15 | `concurrentResubmitHasOneCompleteSurvivorAndAssertedLoser` | **A2** resubmit concurrency |
| 16 | `reReturnUsesSameCycleNeedsMoreAndPausesClockAgain` | Same-cycle re-return |
| 17 | `returnAfterClosedCycleStartsNextCycle` | Next cycle (test fixture close) |
| 18 | `runtimeCannotInsertUpdateOrDeleteAnyRegistrationWorkflowHistory` | Runtime tamper |
| 19 | `runtimeAppAndPublicExecuteOnlyDocumentedRegistrationCommands` | PUBLIC + runtime execute audit |
| 20 | `internalHelperCannotBindReturnToClosedOrDifferentApplicationCycle` | Bind guard |
| 21 | `subjectDeleteBlockedWhileRegistrationWorkflowHistoryExists` | Delete guard |
| 22 | `disposableRegistrationCleanupRemovesNewRowsInDependencyOrder` | Maint cleanup |
| 23 | `productionMaintClosureFunctionIsAbsentFromMigratedSchema` | No production closure bypass |
| 24 | `wrongDueTimeIsRejectedWithNoPartialBundle` | Trusted due derivation |
| 25 | `wrongTaskOwnerIsRejectedAtomically` | Trusted task owner |
| 26 | `identicalReturnReplayAfterResubmitIsStable` | Lifecycle-stable return replay |
| 27 | `identicalResubmitReplayAfterReReturnIsStable` | Lifecycle-stable resubmit replay |
| 28 | `returnFromApplicationACannotBindToApplicationBCycle` | Cross-application bind guard |
| 29 | `runtimeCannotExecuteInternalRegistrationHelpers` | Internal helper EXECUTE revoked |

Bundle helpers (`WorkflowBundleCounts`, `assertNoReturnWorkflowResidue`) assert counts across returns, resubmissions, cycles, tasks/events, clocks/events, discrepancies, dispositions, responses, notifications and wiring evidence.

## Deferrals (19C-B / 19C-C)

- **19C-B:** `RegistrationReturnResponseWiring`, hook `RegistrationReviewService.transition`, HTTP idempotency alignment.
- **19C-C:** Forward closure on recommend/approve, lazy programme task on fee confirm, read repository for 19D.
