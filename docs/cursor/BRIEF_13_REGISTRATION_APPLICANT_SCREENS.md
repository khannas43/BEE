# Brief 13 — Brand and agency registration: the applicant screens (WP04.2b, frontend part 1)

Branch `cursor/registration-applicant-screens` (created and checked out for you by Claude, from `main`, **after** WP04.2b-1 is merged). Frontend only. Hand back with /bee-handback (it releases the folder and prints the report; you never push).

## Objective

Give a manufacturer and an agency the screens to file a registration request, upload the trade licence, see the fee, submit, and follow the request until it is reviewed. The server side exists and is tested (WP04.2b-1); you build the screens on the routes that exist now. Review and approval (WP04.2b-2) and the reviewer screens (Brief 14) come later: here a request ends at "Fee confirmed, with Programme review".

Provisional local rules, not BEE rules. Say so on the screen wherever the fee or a licence is shown ("Local demo fee, not BEE-approved" comes from the API's `label`).

## Read first

- `docs/wp04/WP04.2b-1_REGISTRATION.md` (what exists and the rules), `docs/wp04/WP04.2b_PLAN.md`, the registration entries in `docs/wp03/bee-local-api.openapi.json` (paths `/api/runtime/registrations*`; schemas `Registration`, `RegistrationList`, `RegistrationCreate`, `RegistrationPatch`, `RegistrationSubmit`, `RegistrationSubmitPreview`, `RegistrationBrandList`, `RegistrationFeeReceipt`, `RegistrationDocument*`, `SubmissionFee`) and the exact types in `lib/server/contracts/registrations.ts` (read only).
- `components/app/lifecycle/NewModelApplication.tsx` and `DraftTestReports.tsx` (the model for the form, the licence upload and the submit review), `components/app/lifecycle/ApplicationDocuments.tsx`, `lib/client/runtimeModelDrafts.ts`, `runtimeModelSubmit.ts`, `runtimeModelDocuments.ts` (the models for the client helpers), `components/app/kit/*`, `docs/kit/SCREEN_KIT.md`, `docs/kit/UI_TESTS.md`.
- `components/app/kit/IdentityStrip.tsx` and how the model screens register in `lib/runtimeRoutes.ts` and the menu.

## What to build

1. **`lib/client/runtimeRegistrations.ts`**: the reads (list, one request, the brands an agency may choose, the submit preview, the documents list) and the commands (create, patch, submit, upload a licence, download), typed from the contract, in the style of the model helpers. Writes carry an `Idempotency-Key` and send the `version` the person saw.
2. **A list screen** `/app/registrations/requests` ("My registration requests"): reference, kind (Brand or Agency), brand, state in words, fee state, a link to the request, and a "New request" button. Empty, loading, signed-out and refusal states through the kit.
3. **A form** `/app/registrations/new`:
   - A manufacturer sees "Register a brand": one field, the brand name (1 to 120 letters, digits, space and `. & ' ( ) / _ -`; show the rule beside the field).
   - An agency sees "Ask to act for a brand": a choice from `eligible-brands` (name and owner), a start date (not before today) and an optional end date after the start.
   - Save as a draft; an unsaved change counts as dirty (as in `NewModelApplication`). Show `brand_name_taken`, `duplicate_registration`, `version_conflict`, `not_editable` and `validation_failed` through the kit's standard failures, with the contract's wording.
4. **A request screen** `/app/registrations/request?id=<id>` (use the same route style as the model detail): the facts, the state, the trade-licence card (upload a PDF, list the versions, download each; only while a draft), and for a draft the **submit review**: the gates from the preview (`trade_licence_uploaded`, `start_date_set`, `brand_active`, `brand_name_free`) each with met or unmet, the fee (amount, tax, total, the rule key and version, the "local demo fee" label), and a Submit button that sends the fee the person saw (`fee_preview_conflict` shows the standard refresh). After submit: "Fee due: INR <total>. Finance confirms it when it is received." After Finance confirms: "Fee confirmed. Waiting for Programme review." No review screens, no approval, no withdraw.
5. **Menu entry** "Registration requests" for manufacturer and agency, registered the way the model entries are. **Lane exception:** you may add the needed rows to `lib/runtimeRoutes.ts` and extend its unit test in `scripts/local/read-ui.test.mjs` only for those rows.
6. **Tests (Vitest, `npm run web:test:ui`)** with the kit's fake `fetch`: the list; the manufacturer form and the agency form (fields, rules, the brand choice); a save sends the version; `brand_name_taken` and `duplicate_registration` show their wording; the licence upload shows the card and refuses a non-PDF message from the API; the submit review shows each gate and the fee and disables Submit until every gate is met; submit sends the expected fee; `fee_preview_conflict` and `document_required` show the standard failure; the fee-due and fee-confirmed notes; the menu entry is hidden from other roles.

## Hard rules

- Test ids use the prefix `reg-` (list: `reg-list`, `reg-row-<reference>`, `reg-new`; form: `reg-form`, `reg-brand-name`, `reg-brand-choice`, `reg-valid-from`, `reg-valid-to`, `reg-save`; request: `reg-state`, `reg-licence-upload`, `reg-licence-version-<n>`, `reg-gate-<code>`, `reg-fee-total`, `reg-submit`); put the full list in the report so Claude's live check can use it.
- Do not touch `backend/**`, `lib/server/**`, `app/api/**`, `docs/wp03/**`, `scripts/local/*` (except the `read-ui.test.mjs` rows above), migrations. No new dependencies, no `eslint-disable`, no rule turned off.
- No fee, state or rule logic in the screen: everything comes from the API (the gate codes and their order, the fee view, the state). Show the state in words with a small table keyed by the contract's state values.
- If you find a real defect, do not fix it silently: report it.
- BL-158 (a REG option on the fee-rule screen) is **not** in this brief.

## Evidence

- `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npm run web:test`, `npm run web:test:ui` (current total plus yours), `npm run build`.
- Start the runtime yourself (`npm run local:up`, `npm run local:seed`; set `BEE_API_PORT=8091` for every command if 8090 is taken), run `npm run local:registrations` (its 178 checks must still pass) and `npm run local:model-submit`, then `npm run local:down`. Do **not** run `npm run local:check`.
- Report the test-id list and the line count of each new screen.

## Done when

A manufacturer can file a brand request, upload a licence, see the fee and submit; an agency can do the same for a brand; both see the state through to "Fee confirmed"; lint is zero, the web gates and live checks pass, and `/bee-handback` has been run. Claude then writes the live screen check and marks the frontend part of WP04.2b-1 done.
