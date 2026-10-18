# Brief 19 — SNL WP02B return, applicant response and review-task wiring

## Purpose

Implement the first live integration slice on top of accepted WP2A. Wire the existing registration and model journeys to the common task, discrepancy and SLA-clock foundation for the owner’s highest-priority loop:

> BEE returns an application for additional documents → the manufacturer responds → BEE resumes review.

Work on `cursor/snl-wp02b-return-response-wiring`, based on `main` at the WP2A merge `80b1da7`. Use the next migration number after V69. Do not edit V69 after merge.

## Governing requirements

1. `docs/snl/SNL_WP01_STATE_MODELS.md`
2. `docs/snl/SNL_WP01_ROLE_MATRIX.md`
3. `docs/snl/BEE_SNL_IMPLEMENTATION_PLAN.md` — WP2
4. `docs/snl/SNL_WP02A_WORKFLOW_FOUNDATION.md`
5. `docs/BEE_DECISIONS.md` — A05, A08, A09 and A17 remain provisional
6. *SnL Disha Advisory Manual*: §3.2–§3.4 (printed pp. 24–25), §3.7–§3.8 (printed pp. 26–28), and §3.10 / Tables 2–3 (printed pp. 28–30)

Do not reinterpret unresolved 7/12/15-day rules. A08 currently uses **seven working days as the provisional discrepancy-response ceiling**, visibly labelled as provisional policy data. Do not collapse the manual’s distinct cancel/reject outcomes.

## Before coding

- Read `AGENTS.md` completely.
- The local application database still records a pre-acceptance V69 checksum from the review cycle. Before starting the full local runtime, run the repository's normal `npm run local:reset` to rebuild the disposable demo database from the merged migration chain. Do not use Flyway repair to bless the obsolete checksum. Disposable-schema database tests already pass against the merged V69.
- Inspect the existing registration return/resubmit implementation (V43–V45 and its Java/API tests), model return/resubmit implementation (V31 and current services), transaction-event/history patterns, notification table (V39), and WP2A command boundaries.
- Record a concise integration map in `docs/snl/SNL_WP02B_RETURN_RESPONSE.md` before changing behaviour: current command, current transaction owner, state before/after, common task action, clock event, discrepancy evidence and notification.
- Preserve current API contracts and response bodies unless the brief explicitly requires a new read operation.

## Scope

### 1. Policy data and deterministic due dates

- Add effective-dated policy data for the **returned-to-applicant discrepancy response** using the existing India calendar and provisional A08 seven-working-day limit.
- Store it as data, not Java constants. Label the source/note as provisional A08 / BL-255.
- Select the policy by **Asia/Kolkata** business date and calculate the immutable due time through `WorkingDaySla`.
- Do not invent SLA limits for internal officer stages; tasks without an approved/configured limit may remain non-SLA tasks.

### 2. Atomic workflow integration

Add a backend orchestration/service boundary that joins each existing business transition and its WP2 records in **one transaction**. Do not make controllers perform multi-step workflow writes.

For both `registration_application` and `model_application`:

- when an application first enters a supported officer-review stage, create or replay one common open review task with the actual owner role/account where the current journey has an assignee;
- on **return for additional information**, keep the review task open, open a structured discrepancy with a stable line code, start its SLA clock if needed and immediately pause it with responsibility assigned to the applicant;
- on **applicant resubmission**, append the next immutable discrepancy response, resume the same clock, and retain/re-establish the correct officer ownership for continued review;
- when the reviewer accepts the response through the next existing forward/recommend/approve action, append a reviewer disposition and close/complete the applicable discrepancy/task evidence consistently;
- if the reviewer needs more information again, support another response cycle rather than creating ambiguous duplicate discrepancies;
- a failure in any legacy state transition, task event, clock event, discrepancy record or notification must roll back the entire command.

Use deterministic command IDs derived from the existing request idempotency key plus transition purpose, or another collision-safe documented scheme. Same request/same payload must replay; changed payload with the same key must conflict.

