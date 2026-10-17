# Brief 18 — SNL WP02A common workflow foundation

## Purpose

Implement the first production-code slice of WP2: a reusable, persistence-backed foundation for workflow tasks, assignments, structured discrepancies and working-day SLA calculation. The foundation must be able to support both `registration_application` and `model_application` without changing either journey yet.

This slice creates the shared primitives and proof. It does **not** replace existing registration/model transitions, expose new browser APIs, or add screens.

## Governing requirements

1. `docs/snl/SNL_WP01_STATE_MODELS.md`
2. `docs/snl/SNL_WP01_ROLE_MATRIX.md`
3. `docs/snl/BEE_SNL_IMPLEMENTATION_PLAN.md` — WP2
4. *SnL Disha Advisory Manual*: §3.2–§3.4 (printed pp. 24–25) and §3.10 / Tables 2–3 (printed pp. 28–30)
5. Existing repository security, migration, append-only audit, idempotency and test conventions

Keep A08, A09 and A17 explicitly provisional. BL-255 and BL-256 are unresolved policy conflicts. Do not encode one irreversible interpretation of 7/12/15 days or cancel/reject semantics.

## Before coding

- Read `AGENTS.md` completely.
- Inspect the relevant existing migration, transaction, append-only event, assignment and cleanup-test patterns before designing the new tables.
- This slice must not touch Next.js code. If that boundary changes, first read the relevant guide under `node_modules/next/dist/docs/` as required by `AGENTS.md` and report why the scope changed.
- Confirm the next unused Flyway migration number; at branch preparation it is V69. Do not reuse a number if the repository has changed.

## Scope

### 1. Design record

Create `docs/snl/SNL_WP02A_WORKFLOW_FOUNDATION.md` documenting:

- how the shared records relate to current registration/model applications without replacing their state machines;
- table purpose, ownership, immutability and retention;
- task ownership, reassignment and optimistic concurrency rules;
- SLA start, pause, resume and due-date semantics;
- structured discrepancy → applicant response → reviewer disposition linkage;
- how notification outbox work will join the same transition transaction in a later WP2 slice;
- explicit deferrals: common transition APIs, UI, supervisor queue, live wiring, notifications and the 60-day job.

### 2. Database foundation

Add the next Flyway migration(s) for generic WP2 primitives. Use repository naming and privilege conventions. The design must cover:

- an effective-dated workflow/SLA policy record, with overlapping active versions prevented for the same policy key;
- a configurable working-day calendar and dated holiday/closure records;
- workflow task records with subject type/id, stage/action, owner role and optional owner account, status, due time, optimistic version and idempotency/command identity;
- immutable task/assignment events, including reassignment reason and actor;
- structured discrepancies with stable IDs and status;
- append-only applicant responses and reviewer dispositions linked to a discrepancy;
- SLA clock periods or equivalent immutable events sufficient to prove elapsed working time and applicant-wait pauses;
- indexes and constraints for one valid active task per applicable subject/stage/action and for replay safety;
- least-privilege grants matching existing `bee_runtime` and `bee_local_maint` patterns;
- append-only protection for event/evidence tables.

The schema must support at least `registration_application` and `model_application`. If a polymorphic subject cannot safely use database foreign keys, document and test the integrity mechanism chosen. Do not leave unrestricted arbitrary subject types.

Do not backfill existing applications or wire current transitions in this slice.

### 3. Working-day calculation

Add a small backend service/value layer that calculates due dates and elapsed working time using a named calendar and persisted closures. It must:

- use the project’s time-zone convention explicitly;
- exclude configured non-working weekdays and dated closures;
- support a clock paused while responsibility is with the applicant (A17);
- handle same-day, weekend/holiday boundary and year-boundary cases;
- accept policy values as data rather than hard-coding 7, 12, 15, 30 or 60 days;
- be deterministic under an injected clock/date/time input.

Keep it internal; no controller, OpenAPI or Next route in this slice.

### 4. Tests and evidence

Add focused tests proving:

- migrations succeed from an empty database and with the existing chain;
- invalid subject types and invalid state/value combinations fail;
- effective-dated policy overlap is refused;
- active-task uniqueness and command replay safety;
- event/evidence immutability under the runtime role;
- reassignment retains complete before/after evidence;
- discrepancy response and disposition cannot become orphaned or overwrite history;
- working-day due/elapsed calculations, including pauses and closures;
- both registration and model subject types are accepted by the foundation.

Update `docs/snl/BEE_SNL_IMPLEMENTATION_PLAN.md` truthfully: record WP2 as in progress and check only items actually completed. Add concrete new gaps to `docs/BACKLOG.md` using the next identifiers; do not renumber old entries.

## Boundaries

- No current registration/model state transition may change.
- No backfill, scheduled cancellation, common transition API, OpenAPI version change, BFF route, UI or demo-data change.
- No hard-coded resolution of A08/BL-255 or BL-256.
- No edit to A01–A20 except a broken citation.
- No `.docx` or PDF changes.
- No push.

## Required checks

- Focused backend unit and database/migration tests for the new foundation.
- Full backend test suite: `cd backend && mvn test`.
- `npx tsc --noEmit`.
- `npm run web:test`.
- `git diff --check main..HEAD` after the task commit.
- Clean working tree before handback.

If the local database/container runtime is unavailable, do not claim database proof. Report the exact missing check and keep the applicable plan item open.

## Handback

Run `/bee-handback`. Report:

1. migrations and schema objects created;
2. Java/service files and tests added;
3. security/immutability/idempotency proof;
4. checks with pass counts;
5. deferred WP2B wiring work and any new backlog IDs;
6. commit hash and exact changed files.
