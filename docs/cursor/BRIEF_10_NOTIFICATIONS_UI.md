# Brief 10 — The notification bell and the Notifications page (WP10.1b)

Branch `cursor/notifications-ui` (created and checked out for you by Claude, from `main`). Frontend only. Hand back with /bee-handback (it releases the folder and prints the report; you never push).

## Objective

WP10.1a (merged) added in-portal notifications on the server: the applicant's organisation is told when an application is **returned**, **rejected**, has its **fee due**, or is **approved**. The portal routes exist and are contract-tested. This brief builds what the applicant sees: **a bell with an unread count in the top bar** and **a Notifications page**. Owner's decision D10 ([../BEE_DECISIONS.md](../BEE_DECISIONS.md), [../wp10/WP10_PLAN.md](../wp10/WP10_PLAN.md)): in the portal only, provisional local rules, not BEE's.

## The routes you call (already built; do not change them)

All same-origin, session cookie only (`credentials: "include"`, `cache: "no-store"`), through the kit's `runtimeRead` / `runtimeHttp`:

| Call | Answer |
| --- | --- |
| `GET /api/runtime/notifications` | `{ unread: number, items: [{ id, kind, message, applicationId, reference, createdAt, read }] }`: the caller's own, newest first, at most 50. `kind` is `returned`, `rejected`, `fee_due` or `approved`. `unread` may exceed the unread items shown. |
| `POST /api/runtime/notifications/{id}/read` | `{ id, unread }`. Repeating it is harmless. An id that is not yours, unknown or malformed is `404 not_found`. |
| `POST /api/runtime/notifications/read-all` | `{ marked, unread }`. |

The two POSTs take **no `Idempotency-Key` and no body** (marking read never goes back; this is a recorded exception, see `docs/wp03/bee-local-api.openapi.json` `x-bee-idempotency.x-exceptions`). `runtimeCommand` adds a key, so add a small sibling in `lib/client/runtimeHttp.ts` (suggested `runtimeAction`, same failure handling, no key, no body) instead of bending `runtimeCommand`. Errors are the usual set: `401` (`no_session`, `session_expired`, `unauthenticated`), `403` (`mfa_required`, `no_active_account`, `no_effective_role`), `404` for one id, `502`, `503`.

## Read first

- `docs/wp03/bee-local-api.openapi.json`, the `runtimeNotifications*` operations; `lib/server/contracts/notifications.ts` (the shapes).
- `lib/client/runtimeHttp.ts`, `lib/client/runtimeFeeCorrections.ts` (a client module to copy the shape of), `components/app/kit/useRuntimeRead.ts`, `components/app/kit/StatePanels.tsx`.
- `components/app/AppTopbar.tsx`, `components/app/SessionBadge.tsx` (`useSpringIdentity`), `components/app/admin/FeeCorrections.tsx` (a screen on the kit), and how `finance/receipt` was added: `lib/screens.ts`, `components/app/deepScreens.tsx`, `lib/runtimeRoutes.ts` (`git log -S "finance/receipt"` shows the files touched).
- `modelDashboardHref` (`lib/client/runtimeModelApplications.ts`) and `modelDraftFormHref` (`lib/client/runtimeModelDrafts.ts`).
- `docs/kit/UI_TESTS.md`.

## What to build

0. **Housekeeping first, in its own commit.** Four stray macOS duplicate files are tracked: `components/app/admin/ProposalPanels 2.tsx`, `components/app/admin/__tests__/ProposalPanels.test 2.tsx`, `docs/cursor/BRIEF_06_APPROVAL_SCREEN_TEST_IDS 2.md`, `docs/cursor/BRIEF_07_SHARED_PROPOSAL_PANELS 2.md`. For each, run `diff` against the file without the " 2"; if byte-identical, `git rm` it; if any differs, **leave it and report the difference**.
1. **Client module** `lib/client/runtimeNotifications.ts`: `readNotifications()`, `markNotificationRead(id)`, `markAllNotificationsRead()`, the types, a strict parser for the list answer (reject anything else as an invalid response, like the other clients), and `notificationHref(item)`:
   - `returned` → `modelDraftFormHref(applicationId)` (edit and send again);
   - `approved` → `/app/model-label/label-preview?id=<applicationId>` (the printable certificate);
   - `fee_due`, `rejected` → `modelDashboardHref(applicationId)`.
