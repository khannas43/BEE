# Brief 06 — Neutral test ids for the shared Director and Secretary screen (BL-113, BL-114)

Branch `cursor/approval-test-ids` (created and checked out for you by Claude, from `main`). Hand back with /bee-handback (it releases the folder and prints the report; you never push).

## Objective

`components/app/director/DirectorApproval.tsx` is one screen that serves two roles: the Director (state `director_review`) and the Secretary (state `secretary_approval`). Its shared parts (queue, detail, identity strip, history, rating block) still use `director-*` test ids, and the Return and Reject panels use `director-*` or `secretary-*` depending on the state, with one shared success note each (`director-return-success`, `director-reject-success`) that the Secretary also sees. The names now mislead. Brief 05 centralised the shell ids in `StageWorkScreen`, so the rename is small.

**Rename the ids that are shared by both roles to `approval-*`, keep the ids that belong to one role, and update every live check that finds them.** No behaviour, copy or layout changes.

## The rule

| Id belongs to | New name | Examples |
| --- | --- | --- |
| Both roles (queue, detail, identity, history, rating block, close link, the "done" notes) | `approval-<same suffix>` | `director-queue-table` → `approval-queue-table`; `director-history-list` → `approval-history-list`; `director-ref-X` → `approval-ref-X` |
| The Return panel, for either role | `approval-return-<suffix>` | `director-return-run` and `secretary-return-run` → `approval-return-run`; `*-return-reason` → `approval-return-reason`; `director-return-success` → `approval-return-success` |
| The Reject panel, for either role | `approval-reject-<suffix>` | `director-reject-*` and `secretary-reject-*` → `approval-reject-*` (including `approval-reject-success`) |
| Only the Director's own action | unchanged | `director-recommend-*` |
| Only the Secretary's own action | unchanged | `secretary-approve-*` |

Not in scope: the IAME, Reviewer and Programme screens and their ids; the Finance queue; any copy, route, class name or behaviour.

## Read first

- `components/app/director/DirectorApproval.tsx`, `components/app/lifecycle/StageWorkScreen.tsx`, `ReturnToApplicant.tsx`, `RejectApplication.tsx` (they take a test-id prefix; the Director and Secretary screen picks it from the application's state today, and after this change passes one prefix for both).
- Every live check that finds these ids: `scripts/local/director-recommendation-browser-check.cjs`, `secretary-approval-browser-check.cjs`, `return-resubmit-browser-check.cjs`, `reject-browser-check.cjs`, `history-browser-check.cjs`, `inbox-browser-check.cjs`, and `contract-check.cjs` / `contract-coverage.cjs` if they mention a test id.
- `docs/kit/UI_TESTS.md` and the Vitest tests for `StageWorkScreen`.

## Hard rules

- **Do first**: write down the full list of `data-testid` values (literals and templates) on the Director and Secretary screen and the panels it uses, as they are on `main`. After the change, produce the **old → new table** for every id that changed and paste it in the report. Every id not in the table must be identical.
- Update the live checks in `scripts/local/` by the table only. Do **not** change what they assert, their totals or their structure; a check that needs more than a substitution is a sign the rename went too far, so stop and report.
- Do **not** touch `lib/**`, `app/api/**`, the backend, the contract, or `docs/wp07/*` (those are evidence of past work and keep the old names; the new names are recorded in the table below and in BL-113/BL-114).
- No new dependencies, no `eslint-disable`.

## Evidence

- `npx tsc --noEmit`, `npx eslint` on changed files, `npm run web:test` (167), `npm run web:test:ui` (all pass), `npm run build`.
- Start the runtime yourself (`npm run local:up`, `npm run local:seed`), run and report each total, then `npm run local:down`: `local:director-recommendation` (65), `local:secretary-approval` (63), `local:return-resubmit` (105), `local:reject` (71), `local:history` (57), `local:inbox` (58). The totals must not change. (If a total differs from these numbers because `main` has moved, say so and compare to a run on `main`.) Do **not** run `npm run local:check`; Claude runs the full gate at merge.
- Add the old → new table to `docs/kit/UI_TESTS.md` (a short section "Approval screen ids"), and in `docs/BACKLOG.md` mark BL-113 and BL-114 `done` only if all six live checks passed.

## Done when

The shared screen's ids follow the rule, the six live checks pass with unchanged totals, the table is in the report and in `docs/kit/UI_TESTS.md`, and `/bee-handback` has been run.
