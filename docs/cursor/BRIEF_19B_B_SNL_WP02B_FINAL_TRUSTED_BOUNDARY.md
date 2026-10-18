# Brief 19B-B — SNL WP02B final trusted-boundary and proof closure

## Status

Brief 19B remains **not accepted**. Continue on `cursor/snl-wp02b-model-return-wiring` from `18455a1`. Correct V71 in place; do not add V72.

Brief 19B-A improved the design, but review found residual bypasses in the new security-definer commands, and the service rollback behaviour is not tested through the Spring transaction boundary. Original proof items 7 and 10 also remain explicitly deferred. Close every item below; no Brief 19B requirement may be deferred again.

## 1. Make a wired return inseparable at the database boundary

Current `model_return_response_insert_return` requires only a delivered `returned` notification command and a transition event. Runtime can create/reuse such a notification through the V70 command and then insert a return without a linked cycle, task, policy clock, discrepancy or wiring evidence. The notification message is also not bound to the return reason.

Required:

- a runtime-callable return command must validate or create the complete trusted bundle: matching model transition, return row, task, pinned clock, valid start/pause events, return-response discrepancy, cycle linkage, payload-safe wiring evidence and exactly-one notification;
- no callable sequence available to runtime may commit a return with only the notification/transition subset;
- bind application, return id, transition id, stage, reason, actor, task/discrepancy/clock identity, policy/due data and notification command into command evidence or equivalent validation;
- ensure the notification message/due date is derived from or cryptographically/payload-bound to the same return reason and policy anchor;
- direct table DML stays revoked;
- preserve V39 legacy history and maint-only disposable cleanup.

A single higher-level security-definer orchestration command is preferred. If composition is retained, the final command must verify every prerequisite and no intermediate runtime command may forge completion.

Required tests:

- `runtimeCannotInsertReturnWithNotificationOnly`;
- `runtimeCannotInsertReturnWithMismatchedReasonStageActorOrTransition`;
- `wiredReturnCommandCreatesOrValidatesCompleteBundleAtomically`;
- notification failure and an injected failure after task/clock/discrepancy creation both leave the model state, transition, return, workflow and notification tables unchanged.

## 2. Remove generic evidence and resumed-stage forgery

Current runtime EXECUTE on `model_return_response_record_wiring_evidence` allows an arbitrary command id, purpose and payload hash to be recorded for any existing application. `model_return_response_update_last_resumed_stage` accepts any short text and does not prove a matching resubmission.

Required:

- runtime must not have a generic “record evidence” capability;
- evidence must be written only inside the trusted operation it proves, using a hash calculated or verified by that operation;
- resumed-stage changes must occur only inside a trusted resubmit command;
- validate the stage against the allowed model states and against the matching `model_application_resubmission.resumed_state`;
- a cycle row's identity, review stage, task and discrepancy remain immutable;
- document the exact final runtime EXECUTE list and why each function cannot forge state.

Required tests:

- `runtimeCannotForgeEvidenceThroughGrantedFunctions`;
- `runtimeCannotSetArbitraryOrUnmatchedResumedStage`;
- a valid trusted resubmit records evidence and stage exactly once;
- changed-payload replay conflicts without mutation.

## 3. Bind officer notification to an actual resubmission

Current officer command resolves an account but does not require a matching resubmission row/current journey state. Its notification payload hash omits `return_id` and `resumed_stage`.

Required:

- require an existing, matching resubmission for the application and return id;
- require its persisted `resumed_state` to equal the requested/derived stage;
- require the return to belong to the linked cycle/application and be the response being handled;
- include return id, resumed stage and resolved recipient in the command payload identity;
- derive fixed kind/text inside the database;
- no arbitrary recipient, subject, stage or kind parameters.

Required tests:

- `officerNotificationRequiresMatchingPersistedResubmission`;
- changed return id or resumed stage with the same command id conflicts/refuses;
- unrelated, stale or fabricated resubmission inputs produce no notification.

## 4. Prove mapped 409 rollback through the real Spring service

The 19B-A rollback tests call repositories/wiring inside a test transaction and let an exception escape. They do not execute `StageReturnService` or `ResubmitApplicationService`, do not exercise the caught-exception branches, and do not prove that `setRollbackOnly()` plus a returned 409 rolls back.

