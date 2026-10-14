# Brief 15 — The register: close or revoke a brand or an agency authorisation (WP04.2b-2b, frontend)

Branch `cursor/register-revocation-screen` (created and checked out for you by Claude, from `main` at `f9b8223`, **after** WP04.2b-2b is merged). Frontend only. Hand back with /bee-handback (it releases the folder and prints the report; you never push).

## Objective

Give Programme and the Director one screen for the register: see the registered brands and the agency authorisations, propose closing or revoking one (Programme), and decide, reject or withdraw the proposals (the Director decides; the proposer withdraws). The server side exists and is tested (WP04.2b-2b, contract 0.30.0); you build the screen on the routes that exist now.

Provisional local rules, not BEE rules. Say so on the screen.

## Read first

- `docs/wp04/WP04.2b-2b_REVOCATION.md` (what exists and the rules), the register-revocation entries in `docs/wp03/bee-local-api.openapi.json` (`/api/runtime/register-revocations` GET and POST, `/api/runtime/register-revocations/{id}/decision` POST; schemas `RegisterRevocations`, `RegisterRevocationProposal`, `RegisterRevocationCreate`, `RegisterRevocationDecision`, `RegisterBrandEntry`, `RegisterAuthorisationEntry`) and `lib/server/contracts/register-revocations.ts` (read only).
- `components/app/admin/BusinessSettings.tsx` and `components/app/admin/ProposalPanels.tsx` (the model for a screen that lists proposals and lets a second person decide), `components/app/registrations/RegistrationRequest.tsx` (the decision panel with a reason, Brief 14), `components/app/kit/*`, `docs/kit/SCREEN_KIT.md`, `docs/kit/UI_TESTS.md`.

## The rules the server enforces (the screen only shows them)

| Who | What |
| --- | --- |
| Programme (`canPropose` true) | proposes: revoke a brand; revoke an authorisation; close an authorisation on a date; may withdraw their own pending proposal |
| Director (`canDecide` true) | approves or rejects a pending proposal (a reason is required to reject); never one they proposed |
| Anyone else | the API answers 403 `role_not_permitted`: show it through the kit |

A brand can only be revoked (its authorisations go with it). A closing date is not before today, after the authorisation's start and before its end. Only active entries can be proposed; one open proposal per entry. **The screen must not decide any of this:** use `canPropose` and `canDecide` from the API to show the controls, and show Spring's refusals (`revocation_pending`, `target_not_active`, `closing_date_passed`, `segregation_refused`, `role_not_permitted`, `proposal_not_pending`, `validation_failed`, `not_found`) through the kit's standard failures with the contract's wording.

## What to build

1. **`lib/client/runtimeRegisterRevocations.ts`**: the read (`GET /api/runtime/register-revocations`) and the commands `proposeRevocation({targetKind, targetId, action, closeOn?, reason})` and `decideRevocation(id, {decision, note?})`, typed from the contract, in the style of the other runtime helpers. Writes carry an `Idempotency-Key`.
2. **A screen** `/app/registrations/register` ("Register"), component `components/app/registrations/RegisterRevocations.tsx` and a page under `app/app/registrations/register/`:
   - **Register** section: two tables, Brands (name, owner, status, source) and Agency authorisations (brand, agency, principal, from, to, status). Status in words. A "Propose…" button on each **active** row when `canPropose`; it opens an inline panel for that row: for a brand, "Revoke this brand (its authorisations will be revoked with it)"; for an authorisation, a choice of "Revoke" or "Close on a date" (date input, with the rule beside it), a required reason box (1 to 500 characters), Submit. After a proposal the screen reads again.
   - **Waiting for a decision** section: the pending proposals (what, action, close date, reason, who proposed, when). With `canDecide`: Approve, and Reject (disabled until a reason of 1 to 500 characters is typed, with the reason box explained); a confirmation line before approve ("This revokes the brand and its authorisations" / "This revokes the authorisation" / "This closes the authorisation on <date>"). With `canPropose`: Withdraw on a proposal marked `proposedByYou`. Do not hide Approve on a proposal the person proposed: show it and let Spring refuse it (`segregation_refused`), unless `proposedByYou` is true, in which case show "You proposed this; another person decides" instead of the buttons.
   - **History** section: the decided proposals (state in words, decided by, when, the note).
   - Empty, loading, signed-out and refusal states through the kit; the identity strip as on the other screens.
3. **Menu entry** "Register" (Hindi "रजिस्टर") for Programme and the Director only, registered the way Brief 14's entry is. **Lane exception:** you may add the needed row to `lib/runtimeRoutes.ts` and extend `scripts/local/read-ui.test.mjs` only for that row.
4. **Tests (Vitest, `npm run web:test:ui`)** with the kit's fake `fetch`: the tables and status words; a "Propose…" button only on active rows and only when `canPropose`; the proposal bodies (revoke a brand; revoke an authorisation; close with `closeOn`; `reason` required); the date rule text; Approve and Reject for the Director (reject disabled until a reason; bodies `{decision, note?}`); `proposedByYou` shows the message instead of the buttons; Withdraw for the proposer; each documented refusal shows its wording and `version`-style reload is not offered; the history list; the menu entry hidden from other roles.

## Hard rules

- Test ids use the prefix `rvk-`: `rvk-screen`, `rvk-identity`, `rvk-loading`, `rvk-error`, `rvk-provisional`, `rvk-brands`, `rvk-brand-<id>`, `rvk-auths`, `rvk-auth-<id>`, `rvk-propose-<id>`, `rvk-panel`, `rvk-action`, `rvk-close-on`, `rvk-reason`, `rvk-submit`, `rvk-propose-error`, `rvk-pending`, `rvk-pending-<id>`, `rvk-approve-<id>`, `rvk-reject-<id>`, `rvk-withdraw-<id>`, `rvk-note-<id>`, `rvk-confirm-<id>`, `rvk-yours-<id>`, `rvk-decide-error`, `rvk-history`, `rvk-history-<id>`. Put the full list in the report so Claude's live screen check can use it.
- Do not touch `backend/**`, `lib/server/**`, `app/api/**`, `docs/wp03/**`, `scripts/local/*` (except the `read-ui.test.mjs` row above), migrations. No new dependencies, no `eslint-disable`, no rule turned off.
- No rule logic in the screen beyond what the API sends (`canPropose`, `canDecide`, `proposedByYou`, the statuses). Show states and actions in words from small tables keyed by the contract's values.
- If you find a real defect, do not fix it silently: report it.
- Not in this brief: suspend or restore (BL-182), notifying the owner (BL-184), paging (BL-172).

## Evidence

- `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npm run web:test`, `npm run web:test:ui` (current total plus yours), `npm run build`.
- Start the runtime yourself (`npm run local:up`, `npm run local:seed`; set `BEE_API_PORT=8091` for every command if 8090 is taken), run `npm run local:register-revocation` (100 checks, must stay 100/0), `npm run local:registration-review` (122 checks, must stay 122/0) and `npm run local:registrations` (178/0), then `npm run local:down`. Do **not** run `npm run local:check`.
- Report the test-id list and the line count of each new or changed screen.

## Done when

Programme can propose a revocation or a closure from the register screen; the Director can approve or reject it; the proposer can withdraw; the history is visible; lint is zero, the web gates and live checks pass, and `/bee-handback` has been run. Claude then writes the live screen check and merges.
