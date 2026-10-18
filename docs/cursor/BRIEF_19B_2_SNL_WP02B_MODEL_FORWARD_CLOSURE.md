# Brief 19B-2 — SNL WP02B model stage-forward closure and repeat-cycle safety

## Status and starting point

Start from `main @ f732482` on branch `cursor/snl-wp02b-model-forward-closure`. Brief 19B is accepted and merged. Add **V72**; do not edit V69, V70 or V71.

This slice closes the workflow task, SLA clock and applicant response when an officer successfully advances a resubmitted model application. It must also make a later return at a later stage a new, independently auditable cycle. No public HTTP shape changes are required.

Before coding, update `docs/snl/SNL_WP02B_MODEL_RETURN_WIRING.md` with the chosen cycle model, exact transition map and transaction boundary.

## 1. Normalize return cycles without losing V71 history

V71 stores one `model_return_response_cycle` per application and V69 permits only one `return_response` discrepancy per subject. That cannot safely represent: return → resubmit → accepted forward → later return at another stage.

V72 must:

- migrate existing V71 rows without deleting or rewriting their task, clock, discrepancy, response, disposition, notification or evidence history;
- give each model return cycle a stable identity and an explicit open/closed lifecycle;
- allow at most one open model return cycle per application;
- allow a later cycle after the earlier cycle is closed;
- give every cycle its own task, pinned SLA clock and discrepancy record;
- preserve contiguous response sequences inside each discrepancy;
- keep all identity and closure fields protected from runtime table DML;
- update/replace the V71 trusted functions so return/resubmit always select the single open cycle and never attach to a closed cycle;
- retain replay compatibility for commands already recorded by V71.

Do not solve this by reopening or overwriting a closed task/discrepancy/cycle. If the general discrepancy uniqueness constraint must evolve, migrate it explicitly and retain an unambiguous occurrence/cycle key.

Required tests:

- `existingV71OpenCycleMigratesWithoutHistoryLoss`;
- `onlyOneOpenCyclePerApplication`;
- `acceptedCycleThenLaterStageReturnCreatesIndependentCycle`;
- `closedCycleCannotReceiveNewResponseDispositionOrClockEvent`.

## 2. Add one trusted forward-closure command

Add a high-level V72 security-definer command called from the application layer after the legacy stage-forward transition is written in the same Spring transaction.

The command must:

- validate the application, transition event, actor, action, from-state, to-state and version against the persisted legacy transition;
- do nothing, with no evidence row, when the application has no open return cycle (ordinary never-returned journeys stay unchanged);
- require the open cycle's `last_resumed_stage` to equal the transition's from-state;
- require exactly one latest applicant response that has no disposition;
- append an `accepted` disposition bound to that response and actor;
- append exactly one valid `stop` event to the cycle's pinned clock;
- complete the matching workflow task with an inseparable task event;
- close the cycle with the accepted transition identity and timestamp;
- record payload-safe replay evidence for the complete bundle;
- reject changed-payload replay and refuse stale, fabricated, wrong-stage or already-closed inputs without partial writes.

Runtime must receive EXECUTE only on the high-level V72 orchestration command. Internal helpers and all affected tables remain unavailable for direct runtime mutation. Pin `search_path` and revoke PUBLIC execute.

Required tests:

- `forwardClosureAcceptsLatestResponseStopsClockAndCompletesTask`;
- `forwardClosureWithoutOpenCycleIsNoOp`;
- `forwardClosureRejectsWrongStageActorActionOrTransition`;
- `forwardClosureReplayIsStableAndChangedPayloadConflicts`;
- `runtimeCannotForgeDispositionTaskClockCycleOrEvidence`;
- `injectedFailureAfterDispositionRollsBackLegacyForwardAndClosureBundle`.

## 3. Wire every valid resumed model stage

Hook the trusted closure into the existing transactional service for each possible resumed stage:

