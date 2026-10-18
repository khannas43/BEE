# Brief 19A — SNL WP02B policy and notification foundation

## Purpose

Implement the first independently reviewable slice of the Brief 19 umbrella: V70 policy data and a generic, replay-safe production in-portal notification foundation that can later serve both registration and model return/resubmit wiring.

Continue on `cursor/snl-wp02b-return-response-wiring`. Preserve the integration map already written at `docs/snl/SNL_WP02B_RETURN_RESPONSE.md`. Do **not** wire journey services in this slice.

## Governing requirements

- Accepted WP2A foundation: `docs/snl/SNL_WP02A_WORKFLOW_FOUNDATION.md` and V69.
- WP2B umbrella: `docs/cursor/BRIEF_19_SNL_WP02B_RETURN_RESPONSE_WIRING.md`.
- Manual §3.10 / Tables 2–3 (printed pp. 28–30).
- Provisional decisions A08 and A17 in `docs/BEE_DECISIONS.md`; BL-255 remains open.
- Existing production in-portal notification design in V39. V66 demo email/SMS is out of scope.

## Before coding

- Read `AGENTS.md` completely.
- Run `npm run local:reset` before starting the full local runtime because the retained demo database has an obsolete review-cycle V69 checksum. Do not use Flyway repair.
- Inspect V39 notification schema/functions, `NotificationRepository`, its API response contract/tests, cleanup functions, and V69 policy/calendar/security patterns.
- Confirm V70 is still the next migration. Do not edit V69.

## Scope

### 1. Persist provisional return-response policy

In V70, add one effective-dated policy version for returned-to-applicant responses:

- policy key: a stable documented key such as `snl_return_response`;
- calendar: `india_bee_default`;
- limit: **7 working days**;
- pause behaviour consistent with A17;
- effective date chosen from the portal’s existing epoch/convention;
- note explicitly saying **provisional A08 / BL-255; not confirmed by BEE**.

Use an idempotent migration insert that cannot silently replace a different existing definition. Keep the 7-day value exclusively in persisted policy data; do not add it as a Java constant.

Add repository/service operations that:

- select exactly one applicable version by policy key and an **Asia/Kolkata** anchor date;
- load its calendar and closures;
- calculate the due time through `WorkingDaySla`;
- fail clearly when there is no version or more than one applicable version.

### 2. Generalize production notifications safely

V39’s `notification.application_id` is tied to `model_application`. Extend the production notification storage so later slices can notify for either `model_application` or `registration_application` without breaking existing model notifications or the current `/api/notifications` response.

Required invariants:

- supported subject types are restricted to those two tables and subject existence is enforced;
- existing V39 rows remain readable and keep their identity/history;
- existing model triggers and notification tests remain green;
- registration-capable rows do not require a fake model application;
- the recipient must be an active account with an active, currently valid membership of the subject organisation;
- notification content is immutable except the existing one-time `read_at` transition;
- runtime cannot insert/update/delete notification rows directly;
- maintenance cleanup remains possible for registered disposable test subjects;
- no new applicant-visible notification kind is exposed through the API in this slice unless the current contract already permits it.

### 3. Replay-safe internal notification command

Add a narrowly scoped database command boundary for future workflow orchestration:

- accepts a supported subject, notification kind/text, deterministic command ID and actor/context fields needed for audit;
- fans out once to the eligible subject-organisation members;
- same command + same payload replays without duplicates and returns the original result/count;
- same command + changed subject, kind or message conflicts;
- concurrent identical commands produce one set of recipient rows;
- public execute is revoked, safe `search_path` is pinned, and only the required runtime execute is granted;
- arbitrary direct table writes remain refused.

Do not make a generic command capable of bypassing subject membership or sending demo email/SMS. If the existing `kind` constraint cannot safely represent the future officer-resubmission notification, document and implement the smallest production-safe extension; update the current API validator/contract only if necessary and then run all contract checks.

### 4. Internal Java boundary

Add small internal repository/value types for:

- policy selection and due-date calculation;
- replay-safe notification command invocation and result;
- no controller or new HTTP route.

The Java layer must not reproduce membership selection or the 7-day policy value.

## Required proof

Add focused unit/database tests proving:

1. V70 applies after the full V1–V69 chain and on an upgrade path;
2. the persisted A08 policy has the documented key, India calendar, seven-day limit and provisional note;
3. policy selection uses the Asia/Kolkata date at a UTC-midnight boundary;
4. due calculation respects weekends and a persisted closure;
5. existing V39 model notifications remain readable and the current API shape is unchanged;
6. a registration subject can receive production in-portal notification rows without a model row;
7. inactive/expired memberships and inactive accounts receive nothing;
8. identical replay and concurrent identical commands create one row per eligible recipient;
9. changed-payload replay conflicts;
10. runtime direct mutation and unsupported/missing subjects are refused;
11. notification text/identity remain immutable while the existing read transition still works;
12. model and registration disposable cleanup leaves no orphan notification/command evidence.

Use unique test subjects and do not alter shared demo rows.

## Documentation and plan

- Update `docs/snl/SNL_WP02B_RETURN_RESPONSE.md` with the final V70 objects, replay semantics and any justified deviation from the umbrella map.
- Update WP2 progress/checkmarks only for policy/notification foundation actually proven.
- Update BL-257 to say 19A is complete while 19B–19D remain.
- Add a backlog row only for a newly discovered concrete gap.

## Boundaries

- No `RegistrationReviewService`, `StageReturnService`, `ResubmitApplicationService` or other journey hook yet.
- No discrepancy/task/clock mutation beyond repository reads needed to calculate policy due dates.
- No controller, OpenAPI, BFF, UI, supervisor queue, scheduler, 60-day job, demo seed, email or SMS.
- No resolution of BL-255/BL-256.
- No Word/PDF edits and no push.
- Leave untracked `docs/BEE_SNL_DEVELOPMENT_PLAN.docx` untouched.

## Required checks

- Focused V70/policy/notification unit and database tests.
- `cd backend && mvn test`.
- `cd backend && mvn test -Dgroups=db -Dbee.test.excludedGroups=none`.
- `npx tsc --noEmit`.
- `npm run web:test`.
- `git diff --check main..HEAD` after commit.
- `npm run local:down` before handback.
- Clean tracked working tree; report the owner Word file separately.

## Handback

Run `/bee-handback`. Report V70 objects and compatibility changes, policy/due-date behaviour, notification command/security/replay behaviour, named tests and pass counts, exact changed files, commit hash, and the remaining 19B–19D work.
