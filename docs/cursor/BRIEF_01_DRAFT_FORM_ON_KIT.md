# Brief 01 — Draft form on the command kit (BL-082)

Branch `cursor/draft-form-on-kit` from the tip named in your worktree setup. Frontend only. Do not push.

## Objective

`components/app/lifecycle/NewModelApplication.tsx` still keeps its own state and idempotency handling for two commands: saving a draft and confirming a submit. Move both onto the kit so every command on the screen behaves the same: `useCommand` from `components/app/kit/CommandPanel.tsx` (one idempotency key per exact payload, one run at a time, keep the key only when the outcome is unknown, typed failure advice). Read `docs/kit/SCREEN_KIT.md` and `lib/client/runtimeHttp.ts` (`keepKeyAfter`, `commandAdvice`) first.

## What to do

1. **Save draft.** Replace the `idemGate` ref and the hand-rolled loading and error handling with `useCommand`. The `run` and `signature` functions must be stable (module level or `useCallback`). Keep the existing behaviour: the evidence fields, the efficiency parse that refuses a typo (`parseIseer`), the dirty tracking, create versus edit, and the reload of the persisted copy after a save.
2. **Submit confirm.** Replace the `submitIdem` ref and manual state with `useCommand`. The confirm card has two buttons (Cancel and Submit), so use the hook with the card's own buttons; `CommandPanel` is optional here. Keep the six-item evidence checklist and every message.
3. **Failures.** Show `failure.message` as today. For a `version_conflict`, offer the kit's "Reload the latest version" path (re-read the application) instead of leaving the user stuck. For `session`, show the sign-in link.
4. Delete the code the kit replaces. If the refactor removes the two `react-hooks/set-state-in-effect` errors that this file carries (BL-035), say so in the hand-back; do not add `eslint-disable`.

## Constraints

- Keep every `data-testid` and every user-visible string identical. The live checks `local:model-drafts` and `local:model-submit` find elements by them and compare copy.
- Do not change `lib/client/*` request or response shapes, the BFF, the contract or anything under `backend/`.
- No new dependencies.

## Evidence

- `npx tsc --noEmit`, `npx eslint components/app/lifecycle/NewModelApplication.tsx`, `npm run web:test`, `npm run build`.
- Add unit tests for any pure helper you extract (the existing node:test files in `scripts/local/` show the style; there is no React test runner yet, that is brief 03).
- If the runtime is free (see the agreement), run `npm run local:model-drafts` and `npm run local:model-submit` and report the totals. If not, list them under "Not run"; Claude runs them at merge. Do not claim the refactor is proven by unit tests alone.

## Done when

Behaviour and test ids are unchanged, both commands run on `useCommand`, the gates above pass, and `/bee-handback` has been run. Mark BL-082 `done` in `docs/BACKLOG.md` only if the live checks were run and passed; otherwise leave it `open` with a note.
