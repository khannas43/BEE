# Brief 14 — Brand and agency registration: the review screens and the applicant's returned path (WP04.2b, frontend part 2)

Branch `cursor/registration-review-screens` (created and checked out for you by Claude, from `main` at `5e17731`, **after** WP04.2b-2 is merged). Frontend only. Hand back with /bee-handback (it releases the folder and prints the report; you never push).

## Objective

Give Programme and the Director the screens to work a registration request (recommend, return, approve, reject), and give the applicant the other half of a returned request (see the reason, edit, upload a better licence, resubmit) and the end states (registered, rejected). The server side exists and is tested (WP04.2b-2, contract 0.29.0); you build the screens on the routes that exist now.

Provisional local rules, not BEE rules. Say so on the screens.

## Read first

- `docs/wp04/WP04.2b-2_REVIEW.md` (what exists and the rules), `docs/wp04/WP04.2b_PLAN.md`, the registration entries in `docs/wp03/bee-local-api.openapi.json` (the new route `/api/runtime/registrations/{id}/transition`; schemas `RegistrationTransition`, `RegistrationTransitionReceipt`, `RegistrationTrailItem`, and `Registration` with `trail`, `registeredBrandId`, `registeredAuthorisationId`) and `lib/server/contracts/registrations.ts` (read only).
- Brief 13's screens in `components/app/registrations/*` and `lib/client/runtimeRegistrations.ts` (you extend them), `components/app/director/DirectorApproval.tsx` and `components/app/lifecycle/*` (the model for a decision panel with a reason), `components/app/kit/*`, `docs/kit/SCREEN_KIT.md`, `docs/kit/UI_TESTS.md`.

## The rules the server enforces (the screen only shows them)

| Who | State | Actions | Note |
| --- | --- | --- | --- |
| Programme | `programme_review` | `recommend`, `return` | `return` needs a reason (1 to 500 characters); `recommend` takes an optional note |
| Director | `director_approval` | `approve`, `return`, `reject` | `return` and `reject` need a reason; `approve` takes an optional note |
| Applicant (manufacturer or agency, own organisation) | `returned` | edit (PATCH), upload a licence, `resubmit` | `resubmit` takes no note; no second fee |

The approver is never the person who filed or recommended the request, and nobody reviews a request of their own organisation. **The screen must not decide that:** show the actions the role and state allow, and show Spring's refusal (`segregation_refused`, `role_not_permitted`, `version_conflict`, `brand_name_taken`, `authorisation_overlap`, `brand_not_permitted`, `document_required`, `validation_failed`, `not_found`) through the kit's standard failures with the contract's wording.

## What to build

1. **`lib/client/runtimeRegistrations.ts`**: add the `trail`, `registeredBrandId` and `registeredAuthorisationId` fields to the types, and the command `transitionRegistration(id, {action, version, note?})` (POST `/api/runtime/registrations/{id}/transition`, `Idempotency-Key`, the receipt type).
2. **A review queue** `/app/registrations/reviews` ("Registration reviews"): the list the API returns for the caller, with a state filter done on the screen (tabs: "Waiting for me", "Decided", "All"; "Waiting for me" is `programme_review` for Programme and `director_approval` for the Director; "Decided" is `approved`, `returned`, `rejected`). Columns: reference, kind, brand, applicant organisation, state in words, a link. Empty, loading, signed-out and refusal states through the kit. Menu entry "Registration reviews" for Programme and the Director only, registered the way Brief 13's entry is. **Lane exception:** you may add the needed rows to `lib/runtimeRoutes.ts` and extend `scripts/local/read-ui.test.mjs` only for those rows.
3. **The request screen for a reviewer** (extend `/app/registrations/request?id=`, one screen for all roles): the facts, the trade-licence card in read-only form (list the versions, download each), the trail (action in words, role, note, time), and a **decision panel** shown when the caller's role has actions in the request's state (see the table): the allowed buttons, one reason box shared by the actions (required for `return` and `reject`; the buttons that need a reason stay disabled until it has 1 to 500 characters), a confirmation line before approve and reject ("This registers the brand for <organisation>" or "This records the agency's authorisation"), the `version` sent, and the standard failure display. After a step: the receipt's new state in words and a link back to the queue.
4. **The applicant side** (same screen): when the state is `returned`, a banner with the latest `return` note from the trail ("Returned by Programme: <reason>"), the edit form (the brand name or the agency fields, as Brief 13's form, saved with the version), the licence upload (a new version), and a **Resubmit** button (action `resubmit`, the current `version`). When `approved`: "Registered" with the brand name (or the authorisation period) and the register entry id. When `rejected`: "Rejected" with the reason from the trail. Brief 13's draft and fee notes stay as they are.
5. **Tests (Vitest, `npm run web:test:ui`)** with the kit's fake `fetch`: the queue tabs and filter for each role; the menu entry hidden from other roles; the decision panel for Programme (recommend, return needs a reason), for the Director (approve, return, reject) and absent for other roles and states; the request body of each action (`action`, `version`, `note`); each documented refusal shows its wording; the returned banner with the reason, the edit form, the upload and Resubmit (body has no note); the approved and rejected notes; the trail hides nothing the API sends and invents nothing.

## Hard rules

- Test ids: reviewer side prefix `rev-` (`rev-queue`, `rev-tab-waiting`, `rev-tab-decided`, `rev-tab-all`, `rev-row-<reference>`, `rev-decision`, `rev-note`, `rev-recommend`, `rev-return`, `rev-approve`, `rev-reject`, `rev-confirm`, `rev-trail`, `rev-trail-<n>`, `rev-result`); applicant additions keep `reg-` (`reg-returned`, `reg-returned-reason`, `reg-resubmit`, `reg-registered`, `reg-rejected`). Put the full list in the report so Claude's live check can use it.
- Do not touch `backend/**`, `lib/server/**`, `app/api/**`, `docs/wp03/**`, `scripts/local/*` (except the `read-ui.test.mjs` rows above), migrations. No new dependencies, no `eslint-disable`, no rule turned off.
- No rule logic in the screen: which actions exist comes from a small table keyed by role and state (the table above); whether the caller may take them is Spring's answer. Never hide a refusal.
- If you find a real defect, do not fix it silently: report it.
- Not in this brief: BL-158 (a REG option on the fee-rule screen), paging or server-side filters (BL-172), notifications in the bell (BL-171), revocation (BL-170).

## Evidence

- `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npm run web:test`, `npm run web:test:ui` (current total plus yours), `npm run build`.
- Start the runtime yourself (`npm run local:up`, `npm run local:seed`; set `BEE_API_PORT=8091` for every command if 8090 is taken), run `npm run local:registrations` (178 checks, must stay 178/0), `npm run local:registration-review` (104 checks, must stay 104/0) and `npm run local:model-submit`, then `npm run local:down`. Do **not** run `npm run local:check`.
- Report the test-id list and the line count of each new or changed screen.

## Done when

Programme can recommend or return a request in review; the Director can approve, return or reject one waiting for approval; an applicant sees why a request was returned, fixes it and resubmits; the end states read clearly; lint is zero, the web gates and live checks pass, and `/bee-handback` has been run. Claude then writes the live screen check and marks WP04.2b-2's frontend part done.
