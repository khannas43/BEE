# Brief 19C-A2 — SNL WP02C payload integrity and proof closure

## Delivery target

- **Branch:** `cursor/snl-wp02c-registration-db-boundary`
- **Base:** `main @ d981bb6`
- **Review target:** Brief 19C-A1 at `b72fbb0`
- **Migration:** correct **V73 in place**. Do not add V74 or edit V69–V72.
- **Scope:** close the remaining payload-safe replay defect and the unfulfilled 19C-A1 proof requirements. No HTTP/service wiring.

The A1 changes removing the production maintenance closure function, independently checking the SLA due time, validating task ownership, and looking up replay evidence before current-state checks are retained. Brief 19C-A/A1 remains **unaccepted** until this brief passes review.

## 1. Canonical database-owned command payloads

The two orchestrators currently compare stored evidence only with caller-supplied `p_wiring_payload_hash`. A caller can change material arguments but reuse the old hash, causing the replay path to return success without validating those changed arguments. Fix this inside the database boundary.

For both return and resubmit:

- define one canonical payload from every material command input and all persisted facts that determine the outcome;
- calculate its hash inside V73, or remove the caller hash and persist the internally calculated value;
- if a hash remains in the public function signature for Java compatibility, independently calculate it and reject a mismatch on both fresh execution and replay;
- use the internally calculated hash for `registration_return_response_wiring_evidence`;
- on replay, compare the internally calculated current payload to stored evidence before returning the persisted outcome;
- validate that the persisted outcome belongs to that command and matches the stored transition/return/resubmission identity—not merely that some row exists for a caller-supplied transition id.

Material data includes, as applicable: application, persisted transition, persisted return, return/resubmission identity, return stage/reason/time/actor/role, response body, resumed stage, notification and task command identities, pinned policy/anchor/due time and resolved ownership/audit identity. Prefer removing redundant caller inputs where practical.

Required attack proofs must call the runtime orchestrator with the original command id and **original stored hash** while changing one material field. Each must conflict and leave the original outcome unchanged:

- return reason or transition identity;
- return owner/audit identity or due/policy metadata;
- resubmit response body;
- resubmit return id or resubmission/transition identity.

The lifecycle-stable identical replay after resubmit/re-return must continue to pass.

## 2. Deterministic actor and role validity

- Validate the returning officer's role assignment at the persisted return transition time, not the database wall-clock `now()`.
- Validate the resubmit-notification officer against the persisted resubmit transition time (or document and test a deliberately different accepted time rule).
- Keep current active-account checks and the Programme/Director stage-role mapping.
- Add explicit tests for wrong actor, wrong role, expired/not-yet-valid assignment and inactive officer; assert complete rollback.

## 3. Complete rollback and concurrency proof

The existing tests at A1 still assert only a subset of the required bundle, and the resubmit concurrency test still catches and discards exceptions. Replace these with honest complete-outcome assertions.

Create reusable assertion helpers for a registration subject/command and prove exact counts for:

- legacy application state/version and transition events;
- return or resubmission rows;
- notification command and recipient deliveries;
- workflow task and task events;
- SLA clock and clock events;
- discrepancy, responses and dispositions;
- cycle, cycle-return bindings and wiring evidence;
- no pending, partial, orphan or extra command/evidence residue.

Apply the complete assertions to:

- injected failure after partial return-workflow creation;
- invalid due/owner/actor/role inputs;
- concurrent return;
- concurrent resubmit.

Concurrency tests must record both outcomes and assert the expected winner plus the exact losing exception/replay result. Do not catch and ignore `Exception`. Assert one complete survivor and no extra rows.

## 4. Complete recipient and tamper proof

Expand or add tests so the names reflect what is actually proven:

- explicitly seed an eligible second filing-organisation account plus inactive, inactive-membership, expired-membership (if membership has validity fields) and wrong-organisation accounts; assert the exact recipient set;
- prove the applicant notification contains the persisted reason and exact calculated deadline and does not expose officer identity;
- prove Programme and Director officer recipients are resolved from persisted history and satisfy the accepted role/time rule;
- as runtime, attempt INSERT, UPDATE and DELETE against every new history family: return, resubmission, cycle, cycle-return binding and wiring evidence;
- verify runtime, app and PUBLIC cannot execute any internal security-definer helper, while runtime can execute only the two high-level orchestrators;
- keep the cross-application, closed-cycle, subject-delete, cleanup and absence-of-production-maint-function proofs.

## 5. Required named proof additions or replacements

Use clear method names. At minimum include proofs equivalent to:

1. `returnReplayWithOldHashAndChangedMaterialInputConflicts`
2. `resubmitReplayWithOldHashAndChangedMaterialInputConflicts`
3. `returnActorRoleValidityUsesPersistedTransitionTime`
4. `wrongActorRoleAndInactiveOfficerRollBackCompleteBundle`
5. `returnFailureLeavesNoLegacyOrWorkflowResidue`
6. `concurrentReturnHasOneCompleteSurvivorAndAssertedLoser`
7. `concurrentResubmitHasOneCompleteSurvivorAndAssertedLoser`
8. `returnNotificationUsesExactEligibleRecipientSetWithoutOfficerIdentity`
9. `runtimeCannotInsertUpdateOrDeleteAnyRegistrationWorkflowHistory`
10. `runtimeAppAndPublicExecuteOnlyDocumentedRegistrationCommands`

Existing methods may be renamed or consolidated, but do not claim a proof from a count of only one or two tables.

## 6. Documentation and tracking

Update `docs/snl/SNL_WP02C_REGISTRATION_DB_BOUNDARY.md` with the canonical database hash definition, replay/outcome validation, role-validity time rule and exact proof map.

Update `docs/snl/BEE_SNL_IMPLEMENTATION_PLAN.md`, `docs/snl/SNL_WP02B_RETURN_RESPONSE.md` and BL-257 to **19C-A2 implemented / review pending** only. Do not mark 19C accepted or raise WP2 progress before ChatGPT acceptance.

Do not modify `docs/BEE_SNL_DEVELOPMENT_PLAN.docx`.

## 7. Boundaries

Do not change:

- V69–V72;
- `RegistrationReviewService`, controllers, OpenAPI, BFF or UI;
- public HTTP shapes or model workflow behaviour;
- 19D artifacts, supervisor queue or 60-day automation;
- demo data beyond isolated test fixtures;
- the Word development plan.

Do not push or open a PR.

## 8. Required gates and hand-back

Run and report exact counts:

```text
cd backend && mvn test
cd backend && mvn test -Dgroups=db -Dbee.test.excludedGroups=none
npx tsc --noEmit
npm run web:test
npm run build
git diff --check d981bb6..HEAD
npm run local:down
```

Commit the corrections on the same branch, release this worktree's baton to `claude`, and provide `/bee-handback` with:

- exact canonical payload fields and whether caller hashes remain;
- finding-to-resolution table for sections 1–4;
- named tests and exact full-suite counts;
- exact runtime/app/PUBLIC/maint execute inventory;
- confirmation that 19C-B/C, APIs/UI and the Word document were untouched.
