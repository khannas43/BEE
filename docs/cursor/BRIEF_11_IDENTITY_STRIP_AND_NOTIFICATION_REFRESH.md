# Brief 11 — One identity strip, and a calmer notification refresh (BL-089, WP10.1b follow-up)

Branch `cursor/identity-strip-and-refresh` (created and checked out for you by Claude, from `main`). Frontend only. Hand back with /bee-handback (it releases the folder and prints the report; you never push).

## Objective

Two small, behaviour-preserving cleanups in the portal's browser code.

**A. BL-089: one `IdentityStrip`.** `components/app/kit/IdentityStrip.tsx` is the kit component every newer runtime screen uses, but `components/app/lifecycle/ModelDashboard.tsx` (around line 118) and `components/app/lifecycle/NewModelApplication.tsx` (around line 769) each still define their own copy. Replace both copies with the kit component, so the wording lives in one place.

The copies differ from the kit one in ways the live checks rely on, so **nothing the checks look for may change**:

| Screen | Strip `data-testid` | Extra test id on the "Checking your sign-in…" line | Text class on the paragraphs |
| --- | --- | --- | --- |
| ModelDashboard | `model-applications-identity` | `model-applications-identity-loading` | `font-body-sm text-body-sm` |
| NewModelApplication | `model-draft-identity` | none | `font-body-sm` only (no `text-body-sm`) |

Give the kit component an **optional** `loadingTestId` prop (the other screens that use it pass nothing and render exactly as today). The `text-body-sm` class difference on NewModelApplication is accidental; use the kit's classes there (a one-class visual difference is acceptable; say so in the report).

**B. Calmer refresh of the notification bell and page** (a Claude review note on Brief 10, not a defect):
1. The bell (`components/app/notifications/NotificationBell.tsx`) and the Notifications page (`Notifications.tsx`) each call `useRevalidation()`, so on a page that shows both, the identity is re-read twice every 30 seconds. The bell must keep refreshing its count on focus, on becoming visible and every 30 seconds while visible, but it must **not** re-read the identity (the page already does, and the top bar's session badge does too). Do this with a small variant or option on the kit hook, or a bell-local timer; do not change what the other 11 screens do.
2. `markOne` and `markAll` on the page call both `refreshNotifications()` and `revalidation.refresh()`, which reads the list twice. The list key already includes the refresh epoch, so one call is enough. Keep the behaviour: after marking, the list and the bell update at once without a reload.

## Read first

- `components/app/kit/IdentityStrip.tsx`, `components/app/kit/useRuntimeRead.ts` (`useRevalidation`, `REVALIDATE_MS`), `components/app/SessionBadge.tsx` (`refreshIdentity`).
- `components/app/notifications/*`, `lib/client/notificationRefresh.ts`, and their tests in `components/app/__tests__/`.
- `docs/kit/UI_TESTS.md`.

## What to build

1. The kit `IdentityStrip` gains the optional `loadingTestId`; `ModelDashboard` and `NewModelApplication` use it and their local copies are deleted (and any imports they no longer need).
2. The bell's refresh no longer calls `refreshIdentity()`; the page's mark actions refresh once.
3. **Tests.** Vitest: the kit strip renders the loading test id only when given one; each of the two screens still shows its strip with the same `data-testid`s (signed in, loading, signed out); the bell does not re-read the identity on a tick but does re-read the count; marking one read causes exactly one more list read. Keep every existing test passing.

## Hard rules

- **No change in behaviour, copy or `data-testid`** except the single class noted above. Do not touch `lib/server/**`, `app/api/**`, `backend/**`, `docs/wp03/**` or `scripts/local/*`. No new dependencies.
- No `startTransition` inside an effect, no `eslint-disable`, no rule turned off (`npx eslint . --max-warnings 0` is a gate).
- If you find a real defect, do not fix it silently: report it.

## Evidence

- `npx eslint . --max-warnings 0` (zero), `npx tsc --noEmit`, `npm run web:test` (unchanged), `npm run web:test:ui` (the current total plus yours), `npm run build`.
- Start the runtime yourself (`npm run local:up`, `npm run local:seed`; if port 8090 is taken by something else on this machine, set `BEE_API_PORT=8091` for every command), run and report each total, then `npm run local:down`: `npm run local:read-ui`, `npm run local:model-drafts` (the draft form), `npm run local:inbox`, `npm run local:secretary-approval`.
- Say how many lines the two deletions removed and which class changed on NewModelApplication.

## Done when

Both local copies are gone, the kit strip serves all screens, the bell no longer re-reads the identity, marking reads the list once, lint is at zero, the web gates and the four live checks pass with unchanged totals, and `/bee-handback` has printed the report.
