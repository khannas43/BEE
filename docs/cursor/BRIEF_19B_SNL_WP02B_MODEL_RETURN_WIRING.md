# Brief 19B — SNL WP02B model return/resubmit loop

## Purpose

Wire the existing model-application return and resubmit commands to the accepted WP2A workflow foundation and V70 notification foundation. Deliver one production-safe loop: officer return → applicant response → officer work resumes, including repeat return cycles.

Work on `cursor/snl-wp02b-model-return-wiring`, based on main merge `582f0b5`. This is a back-end slice. Do not add registration wiring, common read APIs or UI.

## Governing requirements

- `docs/snl/SNL_WP02B_RETURN_RESPONSE.md`.
- Accepted V69/V70 foundation and `docs/snl/SNL_WP02A_WORKFLOW_FOUNDATION.md`.
- Manual §3.10 / Tables 2–3, printed pp. 28–30.
- A08 remains provisional and BL-255 remains open. The persisted `snl_return_response` policy is the only time-limit source.
- Existing model return/resubmit behaviour, authorization, evidence gates, HTTP contracts and idempotency receipts remain compatible.

## Before coding

- Read `AGENTS.md`, this brief, the WP2B design note, V31, V39, V69 and V70 completely.
- Inspect `StageReturnService` / `StageReturnRepository`, `ResubmitApplicationService` / `ResubmitApplicationRepository`, the assignment model, and `ReworkDatabaseTest`.
- Run `npm run local:reset`, not Flyway repair: V70 was corrected before merge and the retained local database may have its earlier checksum.
- Confirm V71 is the next migration. Never edit V69 or V70.
- Record the final transaction/linkage design in `docs/snl/SNL_WP02B_MODEL_RETURN_WIRING.md` before coding.

## Required behaviour

### 1. Durable model-cycle linkage

Add the minimum V71 schema/commands needed to link a model application's legacy return cycle to exactly one common:

- open review task;
- policy-pinned SLA clock;
- `return_response` discrepancy;
- ordered discrepancy responses and dispositions.

The linkage must be explicit and queryable; do not infer identity by “latest row”. It must support legacy applications created before V71 without a bulk backfill: the first wired return or resubmit establishes the missing foundation idempotently.

Use the original returned stage as the review-task stage and the responsible officer/role as owner. If a director/secretary return is resubmitted to `rating` because rating inputs changed, record that resumed state without losing the original return-cycle identity.

### 2. Officer return

On a successful existing `POST /api/model-applications/{id}/return`:

- keep all current authorization, segregation, validation, version and receipt behaviour;
- select the applicable `snl_return_response` policy using the return instant's Asia/Kolkata date;
- create or reuse the review task atomically with due time, pinned policy and clock;
- append valid clock `start` then applicant `pause` events;
- open the discrepancy using the officer's reason;
- notify the applicant organisation exactly once with the existing safe reference/reason content plus the due date;
- on a repeat return after a response, dispose that response as `needs_more`, retain the same task/clock/discrepancy, then pause again.

No legacy return, workflow evidence or notification may survive alone if any other part fails.

### 3. Applicant resubmit

On a successful existing `POST /api/model-applications/{id}/resubmit`:

- retain current evidence revalidation, rating-supersession, version and receipt behaviour;
- append the next contiguous discrepancy response using the applicant note, or a stable neutral text when the optional note is absent;
- append the clock `resume` event;
- send one `applicant_resubmitted` notification to the actual officer account responsible for the resumed stage;
- do not fan this notification out to the applicant organisation;
- do not expose private applicant evidence or internal notes in notification text.

Officer selection must come from authoritative assignment/role data and fail closed when no single eligible recipient can be established. For all-scope director/secretary stages, document and implement the deterministic recipient rule. Do not accept an arbitrary recipient account from the HTTP caller.

### 4. Atomicity and replay

The legacy state transition, workflow rows, clock events and notifications are one transaction.

