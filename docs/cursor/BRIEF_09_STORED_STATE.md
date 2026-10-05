# Brief 09 — Read stored browser state the supported way (BL-141)

Branch `cursor/stored-state-hook` (created and checked out for you by Claude, from `main`). Frontend only. Hand back with /bee-handback (it releases the folder and prints the report; you never push).

## Objective

Brief 08 cleared the lint baseline, but six places satisfy the `react-hooks/set-state-in-effect` rule by wrapping the state change in `startTransition` **inside an effect**. That passes the rule without removing the pattern: the component renders its default first, an effect reads `localStorage`, and the state changes after mount. The supported way to read a value from outside React (here `localStorage`) is `useSyncExternalStore`, with a server snapshot for the server render.

| File | Reads | Key |
| --- | --- | --- |
| `components/app/RoleContext.tsx` | the preview role (development only) | `bee-role` |
| `components/i18n/LangProvider.tsx` | the language | `bee-lang` |
| `components/public/A11yProvider.tsx` | text size, contrast, readable font | `bee-a11y` |
| `components/app/LifecycleStore.tsx` | the prototype application store (a reducer, hydrated) | `bee-lifecycle-v1` |
| `components/app/QRStore.tsx` | the prototype QR batch store (a reducer, hydrated) | `bee-qr-v1` |
| `app/(public)/verify/page.tsx` | the lifecycle store's applications, read once | `bee-lifecycle-v1` |

**Replace the effect-and-`startTransition` reads with `useSyncExternalStore`, behind one small shared hook, and keep behaviour exactly as it is.** None of these is a runtime (Spring-backed) screen; they are prototype preferences and fixtures.

## Read first

- The six files above, and how each uses its `ready` flag (the stores hold their children back until they have read storage).
- `components/public/usePrefersReducedMotion.ts` (Brief 08 already used `useSyncExternalStore` there) for the style.
- `docs/kit/UI_TESTS.md` (how the Vitest runner works).

## What to build

1. **One shared hook** (suggested `lib/client/useStoredValue.ts`): reads a string from `localStorage` for a key with `useSyncExternalStore`, returns `null` on the server and when storage is missing or throws (private window, blocked storage), and re-reads on the `storage` event (another tab) and on a same-tab notification that the hook's own setter fires. Writing is a separate function that also notifies. Every storage access is inside `try/catch`, as it is today.
2. **Move the three simple providers** (`RoleContext`, `LangProvider`, `A11yProvider`) onto it. Derive the value during render from the stored string (validate it exactly as the effect does today: only `hi`/`en`, only a known role, merged over the defaults); keep the setters writing to storage as today.
3. **Move the two reducer stores and the verify page.** For `LifecycleStore` and `QRStore`, keep the reducer and the `HYDRATE` action's meaning, but get the persisted array from the shared hook instead of an effect (the first render on the client already has it; the server snapshot is the seed). For the verify page, derive the appliances during render from the stored value. Keep the `ready` semantics: children must not render with a different value before and after reading, so nothing flashes seed data first where it did not before.
4. **Tests.** Add Vitest tests for the hook (missing key, a stored value, storage that throws, a change from another tab via a `storage` event, the setter notifying in the same tab) and one small test per provider that puts a value in `localStorage` before rendering and checks the first rendered value and that an invalid stored value falls back to the default. Extend `vitest.config.ts` `include` only if you add a new test folder.

## Hard rules

- **No change in behaviour, copy, layout or `data-testid`.** The server render and the first client render must match (no React hydration warning); the stored value takes over as React supports for `useSyncExternalStore`. Check the browser console for hydration warnings on `/`, `/app`, `/verify` and one runtime screen while the runtime is up, and report what you saw.
- **No `startTransition` left for these reads, no `eslint-disable`, no rule turned off.** `npx eslint . --max-warnings 0` must stay at zero (it is a gate now).
- Do not touch `lib/server/**`, `app/api/**`, the backend, the contract, or `scripts/local/*`. No new dependencies.
- If you find a real defect, do not fix it silently: keep the behaviour, report it.

## Evidence

- `npx eslint . --max-warnings 0` (zero), `npx tsc --noEmit`, `npm run web:test` (191, unchanged), `npm run web:test:ui` (53, plus yours), `npm run build`.
- Start the runtime yourself (`npm run local:up`, `npm run local:seed`), run and report each total, then `npm run local:down`: `npm run local:read-ui` (26), `npm run local:inbox` (58), `npm run local:fee-rules` (80), `npm run local:history` (57). The totals must not change. Do **not** run `npm run local:check`; Claude runs the full gate at merge.
- Say which of the six files changed and how each now reads storage, one line each.

## Done when

None of the six uses `startTransition` to read storage, the shared hook and its tests exist, lint is at zero, the web gates and the four live checks pass with unchanged totals, no hydration warning appears, and `/bee-handback` has been run. Mark BL-141 `done` in `docs/BACKLOG.md`.