### 3. Notification in the same transaction

- Write an in-portal notification for the applicant organisation when an application is returned, and an officer notification when the applicant resubmits.
- Reuse the production notification mechanism from V39, not the demonstration email/SMS table from V66.
- Notification insertion must be inseparable from the transition and WP2 evidence.
- Keep internal officer notes private. Applicant notification text may include only the return reason, required action, due date and application reference.
- Prevent duplicate notifications on replay.

### 4. Common read model (backend only)

Add an internal read service/repository projection sufficient for later API/UI work. For a subject it must return:

- current open task, owner role/account, stage/action and version;
- due time, clock state (`running`, `paused`, `stopped`), elapsed working time and whether overdue;
- open discrepancy, latest response sequence/status and applicant deadline;
- immutable task/discrepancy/clock evidence in chronological order.

This brief does **not** add a new OpenAPI operation, BFF route or screen. Prove the projection through backend tests.

### 5. Compatibility and existing data

- Existing applications created before this migration must keep working. Do not perform a speculative whole-database backfill.
- The first supported command on an older application may establish the missing common task/clock idempotently in the same transaction; document the rule.
- Preserve existing registration/model states, permissions, segregation checks, histories and API response shapes.
- Do not route unrelated fee, rating, Director, Secretary, rejection or certificate transitions through the common engine in this slice.

## Required proof

Add focused unit and database/service tests for both registration and model subjects proving:

1. officer review task creation uses the correct subject, stage, action and owner;
2. return creates one discrepancy, one paused clock and one applicant notification atomically;
3. resubmit creates the next response, resumes the clock and creates one officer notification atomically;
4. reviewer acceptance closes the response cycle and leaves consistent task/clock state;
5. at least three `needs_more` / response cycles remain possible;
6. applicant wait does not consume working SLA time, including a weekend/closure boundary;
7. A08’s seven days come from persisted provisional policy data, not a hard-coded service value;
8. replay produces no duplicate task, discrepancy, event or notification; changed payload conflicts;
9. injected failure at each write boundary rolls back the legacy state and all WP2/notification rows;
10. concurrent return or resubmit commands allow one valid result;
11. pre-migration applications can enter the wired loop without a bulk backfill;
12. existing registration/model contract and database suites remain green.

Name tests by behaviour and report them in the handback.

## Documentation and plan

- Add `docs/snl/SNL_WP02B_RETURN_RESPONSE.md` with the integration map, transaction boundary, replay scheme, policy selection, privacy rules and explicit deferrals.
- Update WP2 progress/checkmarks only for proven work.
- Update BL-257 truthfully; do not mark it done because supervisor UI, common public APIs and the 60-day job remain.
- Add a backlog item only for a newly discovered concrete gap.

## Boundaries

- No OpenAPI change, controller route, Next.js/BFF/UI, supervisor queue screen, escalation scheduler, 60-day cancellation job, demo seed or public-form work.
- No change to entity/category registration features reserved for WP3.
- No resolution of A08/BL-255 or cancel/reject BL-256 beyond persisted provisional policy.
- No Word/PDF edits and no push.
- `docs/BEE_SNL_DEVELOPMENT_PLAN.docx` is owner-controlled and untracked; leave it untouched.

## Required checks

- Focused unit/integration/database tests for this slice.
- `cd backend && mvn test`.
- `cd backend && mvn test -Dgroups=db -Dbee.test.excludedGroups=none`.
- `npx tsc --noEmit`.
- `npm run web:test`.
- `git diff --check main..HEAD` after commit.
- `npm run local:down` before handback.
- Clean tracked working tree; report the owner Word file separately.

## Handback

Run `/bee-handback`. Report the integration map, exact legacy transitions wired, migration/schema changes, Java transaction boundary, notification behaviour, read projection, named tests and pass counts, commit hash, changed files and every deferred WP2B item.