- Derive internal command IDs deterministically from the existing HTTP idempotency key, subject and purpose.
- Same command and same payload replays with no additional task, event, response, disposition or notification.
- Same command ID with changed payload conflicts.
- Concurrent identical commands yield one complete result.
- A stale version, policy error, missing assignee, notification error or injected workflow failure rolls back every legacy and workflow write.
- Do not rely only on Java pre-checks for concurrency invariants; enforce the critical uniqueness/order at the database boundary.

The current service replay path may return its stored HTTP receipt without re-running wiring, but the first committed attempt must already contain the complete workflow evidence.

### 5. Notification compatibility

V39 currently creates applicant return notifications by trigger. Adapt the V71 path so a wired return produces exactly one applicant notification, not the old trigger row plus a command row. Existing pre-V71 notification history remains untouched.

Use a narrow database command for officer delivery. Extend the V70 command evidence only as needed so target identity is hash-covered and replay-safe. Runtime must not gain arbitrary notification-table write access or a generic “send to any account” capability.

The existing `/api/notifications` JSON shape stays unchanged; `applicant_resubmitted` may now be visible to the targeted officer through the existing endpoint.

## Required proof

Add focused unit/database/service tests proving at least:

1. first return creates one task, one pinned clock, one discrepancy, start+pause events and one applicant notification;
2. policy/due calculation respects the persisted calendar and return anchor;
3. resubmit adds response 1, resumes the same clock and notifies only the responsible officer;
4. resubmit with no note still creates a valid neutral response;
5. return → resubmit → return produces `needs_more`, then a second pause on the same cycle;
6. return → resubmit → return → resubmit creates contiguous response 2 without a second task/clock/discrepancy;
7. rating-superseded resubmit records `rating` and selects the correct responsible officer;
8. a pre-V71 already-returned application is lazily linked on resubmit;
9. HTTP replay and internal replay add no rows; changed-payload reuse conflicts;
10. concurrent identical return/resubmit yields one complete set of evidence;
11. stale version and injected failure leave no partial legacy/workflow/notification rows;
12. missing or ambiguous officer recipient fails closed and rolls back;
13. runtime cannot bypass the command functions or tamper with linkage/evidence;
14. existing model rework, notification API and security tests remain green.

Use unique disposable subjects. Update cleanup in the correct dependency order and prove it leaves no WP2B linkage or command rows.

## Documentation and tracking

- Add `docs/snl/SNL_WP02B_MODEL_RETURN_WIRING.md` with the final transaction boundary, linkage, recipient rules, replay keys and named proof.
- Update `docs/snl/SNL_WP02B_RETURN_RESPONSE.md`, the WP2 dashboard/log, and BL-257 only for work actually completed.
- Keep 19B stage-forward acceptance/disposition closure explicit if deferred to a small follow-on 19B-2; do not falsely mark the full model journey complete.
- Add a backlog row only for a newly discovered concrete gap.

## Boundaries

- No registration journey (`RegistrationReviewService`).
- No new public controller/route, OpenAPI, BFF or UI.
- No supervisor queue, 60-day scheduler, cancellation/rejection normalization, email/SMS or demo seeds.
- No unrelated refactor and no resolution of BL-255/BL-256.
- No Word/PDF edits, push or PR.
- Leave untracked `docs/BEE_SNL_DEVELOPMENT_PLAN.docx` untouched.

## Required checks

- Focused V71 and model return/resubmit tests.
- `cd backend && mvn test`.
- `cd backend && mvn test -Dgroups=db -Dbee.test.excludedGroups=none`.
- `npx tsc --noEmit`.
- `npm run web:test`.
- `npm run build`.
- `git diff --check main..HEAD` after commit.
- `npm run local:down` before handback.
- Clean tracked tree; report the owner Word file separately.

## Handback

Run `/bee-handback`. Report the V71 objects, transaction and rollback design, exact model hooks, assignee rule, notification compatibility, replay/concurrency behaviour, named tests and counts, files, commit hash, deferrals and unchanged Word file.

