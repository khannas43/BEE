# Brief 05 — One shared stage screen for the four officer screens (BL-110, BL-113, BL-114)

Branch `cursor/shared-stage-screen` (created and checked out for you by Claude, from `main`). Frontend only. Hand back with /bee-handback (it releases the folder and prints the report; you never push).

## Objective

Four officer screens were built one after another by copying the previous one, and they are now about 1,300 lines that mostly repeat:

| File | Lines | Stage |
| --- | ---: | --- |
| `components/app/iame/IameScrutiny.tsx` | ~310 | `iame_scrutiny` |
| `components/app/reviewer/ReviewerScrutiny.tsx` | ~300 | `bee_scrutiny` |
| `components/app/programme/ProgrammeRating.tsx` | ~290 | `rating` |
| `components/app/director/DirectorApproval.tsx` | ~430 | `director_review` and `secretary_approval` (one screen, the action follows the application's state) |

Each one has the same skeleton: a screen frame with the identity strip, a queue of applications (a `DataTable` with the same columns), an "Application and evidence" detail panel with a close link, the application's fields, its test reports, its history, **one primary command** (a note or a figure, a button, an input check, a success note), then the shared "Return to the applicant" and "Reject permanently" panels. Only the primary command and a few strings differ. Every new stage and every new action currently costs another 300-line copy.

**Build one shared component and move the four screens onto it.** Behaviour, test ids and every user-visible string must not change.

## Read first

- The four files above, `components/app/lifecycle/ReturnToApplicant.tsx`, `RejectApplication.tsx`, `ApplicationHistory.tsx`, `ApplicationDocuments.tsx`, and `components/app/kit/` (`CommandPanel`, `DataTable`, `StatePanels`, `useRuntimeRead`, `IdentityStrip`).
- `docs/kit/SCREEN_KIT.md` and `docs/kit/UI_TESTS.md` (how the Vitest runner works).
- **The live checks are the specification** of what must not change: `scripts/local/iame-recommendation-browser-check.cjs`, `reviewer-forward-…`, `rating-…`, `director-recommendation-…`, `secretary-approval-…`, `return-resubmit-…`, `reject-…`, `history-browser-check.cjs`. They find elements by `data-testid` and compare copy. Read them to see exactly which ids and strings each screen must keep.

## What to build

1. **`components/app/lifecycle/StageWorkScreen.tsx`** (new): the shared skeleton. It owns the identity strip, the queue (a `DataTable` over the list read, display only), the selection from `?id=`, the detail panel with its read states and close link, the application fields, the test reports, the history, the return and reject panels, and the "done" state that replaces the detail with a success note after a command. A screen supplies only what is specific to it. A suggested shape, to adapt as you find best:
   - `testIdPrefix` (for example `"iame"`: `iame-queue-table`, `iame-ref-…`, `iame-open-…`, `iame-detail`, `iame-detail-fields`, `iame-identity`, `iame-queue-loading`, …);
   - the route, the subtitle and the copy object (`listTitle`, `loading`, `empty`, …);
   - which detail rows to show (the Director and Programme screens add a Stage row and a rating block);
   - `renderPrimary(application, helpers)`: the stage's own command panel, given `helpers.finish(note)` to show its success note and `helpers.reload()`;
   - whether the return panel is offered (Programme does not return) and which test-id prefix the return and reject panels use (the shared Director and Secretary screen uses `director-…` for the director state and `secretary-…` for the secretary state, and the shared success note keeps `director-return-success` and `director-reject-success` for both; **keep exactly what the live checks expect**).
2. **Move the four screens onto it.** Each screen file keeps only its copy, its primary command (the form, the input check, its `useCommand`) and its success note. Target: each file well under half its current length. The Director and Secretary screen stays one screen with its two primary commands chosen by the application's state.
3. **Tests.** Add Vitest tests for `StageWorkScreen` with a fake `fetch` (use `components/app/kit/__tests__/deferredFetch.ts`): the loading, empty and failure states of the queue; selecting an application loads its detail; the primary command's success replaces the detail with its note; the return and reject panels appear (and the return panel does not when it is turned off); a sign-out or an unreadable application shows the standard states. The runner's `include` pattern in `vitest.config.ts` covers only `components/app/kit/__tests__/`; you may extend it to a new `components/app/lifecycle/__tests__/` folder (that tooling edit is yours to make).

## Hard rules

- **Every `data-testid` and every user-visible string stays identical.** Do not rename `director-*` ids used on the secretary state, do not "tidy" copy. Renaming them is a separate, later change (BL-113, BL-114) because it touches the live checks.
- **No change to** `lib/client/*`, `lib/server/**`, `app/api/**`, the backend, the contract, or the checks in `scripts/local/`. The two panels `ReturnToApplicant` and `RejectApplication` are already shared; you may adjust them only if the shared screen genuinely needs a prop, and then without changing a rendered id or string.
- Not in scope: `FinanceQueue.tsx` (an older screen with its own table and ids), `ModelDashboard.tsx` and `NewModelApplication.tsx`. Do not touch them.
- No new dependencies. No `eslint-disable`. A rule broken by the refactor is fixed, not silenced.
- If you find a real defect in a screen while moving it, **do not fix it silently**: keep the behaviour, add a failing-test marker or a comment, and report it so Claude decides.

## Evidence (this one needs the runtime)

- `npx tsc --noEmit`, `npx eslint` on every changed and new file, `npm run web:test` (167 at the time of writing, unchanged), `npm run web:test:ui` (25 plus yours), `npm run build`.
- **Before you start**, save the sorted list of every `data-testid` literal and template in the four files; **after**, show it is the same set (a short script or `grep -o` diff is fine; paste the result). Do the same for the strings in each `*_COPY` object.
- Start the runtime yourself (`npm run local:up`, then `npm run local:seed`), run each of these and report each total, then `npm run local:down` when you finish:
  `npm run local:iame-recommendation` (63 at the time of writing), `local:reviewer-forward` (61), `local:rating` (73), `local:director-recommendation` (65), `local:secretary-approval` (63), `local:return-resubmit` (105), `local:reject` (71), `local:history` (57).
  They must all pass with the same totals. Do **not** run `npm run local:check` (about 15 minutes); Claude runs the full gate at merge.
- Report the line counts before and after for the four files.

## Done when

The four screens run on `StageWorkScreen`, every id and string is unchanged (shown), all eight live checks pass with their totals, the web gates pass, and `/bee-handback` has been run. Mark BL-110 `done` in `docs/BACKLOG.md` only if the live checks passed; leave BL-113 and BL-114 `open` (they are about renaming, which this brief forbids) and add one line saying the ids are now defined in one place.
