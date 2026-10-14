# Brief 16 — Delegation: ask, approve, revoke, and "my delegations" (WP02.4c, frontend)

Branch `cursor/delegation-screen` (created and checked out for you by Claude, from `main` at `26aae74`, **after** WP02.4c is merged). Frontend only. Hand back with /bee-handback (it releases the folder and prints the report; you never push).

## Objective

Give officers one screen for delegation: a Programme, Director or Finance officer asks to hand their role to a colleague for a short period; the Administrator approves or rejects; the delegator withdraws a waiting request or revokes a delegation in force; the delegate sees what they hold for whom and until when. The server side exists and is tested (WP02.4c, contract 0.32.0); you build the screen on the routes that exist now.

Provisional local rules, not BEE rules. Say so on the screen.

## Read first

- `docs/wp02/WP02.4_DELEGATION.md` (what exists and the rules), the delegation entries in `docs/wp03/bee-local-api.openapi.json` (`/api/runtime/delegations` GET and POST, `/api/runtime/delegations/{id}/decision` POST; schemas `Delegations`, `Delegation`, `DelegationColleague`, `DelegationCreate`, `DelegationDecision`) and `lib/server/contracts/delegations.ts` (read only).
- `components/app/registrations/RegisterRevocations.tsx` and `lib/client/runtimeRegisterRevocations.ts` (the closest model: a screen that lists, proposes, and lets a second person decide, with the refusals shown through the kit), `components/app/admin/BusinessSettings.tsx`, `components/app/kit/*`, `docs/kit/SCREEN_KIT.md`, `docs/kit/UI_TESTS.md`.

## The rules the server enforces (the screen only shows them)

| Who | What |
| --- | --- |
| A holder of Programme, Director or Finance (`delegableRoles` is not empty) | asks to delegate one of those roles to a colleague (`colleagues` is the list the API allows) |
| The delegator | withdraws their request while it is `pending`; revokes it while it is `approved` |
| An approver (`canApprove` true: the Administrator) | approves or rejects (a reason is required to reject), revokes an approved delegation |
| The delegate | sees the delegation; cannot decide anything |

Rules the screen states but does not apply: the start is today or later; the end is after the start and at most 30 days later; the Secretary's final approval, administrative roles and registration review cannot be delegated; the approver is never the delegator or the delegate; a delegator who holds a second stage role cannot delegate. **The screen must not decide any of this:** show controls from `delegableRoles`, `colleagues`, `canApprove`, `asDelegator`, `asDelegate`, `state` and `inForce`, and show Spring's refusals (`delegate_not_eligible`, `delegation_exists`, `delegation_not_active`, `effective_date_passed`, `proposal_not_pending`, `segregation_refused`, `role_not_permitted`, `validation_failed`, `not_found`) through the kit's standard failures with the contract's wording.

## What to build