Required:

- call the real Spring-proxied service or HTTP controller with production repositories and a throwaway database schema;
- force `assignee_unavailable` after the legacy resubmit write;
- force an idempotency/wiring conflict after the legacy return write;
- assert the method/HTTP response is the documented 409;
- after the transaction completes, assert zero partial legacy, idempotency, workflow, notification, command and evidence writes;
- add an injected failure after at least one task/clock/discrepancy write and prove full rollback.

Named tests:

- `serviceAssigneeUnavailableReturns409AndRollsBackEverything`;
- `serviceWiringConflictReturns409AndRollsBackEverything`;
- `serviceInjectedMidWorkflowFailureRollsBackEverything`.

If reliable failure injection requires a package-private test seam, keep it narrow and disabled by default; do not add a production HTTP switch or environment flag.

## 5. Close original proof item 7 — rating supersession

Create the real journey:

1. progress an application through rating to director or secretary;
2. return it;
3. change a rating input in an allowed returned edit;
4. resubmit through the real service;
5. prove `ratingSuperseded=true`, persisted resumed state and cycle `last_resumed_stage` are `rating`;
6. prove exactly the authoritative programme/rating assignee receives the officer notification;
7. prove the original director/secretary does not receive it unless that account is also the sole authoritative rating assignee.

Required test: `ratingSupersededResubmitReturnsToRatingAndNotifiesProgrammeAssignee`.

## 6. Close original proof item 10 — concurrent HTTP/service commands

Exercise concurrent production command entry, not two direct repository calls.

Required:

- concurrent identical return requests with one idempotency key produce one complete committed return; the other receives a documented replay/in-progress outcome;
- concurrent identical resubmit requests produce one resubmission, one response sequence, one resume event and one officer notification;
- concurrent changed-payload reuse produces one winner and one conflict;
- assert there are no orphan/duplicate task, clock, discrepancy, cycle, notification, command or evidence rows.

Named tests:

- `concurrentServiceReturnCreatesOneCompleteOutcome`;
- `concurrentServiceResubmitCreatesOneCompleteOutcome`;
- `concurrentChangedPayloadHasOneWinnerAndOneConflict`.

## 7. Exact due-date integration proof

The current calendar test calls the policy repository directly and does not verify the wired notification/task.

Add an integrated return test with a known Kolkata anchor and persisted closure. Assert:

- exact `workflow_task.due_at`;
- exact pinned policy/version and anchor;
- exact human-readable date in the applicant notification;
- the return reason and notification payload correspond to the same command.

Required test: `wiredReturnPersistsAndNotifiesExactCalendarDueDate`.

## Other invariants

- Repeat return accepts only a valid awaiting-review response/clock state; unexpected or already-paused sequences refuse and roll back.
- Response sequence allocation stays locked and contiguous.
- Security-definer search paths are pinned; PUBLIC execute revoked.
- Runtime has SELECT-only table access where reads are needed, and only the minimum high-level EXECUTE grants.
- No registration, public API shape, BFF, UI, scheduler, Word/PDF or demo-seed changes.
- Keep 19B-2 stage-forward closure deferred; that is the only permitted 19B deferral.

## Documentation

Update `docs/snl/SNL_WP02B_MODEL_RETURN_WIRING.md` with:

- the final high-level trusted commands and runtime privilege table;
- the actual Spring transaction rollback mechanism and service-level proof;
- all original Brief 19B proof items 1–14 mapped to named passing tests;
- status “review pending”; do not mark 19B complete before ChatGPT acceptance.

Keep BL-257 and the WP2 dashboard accurate.

## Required gates

- All focused tests named above.
- `cd backend && mvn test`.
- `cd backend && mvn test -Dgroups=db -Dbee.test.excludedGroups=none`.
- `npx tsc --noEmit`.
- `npm run web:test`.
- `npm run build`.
- `git diff --check main..HEAD` after commit.
- `npm run local:down`.
- Clean tracked tree; leave `docs/BEE_SNL_DEVELOPMENT_PLAN.docx` untouched.

## Handback

Run `/bee-handback`. Resolve sections 1–7 separately. Report final V71 functions/grants, transaction boundary, all named tests and full pass counts, commit hash, and only the permitted 19B-2/19C–19D deferrals.
