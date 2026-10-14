# Brief 12 — The Business settings screen (WP08.1h, frontend part)

Branch `cursor/business-settings-screen` (created and checked out for you by Claude, from `main`, **after** the WP08.1h backend is merged). Frontend only. Hand back with /bee-handback (it releases the folder and prints the report; you never push).

## Objective

Give the Business Administrator a screen to see and change the business numbers BEE has not decided (maximum efficiency figure, maximum test-report age, payment tolerance, efficiency verification tolerance, certificate validity). Changes are proposals approved by a second person, exactly like the Fee rules and Rating schemes screens. The screen is generic: it renders whatever definitions the API returns, so a sixth setting needs no frontend change.

## Read first

- `docs/wp08/WP08.1h_BUSINESS_SETTINGS.md` (the rules and what was built), the contract entries for `/api/runtime/business-settings*` in `docs/wp03/bee-local-api.openapi.json` (schemas `BusinessSettingsAdmin`, `BusinessSetting`, `BusinessSettingProposal`, `BusinessSettingProposalRequest`, `BusinessSettingDecisionRequest`), and the exact types in `lib/server/contracts/business-settings.ts` (read only; copy the shapes into your client helper). The routes are `GET /api/runtime/business-settings`, `POST /api/runtime/business-settings/proposals` (body `settingKey`, `value`, `effectiveFrom`, `sourceReference`, `reason`; `Idempotency-Key` header; 201) and `POST /api/runtime/business-settings/proposals/{id}/decision` (body `decision`, optional `note`; 200).
- `components/app/admin/FeeRules.tsx` and `RatingFormulas.tsx` (the model for the page), `components/app/admin/ProposalPanels.tsx` (use it for the pending and decided lists and the decision buttons; do not copy it), `lib/client/runtimeFeeRules.ts` (the model for the client helper), `components/app/kit/*`, `docs/kit/SCREEN_KIT.md`, `docs/kit/UI_TESTS.md`.
- The menu code that follows a permission (WP08.1d) and how the Fee rules entry is registered.

## What to build

1. **`lib/client/runtimeBusinessSettings.ts`**: the read and the two commands (propose, decide), typed from the contract, in the style of `runtimeFeeRules.ts`.
2. **`components/app/admin/BusinessSettings.tsx`** and the page `app/app/administration/business-settings/page.tsx`:
   - A table, one row per definition: label, unit, **value in force** (with "default, not a BEE rule" when no version exists), scheduled (not yet started) values and dates (`scheduled`, earliest first), and a "Propose a change" button.
   - A propose form (use the kit command panel): value (input type and min/max taken from the definition, shown beside the field), start date (today or later, default tomorrow), source, reason. Show the definition's owner-assumption note above the form. Show the warning text from the definition when it has one (for example that saved drafts may become unsubmittable).
   - "Waiting for a second person" and "Recently decided" from `ProposalPanels`, with the `summary` function printing `<label>: <old value> → <new value> from <date>`.
   - Every standard failure and refusal through the kit (loading, empty, signed-out, 403 `role_not_permitted`, 409 `segregation_refused` / `rule_conflict`, 422 `effective_date_passed`).
3. **Menu entry** "Business settings" for holders of the permission `business_setting_manage`, registered the way the Fee rules entry is. **Lane exception:** you may add that one row to `lib/runtimeRoutes.ts` (`href` `/app/administration/business-settings`, `navRoles: []`, `navCapabilities: ["business_setting_manage"]`) and extend its unit test in `scripts/local/read-ui.test.mjs` only for that row. Hindi/English labels follow how neighbouring admin screens handle copy today (do not invent a new mechanism).
4. **Tests (Vitest, `npm run web:test:ui`)** with the kit's fake `fetch`: renders each definition with its value; shows the default label when no version exists; the form uses the definition's min and max; a colleague's proposal offers Approve and Reject but not Withdraw, your own only Withdraw; a refusal shows the standard failure; the screen is hidden from a user without the permission.

## Hard rules

- Test ids use the prefix `bizsettings-` (list), `bizsetting-` (row, form, buttons); put the full list in the report so Claude's live check can use it.
- Do not touch `backend/**`, `lib/server/**`, `app/api/**`, `docs/wp03/**`, `scripts/local/*` (except the one `read-ui.test.mjs` row above), migrations. No new dependencies, no `eslint-disable`, no rule turned off.
- No setting-specific logic in the screen: everything comes from the definition (key, label, unit, type, min, max, default, note, warning).
- If you find a real defect, do not fix it silently: report it.

## Evidence

- `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npm run web:test`, `npm run web:test:ui` (current total plus yours), `npm run build`.
- Start the runtime yourself (`npm run local:up`, `npm run local:seed`; set `BEE_API_PORT=8091` for every command if 8090 is taken), run `npm run local:fee-rules` and `npm run local:rating-schemes` (their totals must not change) and `npm run local:business-settings` if Claude's live check is present, then `npm run local:down`. Do **not** run `npm run local:check`.
- Report the test-id list and the line count of the new screen.

## Done when

The screen lists every definition, proposes and decides through the shared panels, the menu entry follows the permission, lint is zero, the web gates and live checks pass, and `/bee-handback` has been run. Claude then marks the frontend part of WP08.1h done.