1. **`lib/client/runtimeDelegations.ts`**: the read (`GET /api/runtime/delegations`) and the commands `requestDelegation({delegateId, role, validFrom, validTo, reason})` and `decideDelegation(id, {decision, note?})`, typed from the contract, in the style of the other runtime helpers. Writes carry an `Idempotency-Key`.
2. **A screen** `/app/delegations` ("Delegations"), component `components/app/delegations/Delegations.tsx` and a page under `app/app/delegations/`:
   - **Ask to delegate** (only when `delegableRoles` is not empty): the role (a choice from `delegableRoles`), the colleague (a choice from `colleagues`, showing the name and their roles), the first day (a date, not before today), the last day shown as "Ends on" (the API's `validTo` is the first day it no longer applies; say so beside the field, for example "The delegation applies until the day before this date"), a required reason (1 to 500 characters), the rules in plain words, Submit. After a request the screen reads again and the form clears. When `delegableRoles` is empty, say why in one line ("You do not hold a role that can be delegated, or you hold more than one stage role").
   - **My delegations**: a table of `mine`: role, from, to, delegator, delegate, state in words (Waiting, In force or Approved, Rejected, Withdrawn, Revoked; use `inForce` to tell "In force" from "Approved, not in force today"), uses, and who decided. A mark for "You delegated this" or "Delegated to you". Controls: Withdraw on a pending one you asked for; Revoke (with an optional note) on an approved one when you are the delegator or `canApprove`.
   - **Waiting for approval** (only when `canApprove`): the `pending` list with the delegator, the delegate, the role, the dates and the reason; Approve; Reject (disabled until a reason of 1 to 500 characters is typed, with the reason box explained); a confirmation line before approve ("This lets <delegate> act as <role> from <date> until <date> for <delegator>").
   - **History** (only when `canApprove`): the `decided` list.
   - Empty, loading, signed-out and refusal states through the kit; the identity strip as on the other screens. A refusal that means the screen is out of date (`proposal_not_pending`, `delegation_not_active`, `not_found`, `effective_date_passed`) reads the screen again (as Brief 15 does).
3. **Menu entry** "Delegations" (Hindi "प्रत्यायोजन") for Programme, Director, Finance and Admin, registered the way Brief 15's entry is. **Lane exception:** you may add the needed row to `lib/runtimeRoutes.ts` and extend `scripts/local/read-ui.test.mjs` only for that row.
4. **Tests (Vitest, `npm run web:test:ui`)** with the kit's fake `fetch`: the request form shows only when `delegableRoles` is not empty and offers exactly the roles and colleagues the API sent; the request body (`delegateId`, `role`, `validFrom`, `validTo`, `reason`); the "Ends on" wording; Withdraw only for a pending delegation you asked for; Revoke for the delegator and for an approver on an approved one, not on others; Approve and Reject only for an approver on a pending one, Reject disabled until a reason; the bodies `{decision, note?}` (a note only with a rejection or a revoke); each documented refusal shows its wording and the out-of-date ones read the screen again; "In force" versus "Approved, not in force today"; the menu entry for the four roles and hidden from others.

## Hard rules

- Test ids use the prefix `del-`: `del-screen`, `del-identity`, `del-loading`, `del-error`, `del-provisional`, `del-form`, `del-role`, `del-colleague`, `del-from`, `del-to`, `del-to-help`, `del-reason`, `del-reason-help`, `del-rules`, `del-none`, `del-submit`, `del-request-error`, `del-mine`, `del-row-<id>`, `del-state-<id>`, `del-withdraw-<id>`, `del-revoke-<id>`, `del-revoke-note-<id>`, `del-pending`, `del-pending-<id>`, `del-approve-<id>`, `del-reject-<id>`, `del-note-<id>`, `del-confirm-<id>`, `del-decide-error`, `del-history`, `del-history-<id>`. Put the full list in the report so Claude's live screen check can use it.
- Do not touch `backend/**`, `lib/server/**`, `app/api/**`, `docs/wp03/**`, `scripts/local/*` (except the `read-ui.test.mjs` row above), migrations. No new dependencies, no `eslint-disable`, no rule turned off.
- No rule logic beyond what the API sends. Words for states and roles come from small tables keyed by the contract's values.
- When a command fails and the failure means "out of date", clear the old failure when the screen reads again (call the command's reset), so a stale message never sits beside fresh data (the Brief 15 review found this).
- If you find a real defect, do not fix it silently: report it.
- Not in this brief: notifications (BL-197), escalation, any change to what can be delegated.

## Evidence

- `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npm run web:test`, `npm run web:test:ui` (current total plus yours), `npm run build`.
- Start the runtime yourself (`npm run local:up`, `npm run local:seed`; set `BEE_API_PORT=8091` for every command if 8090 is taken), run `npm run local:delegation` (106 checks, must stay 106/0) and `npm run local:register-revocation` (100/0), then `npm run local:down`. Do **not** run `npm run local:check`.
- Report the test-id list and the line count of each new or changed screen.

## Done when

A Programme, Director or Finance officer can ask to delegate their role from the screen; the Administrator can approve or reject it; the delegator can withdraw or revoke; the delegate can see what they hold and until when; lint is zero, the web gates and live checks pass, and `/bee-handback` has been run. Claude then reviews, writes the live screen check and merges.
