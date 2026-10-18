# Brief 19C-A1 — SNL WP02C registration database-boundary corrections

## Delivery target

- **Branch:** `cursor/snl-wp02c-registration-db-boundary`
- **Base:** `main @ d981bb6`
- **Review target:** Brief 19C-A at `fc1b2f4`
- **Work package:** WP2 / Brief 19C-A1
- **Migration:** correct **V73 in place**. Do not add V74 and do not edit V69–V72.
- **Primary design:** `docs/snl/SNL_WP02C_REGISTRATION_RETURN_DESIGN.md`

Brief 19C-A is **not accepted**. Preserve its sound schema and least-privilege work, but close every item below before another hand-back. This remains a database/internal-repository slice: do not wire `RegistrationReviewService` or change an HTTP route.

## 1. Remove the production closure bypass

Remove `registration_return_response_maint_close_cycle` and its grants from V73. It accepts caller-selected transition identity, states and time without proving a real registration transition and therefore is a production bypass, even though only the maintenance role can execute it.

Keep the next-cycle proof without shipping a closure command:

- create any fixture-only function, trigger or owner mutation inside the throwaway test schema;
- create and remove it from test setup/teardown;
- do not add a production failure switch, magic input, generic maint closure or public helper;
- prove the function is absent from the migrated production schema and has no runtime/app/maint grant.

The real trusted forward-closure command remains deferred to 19C-C.

## 2. Make the two runtime commands genuinely trusted

The runtime caller must not be able to choose audit identity, ownership or SLA metadata that contradicts persisted facts.

### Return command

- Derive or independently verify the return stage, actor account, actor role, transition time, reason and application version from the persisted `registration_transition_event` and `registration_application_return` relationship.
- Enforce the stage-to-role rule: `programme_review` requires the accepted Programme role; `director_approval` requires the accepted Director role.
- Derive or verify task owner role/account from the persisted returning officer and return stage. Reject a different role or account atomically.
- Require the audit actor passed to notification/workflow evidence to equal the persisted transition actor, or stop accepting it as caller input.
- Pin the applicable `snl_return_response` policy and calculate the exact due time from the stored transition anchor, calendar, weekend and closure data inside the trusted database boundary. If `due_at` remains an input, independently calculate and reject any mismatch.
- Bind the notification command and message to the persisted application reference, persisted reason and exact calculated deadline. A loose “message contains reason” check is insufficient. Applicant content must not disclose officer identity (A18).

### Resubmit command

- Resolve the latest return bound to the open cycle and verify every supplied return fact against the persisted return row; preferably remove redundant caller inputs.
- Resolve the officer recipient from persisted history and enforce an active account plus the appropriate active role/validity window for the return stage.
- Require audit actor identity to match the persisted resubmit transition actor, or derive it internally.
- Bind the officer notification to the persisted resubmission id, return id, resolved recipient and resumed stage.

Continue to expose only these two high-level functions to `bee_runtime`:

- `registration_return_response_orchestrate_wired_return`
- `registration_return_response_orchestrate_resubmit`

All internal `SECURITY DEFINER` helpers must remain revoked from `PUBLIC`, `bee_runtime` and `bee_app` with a pinned schema plus `pg_temp` search path.

## 3. Make replay stable across later lifecycle changes

An identical replay must return the persisted completed result even after the live application has advanced.

- Acquire the deterministic command lock and inspect existing wiring evidence/command outcome before requiring the application to remain in the original `returned` or `programme_review` state.
- Validate the replay payload against the persisted payload hash and complete outcome.
- Return or validate the persisted return/resubmission identity; do not treat a caller-selected id as the authoritative replay result.
- Identical return replay must still succeed after resubmit.
- Identical resubmit replay must still succeed after a later re-return.
- Reusing the command id with any changed material input must still return the existing workflow idempotency conflict and create no row.

## 4. Strengthen the database proofs

Keep the original 18 proof groups, correct any overstated method name, and add or expand named tests for all of the following.

### Trusted inputs and recipients

- wrong due time is rejected with no partial bundle;
- wrong task owner account, owner role, audit actor or stage-role combination is rejected atomically;
- resubmit facts that differ from the persisted latest return are rejected;
- applicant fan-out explicitly seeds and excludes inactive, expired and wrong-organisation accounts while including every eligible filing-organisation account;
- Programme and Director resubmit recipients have the required active role and follow the documented provisional Director rule.

### Replay and lifecycle

- identical return replay after resubmit is stable;
- identical resubmit replay after re-return is stable;
- changed-payload replay after those state changes conflicts;
- next-cycle proof uses only a test-schema fixture, and the production maint closure function is absent.

### Atomicity and concurrency

The injected-failure and concurrent return/resubmit tests must assert the complete row set, not only the legacy return/cycle count. Cover:

- legacy transition/state and return or resubmission;
- notification command, notification deliveries and any recipient evidence;
- workflow task and task events;
- clock and clock events;
- discrepancy, response and disposition where applicable;
- cycle, cycle-return binding and wiring evidence;
- no partial, pending or orphan idempotency residue.

For concurrency, assert one complete survivor and one replay/conflict outcome as appropriate. Do not swallow an exception without asserting its type and result.

### Tamper and relational integrity

- runtime cannot insert, update or delete return, resubmission, cycle, binding or evidence history;
- runtime/app/PUBLIC cannot execute internal helpers;
- runtime execute inventory contains only the two documented orchestrators;
- a persisted return from application A cannot bind to application B's cycle (use two real applications and returns);
- a closed cycle cannot receive another binding through an internal owner/test call;
- subject delete guard and disposable cleanup continue to pass.

## 5. Documentation and tracking

Update `docs/snl/SNL_WP02C_REGISTRATION_DB_BOUNDARY.md` so the command signatures, derivation rules, production privileges and proof map match the corrected code. Remove every suggestion that a production maint closure helper exists.

Update the implementation plan and BL-257 only to **19C-A1 implemented / review pending**. Do not mark 19C-A accepted and do not raise WP2 progress until ChatGPT accepts the corrected boundary.

Do not modify `docs/BEE_SNL_DEVELOPMENT_PLAN.docx`.

## 6. Boundaries

Do not change:

- V69–V72;
- `RegistrationReviewService`, controllers, OpenAPI, BFF or UI;
- public HTTP response shapes;
- model return/resubmit/forward-closure behaviour;
- supervisor queue or 19D artifacts;
- 60-day automation, policy decisions or demo journeys;
- the Word development plan.

Do not push or open a PR.

## 7. Required gates

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

If PostgreSQL is reset, run `ensure-runtime-role.sh` before the database suite. Leave local services down at hand-back.

## 8. Hand-back

Commit all tracked corrections on the same branch, release this worktree's baton to `claude`, and provide `/bee-handback` containing:

- branch, base and commit;
- exact V73 runtime and maintenance execute inventories;
- one-to-one finding-to-resolution table for sections 1–4;
- named proof map, including lifecycle-stable replay and complete survivor/rollback assertions;
- exact gate counts;
- behaviour, boundaries and 19C-B/19C-C deferrals;
- confirmation that the Word document was untouched.