| Resumed stage | Existing command/service | Expected legacy forward |
| --- | --- | --- |
| `iame_scrutiny` | `IameRecommendationService` | `iame_recommend` → `bee_scrutiny` |
| `bee_scrutiny` | `ReviewerForwardService` | `reviewer_forward` → `rating` |
| `rating` | `RatingService` | `compute_rating` → `director_review` |
| `director_review` | `DirectorRecommendationService` | `director_recommend` → `secretary_approval` or `approved` |
| `secretary_approval` | `SecretaryApprovalService` | `secretary_approve` → `approved` |

Expose the legacy transition event id and occurred-at time from repositories instead of re-querying by time. Call one Spring component (for example `WorkflowReturnResponseWiring.afterAcceptedForward`) from each service only after a newly committed legacy result, never on replay.

If the closure command fails after the legacy write, mark the Spring transaction rollback-only before returning any mapped error, following the accepted Brief 19B pattern. Preserve all existing route responses, idempotency behaviour, assignment rules, certificates and notifications.

Required service/database tests:

- one named accepted-forward closure test for each of the five rows above;
- Director-final approval and Director-to-Secretary both close the Director cycle correctly;
- a legacy journey with no return cycle produces exactly the same database result as before;
- a mapped closure conflict rolls back the legacy transition, assignment/certificate side effects and all workflow writes;
- concurrent identical stage-forward commands produce one legacy transition and one closure bundle; changed-payload reuse produces one winner and one conflict.

## 4. Prove complete multi-cycle journeys

Add end-to-end database/service proofs using production repositories/services:

1. return at IAME → applicant resubmit → IAME recommend (cycle 1 accepted/closed) → return at BEE → resubmit → Reviewer forward (cycle 2 accepted/closed);
2. progress through rating → return from Director → rating-superseded resubmit to Rating → compute Rating (cycle accepted/closed) → later return from Secretary → resubmit → Secretary approve (new cycle accepted/closed);
3. re-return before an accepted forward continues the same open cycle with `needs_more`; it must not create a second task or discrepancy.

Assert distinct cycle/task/clock/discrepancy identities, correct pinned policies and due dates, immutable prior history, no open task after forward, no running clock after forward, and one open cycle at most.

## 5. Documentation and plan

- Update `docs/snl/SNL_WP02B_MODEL_RETURN_WIRING.md` with V72 objects, lifecycle and proof map.
- Update `docs/snl/SNL_WP02B_RETURN_RESPONSE.md` so 19B-2 is “review pending” only after implementation.
- Update `docs/snl/BEE_SNL_IMPLEMENTATION_PLAN.md` and BL-257 accurately; do not mark 19B-2 accepted or increase WP2 beyond an evidence-based value before ChatGPT review.
- Add no new backlog row for work completed here. Add one only for a genuinely out-of-scope defect discovered during implementation.

## Boundaries

- No registration journey wiring (19C).
- No common read API, BFF, UI or supervisor queue (19D/later).
- No 60-day scheduler, cancel/reject normalization or generic rejection wiring.
- No OpenAPI or external response-shape change.
- No demo seed, Word or PDF edits.
- Do not touch untracked `docs/BEE_SNL_DEVELOPMENT_PLAN.docx`.
- Do not push or open a PR.

## Required gates

- All named focused tests above.
- `cd backend && mvn test`.
- `cd backend && mvn test -Dgroups=db -Dbee.test.excludedGroups=none`.
- `npx tsc --noEmit`.
- `npm run web:test`.
- `npm run build`.
- `git diff --check main..HEAD` after commit.
- `npm run local:down`.
- Clean tracked tree; leave the owner-controlled Word file untouched.

## Handback

Run `/bee-handback`. Report V72 schema changes, the final runtime EXECUTE list, hooks in all five services, exact cycle lifecycle, named multi-cycle/concurrency/rollback/security proofs, full gate counts, commit hash and any honest deferrals. Release the baton to `claude`.
