# Brief 03 — A React test runner for the kit hooks (BL-027, BL-076)

Branch `cursor/react-test-runner`. Tooling and tests only. Do not push.

## Objective

The kit's hooks and panels (`useRuntimeRead`, `useRevalidation`, `useCommand`, `ReadPanel`, `CommandPanel`) have no unit tests because the repository has no React test runner. Today they are proven only by the live `local:read-ui` check. Add a runner and the tests.

## What to do

1. Add `vitest`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event` and `jsdom` as devDependencies (`npm i -D`), commit the lockfile, and confirm `npm ci` still works from a clean checkout.
2. A separate config (`vitest.config.ts`) with a jsdom environment and the `@/` alias to the repository root, mirroring `tsconfig.json`. Add the script `"web:test:ui": "vitest run"`. **Do not change `web:test`** (it is the node:test suite and `local:check` depends on it) and do not make `next build` or `tsc` pick up the new files in a way that breaks them; keep tests under `components/app/kit/__tests__/` or `scripts/ui/` and exclude them from the Next build if needed.
3. Tests, each driving the real component or hook with a fake `fetch`:
   - `useRuntimeRead`: returns null while loading; returns the read; **forgets a closed target's read and shows loading on reopen** (the BL-076 case); ignores a late response for a previous target; re-reads on a revalidation tick; `null` target reads nothing.
   - `useRevalidation`: focus and visibility ticks bump the epoch; a back-forward-cache restore bumps `restores`; the interval fires and is cleared on unmount (use fake timers).
   - `useCommand`: one run at a time; the same payload signature reuses the key after an unavailable outcome and after `idempotency_in_progress`; a success or a definite refusal starts the next send with a new key.
   - `ReadPanel`: loading, failure (each kind, including the sign-in link for a session failure), empty, result; the header action shows in every state and the result action only when loaded.
   - `CommandPanel`: busy label and disabled button, the failure line with `data-failure-kind` and `data-failure-code`, the reload button only for `version_conflict`, "Nothing was lost" only when retryable.
4. A short `docs/kit/` note on how to run and write these tests.

## Constraints

- No production code changes except what a test genuinely needs (a missing test id is fine; say so). If a test reveals a real defect in a kit component, do **not** fix it silently: write the failing test marked `it.fails` or skipped with a comment, and report it so Claude decides.
- No changes to the backend, the contract or `lib/server/**`.
- `package.json`: change only devDependencies and add the one script; leave `web:test` as is.

## Evidence

`npm ci` then `npm run web:test:ui` (report the totals), `npm run web:test` (unchanged count: 105 at the time of writing), `npx tsc --noEmit`, `npm run build`. Mark BL-027 and BL-076 `done` in `docs/BACKLOG.md` only if the corresponding tests pass without skips.
