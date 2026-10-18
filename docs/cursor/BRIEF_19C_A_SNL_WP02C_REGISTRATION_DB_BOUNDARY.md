# Brief 19C-A — SNL WP02C registration trusted database boundary

## Delivery target

- **Branch:** `cursor/snl-wp02c-registration-db-boundary`
- **Base:** `main @ d981bb6`
- **Work package:** WP2 / Brief 19C-A
- **Migration:** **V73**. Do not edit V69–V72.
- **Primary design:** `docs/snl/SNL_WP02C_REGISTRATION_RETURN_DESIGN.md`
- **Reference implementation:** V71/V72 and the accepted model return/response wiring. Reuse its integrity principles; do not couple registration rows to model tables.

This slice builds the database and internal Java persistence boundary only. It must not change the live registration HTTP journey yet.

## Governing manual references

Use the PDF-backed decisions already traced in the design document:

- §3 and §3.1.1, printed p. 22: online company/brand application and registration.
- §3.4, printed pp. 24–25: return/hold, revised evidence and rejection after no response.
- §3.10, printed p. 28: 30-day processing statement and 7-working-day discrepancy communication.
- Table 2, printed pp. 28–29: brand approval, 12-day discrepancy communication, 60-day applicant response and revised-document scrutiny.
- Annexure 1, printed pp. 50–53: registration evidence context.

The 7/12/15-day conflict remains **A08 / BL-255**. Use the accepted V70 `snl_return_response` policy as data. Do not hard-code a different deadline or implement the 60-day cancellation/rejection job in this brief.

## Required outcome

Add a replay-safe, atomic, least-privilege database boundary for registration return and resubmit cycles, including:

1. a durable registration return linked to the real `registration_transition_event`;
2. a durable registration resubmission linked to its return and real transition event;
3. an auditable return cycle with task, pinned SLA clock, discrepancy, response and cycle↔return binding;
4. applicant notification on return and officer notification on resubmit through the accepted V70 notification foundation;
5. high-level trusted commands as the only runtime write path;
6. an internal Java repository wrapper for those commands;
7. database proofs for atomicity, idempotency, concurrency, lifecycle, role/recipient resolution and runtime tamper resistance.

## 1. V73 schema

Choose clear names consistent with V71/V72, expected to include the equivalents of:

- `registration_application_return`
- `registration_application_resubmission`
- `registration_return_response_cycle`
- `registration_return_response_cycle_return`
- `registration_return_response_wiring_evidence`

Exact names may change only when the reason is documented in `docs/snl/SNL_WP02C_REGISTRATION_DB_BOUNDARY.md`.

Required integrity:

- Every return references one registration application and one unique persisted transition event whose action/from/to/version/actor/note match the return.
- Return stages are only `programme_review` or `director_approval`; target state is `returned`.
- Every resubmission references one return and one unique persisted `resubmit` transition for the same application; target state is `programme_review` under the accepted provisional local rule.
- Each return is bound to exactly one cycle. At most one cycle is open per application.
- `cycle_seq` is unique per application; task and discrepancy are structurally one-to-one with a cycle.
- Open/closed lifecycle fields are enforced declaratively and closed identity/history is immutable.
- Re-return before accepted forward remains in the same open cycle and disposes the prior response as `needs_more`; a later return after accepted closure starts the next cycle.
- New audit/evidence/link/return/resubmission tables are append-only, except the narrowly controlled cycle lifecycle fields written by trusted functions.
- Parent deletion is refused while workflow history exists; disposable-test cleanup is extended through the maintenance boundary only.

## 2. Trusted commands

Create high-level `SECURITY DEFINER` orchestrators equivalent to:

- `registration_return_response_orchestrate_wired_return`
- `registration_return_response_orchestrate_resubmit`

They must:

- pin `search_path` to the migration schema plus `pg_temp`;
- verify the real persisted registration transition rather than trusting caller-supplied stage, time, actor, version or reason;
- use the persisted transition timestamp as the audit anchor;
- acquire deterministic transaction advisory locks before inspecting idempotency/cycle state;
- validate a payload hash for every command replay and reject changed-payload reuse;
- create or validate the complete outcome as one transaction;
- pin the accepted V70 SLA policy version and calculate the due date through the working-day calendar;
- deliver notifications inside the same command boundary;
- record wiring evidence only after the complete bundle exists.

Internal helpers may be `SECURITY DEFINER` only when necessary. Revoke every internal helper from `PUBLIC`, `bee_runtime` and `bee_app`. Revoke default execute before granting runtime access. Runtime execute on the `registration_return_response_*` privileged family must be limited to the two documented orchestrators.

Do not expose a generic arbitrary-recipient notification command.

## 3. Recipient rules

### Return

- Resolve the filing organisation from `registration_application`; do not accept it as authoritative caller input.
- Deliver one `returned` notification to every active account in that organisation using the V70 organisation fan-out.
- The notification must include the application reference, persisted reason and exact policy-derived respond-by date.
- Do not expose the officer identity in applicant content (**A18**).

### Resubmit

