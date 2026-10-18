# Brief 19B-2A — SNL WP02B forward-closure trusted-boundary corrections

## Status

Brief 19B-2 is **not accepted**. Continue on `cursor/snl-wp02b-model-forward-closure` from `ccd2b6a`. Correct V72 in place; do not add V73 and do not edit V69–V71.

The user-facing behaviour and full reported gates are good, but review found database-boundary gaps that permit a callable runtime command to close the wrong cycle or treat a non-forward transition as accepted. Close every item below and add the named proofs before handback.

## 1. Bind every return and resubmission to one cycle

V72 gives cycles identities but does not link a `model_application_return` to a particular cycle. The current resubmit/notification checks only prove that the return belongs to the application while *some* cycle is open. After multiple cycles, a stale resubmission from a closed cycle can therefore be presented to the current open cycle.

Required:

- add an append-only cycle/return link (a join table or equally strong schema design);
- backfill every V71 return into its migrated cycle without changing legacy audit rows;
- bind the first return and every re-return to the open cycle inside the trusted wired-return command;
- require resubmit, response, resumed-stage update and officer notification to use the **latest return bound to that same open cycle**;
- refuse an old return/resubmission from a closed cycle, even when application, stage and actor otherwise match;
- make the link immutable and unavailable to runtime DML;
- keep existing command replay compatible.

Required tests:

- `v71ReturnsBackfillIntoMigratedCycle`;
- `eachNewAndRepeatReturnIsBoundToExactlyOneCycle`;
- `oldCycleReturnCannotResubmitOrNotifyCurrentCycle`;
- `currentCycleLatestReturnResubmitsNormally`.

## 2. Make forward closure accept only a real new forward

`model_return_response_orchestrate_forward_closure` currently verifies that the event matches caller-supplied action/state/actor values, but it does not enforce the approved transition map. It also trusts caller-supplied `p_forward_occurred_at` instead of the persisted event time and does not prove that the event happened after the current applicant response/resume. A stale earlier event or a rejection event can therefore be supplied as an accepted forward.

Required:

- enforce the exact five-stage action/from/to/role map in V72, including both allowed Director destinations;
- explicitly refuse `return`, `reject` and every other action/destination;
- derive closure time and clock-stop time from `model_application_transition_event.occurred_at`; remove the time parameter or require exact equality and still use the stored value;
- require the transition to be newer than the current cycle's latest response/resubmission and clock resume;
- require current application state/version to agree with the transition outcome when the command runs;
- keep the one-call atomic disposition, stop, task completion, cycle closure and evidence bundle.

Required tests:

- `stalePreResubmitForwardEventCannotCloseCurrentCycle`;
- `rejectionOrReturnTransitionCannotCloseCycleAsAccepted`;
- `forgedForwardTimestampCannotChangeAuditOrClockTime`;
- `allAllowedForwardMappingsStillCloseNormally`.

## 3. Restore structural cycle integrity

V72 drops the old one-application uniqueness but adds only a non-unique `(application_id, cycle_seq)` index. It also relies on a trigger rather than schema checks for lifecycle completeness.

Required:

- `UNIQUE (application_id, cycle_seq)`;
- one cycle per task and one cycle per discrepancy (`UNIQUE` constraints);
- an unambiguous occurrence/cycle identity after removing the global discrepancy uniqueness constraint;
- a declarative lifecycle check: open cycles have no closure fields; closed cycles have all required closure fields;
- preserve the partial unique index allowing at most one open cycle per application;
- prove duplicate sequence/task/discrepancy and incomplete closure rows are refused.

## 4. Prove the real mapped service rollback

`forwardClosureConflictRollsBackLegacyTransition` currently throws a test-hook `IllegalStateException`; it does not exercise a real closure idempotency conflict or prove the documented mapped 409. The service catch blocks also attempt database cleanup before consistently marking rollback-only, which is unsafe after a PostgreSQL statement error.

Required:

- force a real changed-payload/evidence conflict through a Spring-proxied stage service;
- return the documented HTTP 409, rather than leaking a database/transaction-aborted exception;
- mark rollback-only before any optional cleanup; do not issue `idempotency.abandon` in an already-aborted transaction;
- prove rollback of the legacy transition plus assignment changes for an officer-forward path;
- prove rollback of certificate/approval side effects for a final-approval path;
- retain the injected after-disposition rollback proof, and add a service-level proof if the present repository-only test cannot cover the caught branch.

Required tests:

- `serviceForwardClosureConflictReturns409AndRollsBackAssignment`;
- `serviceFinalApprovalClosureConflictReturns409AndRollsBackCertificate`;
- `serviceInjectedClosureFailureRollsBackCompleteBundle`.

## 5. Close missing concurrency and runtime-misuse proofs

The current concurrent test covers identical input only. The runtime tamper test covers direct table DML but not misuse of the granted high-level command.

Add:

- `concurrentChangedForwardPayloadHasOneWinnerAndOneConflict`;
- `runtimeHighLevelClosureRejectsStaleRejectionAndWrongCycleInputs`;
- assertions that no duplicate or orphan cycle, task, clock, discrepancy, disposition, event or evidence rows survive any losing command.

## 6. Documentation and status

- Update the V72 lifecycle and trusted-boundary description in both SNL WP02B design notes.
- Map every 19B-2 and 19B-2A requirement to a named passing test.
- Keep 19B-2 as **review pending** and WP2 at **60%** until ChatGPT acceptance.
- Keep BL-257 open; add no new backlog row for these review corrections.

## Boundaries

- No registration wiring, common read API, BFF, UI, supervisor queue, scheduler or generic reject workflow.
- No OpenAPI/external response-shape, demo seed, Word or PDF changes.
- Leave `docs/BEE_SNL_DEVELOPMENT_PLAN.docx` untouched.
- Do not push or open a PR.

## Required gates

- All named focused proofs above plus the full 19B-2 test class.
- `cd backend && mvn test`.
- `cd backend && mvn test -Dgroups=db -Dbee.test.excludedGroups=none`.
- `npx tsc --noEmit`.
- `npm run web:test`.
- `npm run build`.
- `git diff --check main..HEAD` after commit.
- `npm run local:down`.
- Clean tracked tree; owner-controlled Word file untouched.

## Handback

Run `/bee-handback`. Resolve findings 1–5 separately; report the final runtime EXECUTE list, cycle/return binding, enforced transition map and stored-time rule, real service 409 rollback proofs, concurrency/runtime-misuse proofs, full gate counts and commit hash. Release the baton to `claude`.
