# Brief 07 — One shared proposal panel for the fee-rule and rating-scheme screens (BL-139, frontend part)

Branch `cursor/shared-proposal-panels` (created and checked out for you by Claude, from `main`). Frontend only. Hand back with /bee-handback (it releases the folder and prints the report; you never push).

## Objective

The Fee rules screen and the Rating schemes screen both show the same two lists, "Waiting for a second person" and "Recently decided", and both give a colleague's pending proposal an Approve and a Reject button and the proposer a Withdraw button. They were written one after the other by copying, so the same code exists twice:

| File | What repeats |
| --- | --- |
| `components/app/admin/FeeRules.tsx` | `ProposalList`, `ProposalItem`, `DecisionButtons` (three `useCommand`s, a note field, the "decided" notice above the lists) |
| `components/app/admin/RatingFormulas.tsx` | `ProposalList` (with the item inlined), `DecisionButtons`, the same notice |

**Extract one shared component and move both screens onto it.** Behaviour, test ids and every user-visible string must not change. A third kind of administered rule (standards, categories) is coming, and it should cost a few lines, not another 120.

## Read first

- The two files above, `components/app/admin/__tests__/FeeRules.test.tsx` and `RatingFormulas.test.tsx`, `lib/client/runtimeFeeRules.ts` and `lib/client/runtimeRatingSchemes.ts` (the commands `runDecideFeeRule`/`runDecideScheme` and their signatures), and `components/app/kit/CommandPanel.tsx`.
- **The live checks are the specification of what must not change:** `scripts/local/fee-rules-browser-check.cjs` (ids start `feerule-`, `feerules-`) and `scripts/local/rating-schemes-browser-check.cjs` (ids start `scheme-`, `schemes-`). Read how they find elements.

## What to build

1. **`components/app/admin/ProposalPanels.tsx`** (new): a generic `ProposalList` and `DecisionButtons`. They take what differs as props: the test-id prefixes (for example `{ list: "feerules-pending", item: "feerules", approve: "feerule-approve-run" ... }`, or a small `ids` object you design), the decide command and its signature, a `summary(proposal)` render function for the first line of an item, and the extra text after "Proposed by". They are generic over the proposal type (an `id`, `state`, `proposedByYou`, `proposedBy`, `decidedBy`, `decisionNote` at least).
2. **Move both screens onto it.** Each screen keeps its own table of rules or schemes, its own propose form and its copy; the lists and decision buttons come from the shared file. Target: each file shorter by about 100 lines.
3. **Tests.** Add Vitest tests for `ProposalPanels` (with a fake `fetch`, `components/app/kit/__tests__/deferredFetch.ts`): a colleague's proposal offers Approve and Reject but not Withdraw; your own offers only Withdraw; a decision success calls `onDone` with the proposal; a refusal shows the standard failure and offers a reload where the contract says so. Extend `vitest.config.ts` `include` only if you put tests in a new folder.

## Hard rules

- **Every `data-testid` and every visible string stays identical.** Before you start, save the sorted list of every `data-testid` literal and template in the two screen files; after, show the set across the two screens plus `ProposalPanels.tsx` is the same (paste the diff, which must be empty).
- No change to `lib/**`, `app/api/**`, the backend, the contract, `scripts/local/*` or the database. No new dependencies, no `eslint-disable`.
- If you find a real defect while moving the code, do not fix it silently: keep the behaviour, report it.

## Evidence

- `npx tsc --noEmit`, `npx eslint` on changed files, `npm run web:test` (183, unchanged), `npm run web:test:ui` (44, plus yours), `npm run build`.
- Start the runtime yourself (`npm run local:up`, `npm run local:seed`), run and report each total, then `npm run local:down`: `npm run local:fee-rules` (80) and `npm run local:rating-schemes` (78); they must not change. Do **not** run `npm run local:check`; Claude runs the full gate at merge.
- Report the line counts before and after for the two screens.

## Done when

Both screens run on `ProposalPanels`, the test-id diff is empty, both live checks pass with their totals, the web gates pass, and `/bee-handback` has been run. Mark the frontend part of BL-139 done in `docs/BACKLOG.md` (the backend part, a generic decision function, stays open).