- The transition target remains `programme_review`.
- Resolve the officer recipient from persisted history, not a caller-supplied account.
- Programme return: notify the Programme officer who returned it.
- Director return: follow the provisional 19C-0 rule and notify the returning Director even though the resumed state is `programme_review`; keep this visibly documented as an owner-confirmation assumption.
- Tie the officer notification to the persisted resubmission id, latest return bound to the open cycle and exact resumed stage.

## 4. Task, clock and discrepancy lifecycle

- Task subject: `registration_application`; action: `review`; stage/owner reflect the return stage.
- First return atomically creates or links the task, pins a policy clock, starts it and pauses it for applicant responsibility.
- Resubmit appends one contiguous discrepancy response and resumes the same clock.
- Re-return disposes the current response as `needs_more`, adds/binds the new return and pauses the same clock.
- This slice does **not** close the task/discrepancy/cycle on recommend/approve; that belongs to 19C-C.
- No Java constants for 7, 12, 15 or 60 days.

## 5. Java boundary

Add an internal repository, expected name `RegistrationReturnResponseWiringRepository`, that calls only the two high-level commands.

- It is not an HTTP controller or public API.
- Do not hook `RegistrationReviewService` in 19C-A.
- Avoid turning low-level repositories into Spring beans solely for this slice; follow the accepted WP2 wiring construction pattern.
- Map payload-safe replay conflicts to the existing workflow conflict exception used by 19B, ready for 19C-B.

## 6. Required proof

Add a dedicated `@Tag("db")` test class. Use descriptive names and include at least these proof groups:

1. `firstProgrammeReturnCreatesCompleteAtomicBundle`
2. `directorReturnUsesPersistedTransitionAndReturningDirectorRule`
3. `returnNotificationFansOutOnlyToActiveFilingOrganisationAccounts`
4. `returnPersistsAndNotifiesExactCalendarDueDate`
5. `identicalReturnReplayIsStableAndChangedPayloadConflicts`
6. `concurrentReturnCreatesOneCompleteOutcome`
7. `returnFailureRollsBackNotificationTaskClockDiscrepancyCycleAndEvidence`
8. `resubmitRequiresLatestReturnBoundToOpenCycle`
9. `resubmitAppendsResponseResumesClockAndNotifiesResolvedOfficer`
10. `identicalResubmitReplayIsStableAndChangedPayloadConflicts`
11. `concurrentResubmitCreatesOneCompleteOutcome`
12. `reReturnUsesSameCycleNeedsMoreAndPausesClockAgain`
13. `returnAfterClosedCycleStartsNextCycle` may be schema-command level with a maint/owner fixture because 19C-C closure is not yet wired; do not add a production bypass.
14. `runtimeCannotInsertRewriteOrDeleteRegistrationWorkflowHistory`
15. `runtimeExecuteListContainsOnlyRegistrationHighLevelCommands`
16. `internalHelperCannotBindReturnToClosedOrDifferentApplicationCycle`
17. `subjectDeleteBlockedWhileRegistrationWorkflowHistoryExists`
18. `disposableRegistrationCleanupRemovesNewRowsInDependencyOrder`

For injected rollback proof, use a test-schema trigger or test-only hook. Do not add a production magic value, production failure switch or public helper.

Concurrency tests must assert the complete survivor set: one legacy reference, one notification command/outcome, one task, one clock, one discrepancy/cycle/binding/evidence bundle, and no partial or in-progress idempotency residue.

## 7. Documentation and tracking

Create `docs/snl/SNL_WP02C_REGISTRATION_DB_BOUNDARY.md` containing:

- implemented schema and command signatures;
- transaction and privilege boundaries;
- recipient resolution;
- task/clock/discrepancy lifecycle;
- named proof map;
- exact PDF references and the A02/A03/A08/A17/A18/A20 assumptions still open;
- explicit 19C-B/19C-C deferrals.

Update:

- `docs/snl/BEE_SNL_IMPLEMENTATION_PLAN.md` with 19C-A **implemented / review pending**, not accepted;
- `docs/snl/SNL_WP02B_RETURN_RESPONSE.md` delivery table;
- `docs/BACKLOG.md` BL-257 without closing it.

Do not modify the Word development plan.

## 8. Boundaries

Do not change:

- V69–V72;
- `RegistrationReviewService`, controllers, OpenAPI, BFF or UI;
- existing HTTP response shapes;
- model return/resubmit behaviour;
- supervisor queue, 60-day automation, public-form comparison or policy decisions;
- demo data except disposable test-cleanup support required for V73 tests;
- `docs/BEE_SNL_DEVELOPMENT_PLAN.docx`.

Do not push or open a PR.

## 9. Required gates

Run and report exact counts:

```text
cd backend && mvn test
cd backend && mvn test -Dgroups=db -Dbee.test.excludedGroups=none
npx tsc --noEmit
npm run web:test
npm run build
git diff --check main..HEAD
npm run local:down
```

If database tests need the local PostgreSQL service, start only what is required and run `ensure-runtime-role.sh` after reset. Leave services down at hand-back.

## 10. Hand-back

Commit all tracked work on the task branch, release the worktree baton to `claude`, and provide `/bee-handback` with:

- branch, base and commit;
- migration and runtime EXECUTE list;
- proof names mapped to sections 1–6;
- exact test counts;
- behaviour and boundaries;
- deferred 19C-B/19C-C work;
- confirmation that the Word document was untouched.