2. **The bell** in `AppTopbar`: an icon button with an unread badge (hidden at 0, "9+" above 9), linking to the page. It appears **only for a signed-in Spring identity** (`useSpringIdentity`); it never appears for the development role preview or when signed out. It reads the count on mount, on window focus and when the tab becomes visible, and on a 30-second interval while visible (reuse the kit's revalidation timing; do not poll in the background). A failed read shows no badge and no error (the bell is a convenience; the page shows errors). Give it an `aria-label` that includes the count, for example "Notifications, 3 unread". It must not add a hydration warning.
3. **The page** at `/app/model-label/notifications` (module `model-label`, the applicant's module), menu entry "Notifications" (`hi`: "सूचनाएँ", icon `notifications`) for `manufacturer` and `agency`, registered like the other runtime screens (`RUNTIME_ROUTES` with `implemented` lines; the routes table in `read-ui.test.mjs` is updated when that list changes). On the kit (`ScreenChrome`, `IdentityStrip`, `ReadPanel`, states): a list, newest first, each entry showing the message, the application reference, a kind label ("Returned", "Rejected", "Fee due", "Approved"), the time, an unread dot, an **Open** link (`notificationHref`) and a **Mark read** button for an unread one; a **Mark all read** button when anything is unread; an empty state ("No notifications yet."); and a note that only the latest 50 are shown. Opening an entry through its link also marks it read (fire and forget; the page must not wait for it). After marking, the list and the bell update at once, without a full reload. Every control has a `data-testid`.
4. **Tests.** Vitest: the client (parser accepts the real shape, rejects extra fields and a bad kind; the three calls; `notificationHref` for the four kinds), the bell (hidden when signed out and for the preview role, badge text, "9+", aria-label, a failed read shows nothing), the page (list, empty, mark one, mark all, link targets, error states). Keep the existing totals; yours are added.

## Hard rules

- **Frontend only.** Do not touch `lib/server/**`, `app/api/**`, `backend/**`, `docs/wp03/**`, the contract pin or `scripts/local/*` other than the existing `read-ui` route lists that the route-table change requires. No new dependencies.
- Copy is in English, with Hindi only for the menu label, like the other runtime screens. No emoji. The notification **text comes from the server and is shown as plain text** (never as HTML).
- No `startTransition` inside an effect, no `eslint-disable`, no rule turned off (`npx eslint . --max-warnings 0` is a gate).
- Existing `data-testid`s and behaviour stay. If you find a real defect, do not fix it silently: report it.

## Evidence

- `npx eslint . --max-warnings 0` (zero), `npx tsc --noEmit`, `npm run web:test` (198, unchanged), `npm run web:test:ui` (77, plus yours), `npm run build`.
- Start the runtime yourself (`npm run local:up`, `npm run local:seed`; if port 8090 is taken by something else on this machine, set `BEE_API_PORT=8091` for every command), run and report each total, then `npm run local:down`: `npm run local:read-ui` (route and menu lists updated by you; report the new total), `npm run local:inbox`, `npm run local:secretary-approval` (127; it already proves the server side).
- A screenshot is not required; say what you checked by hand in a browser, if anything (the bell with a notification present: submit a draft as `nova.applicant`, which notifies "fee due").

## Done when

The bell and the page exist and behave as above, the four duplicate files are removed or reported, lint is at zero, the web gates and the live checks pass with the totals reported, no hydration warning appears, and `/bee-handback` has printed the report.
