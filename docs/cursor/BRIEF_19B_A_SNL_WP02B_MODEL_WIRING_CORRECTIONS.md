# Brief 19B-A — SNL WP02B model wiring integrity corrections

## Status

Brief 19B is **not accepted**. Continue on `cursor/snl-wp02b-model-return-wiring` from `6ba6c68`. V71 is still unmerged, so correct V71 in place; do not add V72.

The functional happy path is useful, but five mandatory proof categories were deferred and review found concrete failures behind them. Close every item below before handback.

## Governing scope

- Original Brief 19B remains authoritative, including all 14 Required proof items.
- Preserve the existing HTTP routes and successful receipt shapes.
- Preserve the model-only boundary; 19B-2 stage-forward closure remains deferred.
- Do not edit V69 or V70.

## Blocking finding 1 — caught failures can commit partial resubmission

`ResubmitApplicationService.run` performs the legacy state transition before wiring. It catches `WorkflowIdempotencyConflictException` and `model_return_officer_ambiguous` and returns a response from inside the `@Transactional` method. Because the exception does not leave the transaction boundary, Spring may commit the already-written model transition, discrepancy response and clock resume.

The same rollback risk exists for caught post-transition wiring conflicts in `StageReturnService`.

Required correction:

- make every post-transition wiring failure roll back the entire transaction before an HTTP error is translated;
- do not assume `idempotency.abandon` causes rollback;
- use an exception boundary outside the transaction or an explicitly proven rollback-only design;
- prove both database state and the existing HTTP error response.

Required tests:

- `assigneeUnavailableRollsBackLegacyResubmitAndWorkflowWrites`;
- `wiringConflictRollsBackLegacyReturnAndAllFoundationWrites`;
- an injected failure after at least one workflow write proving no model transition, return/resubmission, task, clock event, discrepancy response, notification, command or evidence row survives.

## Blocking finding 2 — arbitrary recipient delivery

V71 `notification_foundation_deliver_recipient` accepts any recipient UUID and checks only that the account is active. `bee_runtime` has EXECUTE, so it is a generic “send to any active account” capability, expressly forbidden by Brief 19B.

Required correction:

- replace it with a model-resubmission-specific command that derives or validates the recipient at the database boundary from authoritative application, return-cycle, stage and assignment data;
- fix the kind to `applicant_resubmitted` inside the trusted function;
- reject registration subjects, arbitrary kinds, unrelated recipients, missing assignees and ambiguous assignees;
- hash/store every security-relevant input and the resolved recipient;
- Java must not be able to override the database-authorized recipient.

Required tests:

- runtime cannot notify an unrelated active account;
- runtime cannot change kind, subject or recipient;
- the correct IAME/reviewer recipient succeeds;
- director/secretary uses the documented original-return actor rule;
- inactive, missing and ambiguous recipients fail closed with zero rows.

## Blocking finding 3 — runtime can forge and rewrite linkage

V71 grants `bee_runtime` direct `INSERT, UPDATE` on `model_return_response_cycle` and direct `INSERT` on wiring evidence. It can replace `task_id`, `discrepancy_id`, stage data, or forge command completion.

Required correction:

- revoke direct INSERT/UPDATE/DELETE/TRUNCATE on both V71 tables from runtime;
- expose only narrow security-definer commands needed by the service;
- make cycle identity/linkage immutable, with only an audited/validated resumed-stage operation if still required;
- enforce that the linked task and discrepancy belong to the same model application and expected stage/action/line;
- pin search paths, revoke PUBLIC, and grant only required EXECUTE;
- retain maintenance cleanup without weakening runtime controls.

Required tests:

- `runtimeCannotForgeOrRewriteCycleOrEvidence`;
- mismatched task/discrepancy/application linkage is refused at the database boundary;
- valid replay through the command boundary remains idempotent.

## Blocking finding 4 — client-settable GUC can suppress applicant notification

`notify_on_return` trusts `bee.model_return_wired=true`, and any database session can set a custom GUC. A runtime session can therefore suppress the V39 notification without proving that the replacement V70 notification exists.

Required correction:

- remove the client-controlled GUC bypass;
- implement a database-enforced trusted return command or another design where the legacy return, foundation evidence and exactly-one applicant notification are inseparable;
- runtime must not be able to create a return with neither notification nor workflow evidence;
- an unwired legacy/internal test path must retain its established V39 compatibility where required, without creating a production bypass.

Required tests:

- setting the old GUC cannot suppress notification;
- runtime cannot insert a production return outside the trusted path;
- successful wired return creates exactly one applicant notification;
- failure in notification delivery rolls back the legacy return and state transition.

## Blocking finding 5 — missing required scenario and concurrency proof

Add the proofs explicitly omitted from the handback:

- rating-superseded resubmit resolves the programme/rating officer correctly and records `last_resumed_stage = rating`;
- missing and multiple active assignments return `assignee_unavailable` and roll back;
- concurrent identical HTTP return attempts create one complete outcome and a replay/conflict response, never partial duplicates;
- concurrent identical HTTP resubmit attempts create one response/resume/notification set;
- changed-payload command reuse conflicts without mutation;
- runtime grants and tamper attempts are refused.

The due-date integration test must assert the exact expected India-calendar date/time for a known return anchor with a persisted closure; checking only that the message contains “Respond by” is insufficient.

## Additional integrity checks

- Avoid `max(response_seq) + 1` without a locking/command boundary that makes concurrent sequence allocation safe.
- Ensure a repeated return is accepted only from the valid discrepancy/clock state; do not silently pause an already-paused clock or ignore an unexpected discrepancy status.
- Ensure replay evidence insertion is concurrency-safe and payload-safe.
- Validate active assignment and active recipient status at the same trusted database boundary.
- Keep existing V39 notification history readable and cleanup dependency order correct.

## Documentation

Update `docs/snl/SNL_WP02B_MODEL_RETURN_WIRING.md`:

- remove the claim that zero/multiple candidates cause full rollback until the new tests prove it;
- record the final trusted command boundaries and runtime grants;
- map all 14 original proof items to named tests;
- keep 19B status “review corrections pending” until ChatGPT accepts it.

Do not mark 19B complete in the plan or BL-257 yet.

## Required gates

- Focused security, rollback, assignee, rating and concurrency tests named above.
- `cd backend && mvn test`.
- `cd backend && mvn test -Dgroups=db -Dbee.test.excludedGroups=none`.
- `npx tsc --noEmit`.
- `npm run web:test`.
- `npm run build`.
- `git diff --check main..HEAD` after commit.
- `npm run local:down`.
- Clean tracked tree; leave `docs/BEE_SNL_DEVELOPMENT_PLAN.docx` untouched.

## Handback

Run `/bee-handback`. Resolve each of the five numbered findings separately, list the exact named tests, full pass counts, final V71 privileges/command functions, transaction rollback mechanism, commit hash and remaining 19B-2/19C–19D deferrals.
