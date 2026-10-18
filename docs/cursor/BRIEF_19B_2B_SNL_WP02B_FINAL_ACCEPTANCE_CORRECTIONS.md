# Brief 19B-2B — SNL WP02B final acceptance corrections

## Status

Brief 19B-2 remains **not accepted**. Continue on `cursor/snl-wp02b-model-forward-closure` from `f10a1ce`. Correct V72 and its tests in place; do not add V73 and do not edit V69–V71.

The 2A implementation closes the main design gaps, but review found one live privilege bypass and several false-positive tests that do not exercise the branches named in their method names. Resolve every item below.

## 1. Remove the public cycle-binding bypass

`model_return_response_bind_cycle_return(uuid, uuid)` is `SECURITY DEFINER`. PostgreSQL grants function EXECUTE to `PUBLIC` by default, and V72 never revokes it. Runtime can therefore call this internal helper directly despite having no table INSERT grant.

Required:

- `REVOKE ALL ON FUNCTION model_return_response_bind_cycle_return(uuid, uuid) FROM PUBLIC`;
- do not grant it to `bee_runtime` or `bee_app`;
- require the target cycle to be `status = 'open'` inside the helper;
- keep it callable only from the owner-executed trusted orchestrators;
- audit every other V72 security-definer helper and prove no internal helper gained PUBLIC/runtime EXECUTE accidentally.

Required tests:

- `runtimeCannotExecuteCycleReturnBindingHelper` — check `has_function_privilege` and attempt the call as runtime;
- `closedCycleCannotReceiveReturnBindingThroughInternalHelper`;
- `runtimeExecuteListContainsOnlyDocumentedHighLevelCommands`.

## 2. Test a real closure conflict after the legacy write

The current `serviceForwardClosureConflictReturns409AndRollsBackAssignment` and `serviceFinalApprovalClosureConflictReturns409AndRollsBackCertificate` pre-complete the **HTTP** idempotency record. `replayOrRequireKey` therefore returns `idempotency_key_conflict` before `repository.recommend/approve` or the V72 closure command runs. These are false-positive rollback tests.

Required:

- do not pre-create the route-level idempotency record;
- pre-seed conflicting `model_return_response_wiring_evidence` for the deterministic `model_forward_closure` command id, or use an equivalent conflict that occurs inside V72 after the legacy transition;
- call the real Spring-proxied service;
- prove the legacy transition was attempted and then rolled back;
- assert the documented HTTP 409 `idempotency_key_conflict` response;
- assert assignment changes roll back for an officer-forward path;
- assert approval, certificate and related transition side effects roll back for final approval;
- assert no disposition, stop event, completed task, closed cycle or closure evidence survives;
- assert the route-level in-progress idempotency row is removed by transaction rollback, without issuing cleanup SQL in an aborted transaction.

The five service `WorkflowIdempotencyConflictException` catch blocks must set rollback-only and return the 409 **without calling `idempotency.abandon`**. The in-progress row was created in the same transaction and will roll back. Do not perform any JDBC operation after the trusted SQL conflict.

Keep these exact test names, but make them exercise the real post-legacy conflict:

- `serviceForwardClosureConflictReturns409AndRollsBackAssignment`;
- `serviceFinalApprovalClosureConflictReturns409AndRollsBackCertificate`.

## 3. Replace false-positive migration and integrity proofs

Several tests currently fail for a different reason than their name claims:

- `v71ReturnsBackfillIntoMigratedCycle` creates returns only after V72 is already installed; it does not test V71→V72 migration.
- `oldCycleReturnCannotResubmitOrNotifyCurrentCycle` supplies a fabricated resubmission id, so it can fail before proving cross-cycle refusal.
- `rejectionOrReturnTransitionCannotCloseCycleAsAccepted` covers only a return event, not a real rejection event.
- `duplicateCycleSeqTaskOrDiscrepancyRefused` inserts incomplete closed rows, so the lifecycle check can mask every uniqueness assertion.

Required corrections:

- migrate an isolated schema through V71, seed a real V71 cycle with its returns, then apply V72 and prove all rows are linked without history loss;
- use an actual persisted old-cycle return **and its actual persisted resubmission** against a newer open cycle;
- create and submit a genuine persisted rejection transition using its real action/from/to/actor values and prove the forward allowlist refuses it;
- test cycle-sequence, task and discrepancy uniqueness with otherwise valid rows, and assert the intended constraint/SQL state rather than any generic exception;
- separately prove incomplete open/closed lifecycle rows are refused.

## 4. Strengthen concurrency/runtime survivor assertions

For the changed-payload and high-level-runtime misuse tests, assert the complete survivor set:

- one winning legacy transition;
- one disposition and one stop event;
- one completed task and one closed cycle;
- one closure evidence row;
- no extra/open task, clock, discrepancy, cycle, disposition, event or evidence rows;
- the losing command leaves no route-level idempotency residue.

## Documentation and status

- Update the proof map so each named test describes what it actually exercises.
- Document the exact final V72 runtime EXECUTE list, explicitly excluding the binding helper.
- Keep 19B-2 at review pending and WP2 at 60% until ChatGPT acceptance.
- Keep BL-257 open; no new backlog row.

## Boundaries

- No registration, read API, BFF, UI, supervisor queue, scheduler or generic rejection workflow implementation.
- No OpenAPI/external response-shape, demo seed, Word or PDF edits.
- Leave `docs/BEE_SNL_DEVELOPMENT_PLAN.docx` untouched.
- Do not push or open a PR.

## Required gates

- All focused 19B-2/2A/2B database and service tests.
- `cd backend && mvn test`.
- `cd backend && mvn test -Dgroups=db -Dbee.test.excludedGroups=none`.
- `npx tsc --noEmit`.
- `npm run web:test`.
- `npm run build`.
- `git diff --check f732482..HEAD` after commit.
- `npm run local:down`.
- Clean tracked tree; owner-controlled Word file untouched.

## Handback

Run `/bee-handback`. Resolve sections 1–4 separately. Report the exact runtime EXECUTE list, the corrected real post-legacy 409 setup and rollback assertions, the staged V71→V72 migration proof, corrected constraint/cross-cycle/rejection proofs, full gate counts and commit hash. Release the baton to `claude`.
