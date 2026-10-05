# Brief 08 — Clean the whole-repository lint baseline (BL-035)

Branch `cursor/lint-baseline` (created and checked out for you by Claude, from `main`). Hand back with /bee-handback (it releases the folder and prints the report; you never push).

## Objective

`npx eslint .` reports **46 problems (26 errors, 20 warnings) in 26 files**. They hide any new finding, so every earlier brief had to say "no new lint, baseline unchanged". Take it to **zero errors and zero warnings**, without changing behaviour, so that Claude can then make lint a gate.

## The findings today

| File:line | Level | Rule | Message |
| --- | --- | --- | --- |
| `app/(public)/verify/page.tsx:61` | error | `react-hooks/set-state-in-effect` | Error: Calling setState synchronously within an effect can trigger cascading renders Effects are intended to s |
| `app/app/[module]/[screen]/page.tsx:17` | error | `@next/next/no-assign-module-variable` | Do not assign to the variable `module`. |
| `app/app/workflow/my-approvals/page.tsx:7` | error | `@next/next/no-assign-module-variable` | Do not assign to the variable `module`. |
| `app/layout.tsx:20` | warning | `@next/next/no-page-custom-font` | Custom fonts not added in `pages/_document.js` will only load for a single page. This is discouraged. |
| `app/layout.tsx:24` | warning | `@next/next/google-font-display` | Block is not recommended. |
| `app/layout.tsx:24` | warning | `@next/next/no-page-custom-font` | Custom fonts not added in `pages/_document.js` will only load for a single page. This is discouraged. |
| `components/app/AppScreen.tsx:18` | error | `react-hooks/static-components` | Error: Cannot create components during render Components created during render will reset their state each tim |
| `components/app/AppSidebar.tsx:30` | error | `react-hooks/set-state-in-effect` | Error: Calling setState synchronously within an effect can trigger cascading renders Effects are intended to s |
| `components/app/LifecycleStore.tsx:163` | error | `react-hooks/set-state-in-effect` | Error: Calling setState synchronously within an effect can trigger cascading renders Effects are intended to s |
| `components/app/QRStore.tsx:92` | error | `react-hooks/set-state-in-effect` | Error: Calling setState synchronously within an effect can trigger cascading renders Effects are intended to s |
| `components/app/RoleContext.tsx:43` | error | `react-hooks/set-state-in-effect` | Error: Calling setState synchronously within an effect can trigger cascading renders Effects are intended to s |
| `components/app/ScreenScaffold.tsx:135` | error | `react-hooks/immutability` | Error: Cannot reassign variable after render completes Reassigning `acc` after render has completed can cause  |
| `components/app/ScreenScaffold.tsx:204` | warning | `@typescript-eslint/no-unused-vars` | 'screen' is defined but never used. |
| `components/app/ScreenScaffold.tsx:328` | warning | `@typescript-eslint/no-unused-vars` | 'screen' is defined but never used. |
| `components/app/ScreenScaffold.tsx:439` | warning | `@typescript-eslint/no-unused-vars` | 'screen' is defined but never used. |
| `components/app/ScreenScaffold.tsx:500` | warning | `@typescript-eslint/no-unused-vars` | 'screen' is defined but never used. |
| `components/app/ScreenScaffold.tsx:524` | warning | `@typescript-eslint/no-unused-vars` | 'screen' is defined but never used. |
| `components/app/ScreenScaffold.tsx:554` | warning | `@typescript-eslint/no-unused-vars` | 'screen' is defined but never used. |
| `components/app/ai/AIScreens.tsx:6` | warning | `@typescript-eslint/no-unused-vars` | 'Stars' is defined but never used. |
| `components/app/ai/AIScreens.tsx:58` | error | `react-hooks/rules-of-hooks` | React Hook "useCase" cannot be called at the top level. React Hooks must be called in a React function compone |
| `components/app/ai/AIScreens.tsx:59` | error | `react-hooks/rules-of-hooks` | React Hook "useCase" cannot be called at the top level. React Hooks must be called in a React function compone |
| `components/app/ai/AIScreens.tsx:60` | error | `react-hooks/rules-of-hooks` | React Hook "useCase" cannot be called at the top level. React Hooks must be called in a React function compone |
| `components/app/ai/AIScreens.tsx:61` | error | `react-hooks/rules-of-hooks` | React Hook "useCase" cannot be called at the top level. React Hooks must be called in a React function compone |
| `components/app/ai/AIScreens.tsx:62` | error | `react-hooks/rules-of-hooks` | React Hook "useCase" cannot be called at the top level. React Hooks must be called in a React function compone |
| `components/app/ai/AIScreens.tsx:1007` | error | `react/no-unescaped-entities` | `'` can be escaped with `&apos;`, `&lsquo;`, `&#39;`, `&rsquo;`. |
| `components/app/blockchain/VerificationResult.tsx:7` | warning | `@typescript-eslint/no-unused-vars` | 'shortHash' is defined but never used. |
| `components/app/deepScreens.tsx:42` | error | `react/display-name` | Component definition is missing display name |
| `components/app/deepScreens.tsx:45` | error | `react/display-name` | Component definition is missing display name |
| `components/app/lifecycle/StageScreen.tsx:7` | warning | `@typescript-eslint/no-unused-vars` | 'OK' is defined but never used. |
| `components/app/lifecycle/StageScreen.tsx:11` | warning | `@typescript-eslint/no-unused-vars` | 'STAGE_META' is defined but never used. |
| `components/app/qr/QRBatchWorkspace.tsx:7` | warning | `@typescript-eslint/no-unused-vars` | 'BAD' is defined but never used. |
| `components/i18n/LangProvider.tsx:28` | error | `react-hooks/set-state-in-effect` | Error: Calling setState synchronously within an effect can trigger cascading renders Effects are intended to s |
| `components/public/A11yProvider.tsx:38` | error | `react-hooks/set-state-in-effect` | Error: Calling setState synchronously within an effect can trigger cascading renders Effects are intended to s |
| `components/public/GovSections.tsx:21` | error | `react-hooks/set-state-in-effect` | Error: Calling setState synchronously within an effect can trigger cascading renders Effects are intended to s |
| `components/public/Reveal.tsx:27` | error | `react-hooks/set-state-in-effect` | Error: Calling setState synchronously within an effect can trigger cascading renders Effects are intended to s |
| `components/ui/PseudoQR.tsx:20` | warning | `@typescript-eslint/no-unused-vars` | 'cell' is assigned a value but never used. |
| `lib/mock/lifecycle.ts:113` | warning | `@typescript-eslint/no-unused-vars` | '_category' is defined but never used. |
| `lib/screens.ts:42` | warning | `@typescript-eslint/no-unused-vars` | 'Cells' is defined but never used. |
| `scripts/local/patch-openapi-wp051c-review.cjs:2` | error | `@typescript-eslint/no-require-imports` | A `require()` style import is forbidden. |
| `scripts/local/patch-openapi-wp051c-review.cjs:3` | error | `@typescript-eslint/no-require-imports` | A `require()` style import is forbidden. |
| `scripts/local/patch-openapi-wp051c-review.cjs:4` | error | `@typescript-eslint/no-require-imports` | A `require()` style import is forbidden. |
| `scripts/local/patch-openapi-wp051c.cjs:2` | error | `@typescript-eslint/no-require-imports` | A `require()` style import is forbidden. |
| `scripts/local/patch-openapi-wp051c.cjs:3` | error | `@typescript-eslint/no-require-imports` | A `require()` style import is forbidden. |
| `scripts/local/patch-openapi-wp051c.cjs:15` | warning | `@typescript-eslint/no-unused-vars` | 'err' is assigned a value but never used. |
| `scripts/local/request-log.test.mjs:74` | warning | `@typescript-eslint/no-unused-vars` | 'calls' is assigned a value but never used. |
| `scripts/local/wiring-check.test.mjs:5` | warning | `@typescript-eslint/no-unused-vars` | 'statSync' is defined but never used. |

## How to fix them (and what is not allowed)

- **No `eslint-disable` comments, no rule turned off or downgraded** for application code. A rule that fires is fixed in the code.
- **Unused imports and variables** (the `no-unused-vars` warnings): delete them. If a variable is unused because the code is wrong, say so in the report instead of guessing.
- **`react-hooks/rules-of-hooks`** are real bugs (a hook called conditionally or after an early return). Restructure the component (move the hook above the return, or split the component) so the same behaviour holds on every render. Add or extend a Vitest test where the fix changes structure.
- **`react-hooks/set-state-in-effect`**: derive the value during render, or move the state change into the event handler or the data-loading callback that causes it. Keep the same visible behaviour and the same `data-testid`s. `NewModelApplication.tsx` is a runtime screen with live checks; handle it with care.
- **`@next/next/no-assign-module-variable`**: rename the variable called `module` (it is a screen's `module` prop in several places; rename the local binding, not the public prop name of shared components unless every caller moves with it).
- **`@next/next/no-page-custom-font` / `google-font-display`** in `app/layout.tsx`: use the framework's supported way to load the fonts (for example `next/font`) so the fonts and the look do not change. If that would change the look or needs a network at build time, stop and report instead.
- **`react/display-name`, `react/no-unescaped-entities`, `react-hooks/static-components`, `react-hooks/immutability`**: fix in the code.
- **`@typescript-eslint/no-require-imports` in `scripts/local/*.cjs`**: those are Node (CommonJS) scripts, so `require` is correct there. You MAY add **one** targeted override in the ESLint config for `scripts/**/*.cjs` (and the one-off `patch-openapi-*.cjs` scripts) that turns off **only** `@typescript-eslint/no-require-imports`, with a one-line comment saying why. Do not change any other rule or any other files' configuration.
- Do **not** change the behaviour, copy, layout or `data-testid`s of any screen. This is a refactor-only brief. No new dependencies.
- If a fix would change behaviour, or you find a real defect, do not fix it silently: leave the behaviour, report it.

## Evidence

- `npx eslint .` reports **0 problems**. Paste the output.
- `npx tsc --noEmit`, `npm run web:test` (183), `npm run web:test:ui` (47 plus yours), `npm run build`.
- Start the runtime yourself (`npm run local:up`, `npm run local:seed`), run and report each total, then `npm run local:down`. Run the live checks for every runtime screen you touched, and, if you touch any shared file (`ScreenScaffold.tsx`, `AppSidebar.tsx`, `AppScreen.tsx`, `deepScreens.tsx`, `app/layout.tsx`), run this representative set as well: `local:read-ui`, `local:inbox` (58), `local:fee-rules` (80), `local:rating-schemes` (78), `local:iame-recommendation` (63), `local:history` (57). For `NewModelApplication.tsx` run `local:model-drafts`, `local:model-submit` and `local:model-documents`. The totals must not change from `main`; if one differs, say so and compare with a run on `main`. Do **not** run `npm run local:check`; Claude runs the full gate at merge.
- List which files you changed and what each fix was, in one line each.

## Done when

`npx eslint .` is clean, the web gates and the live checks you ran pass with unchanged totals, nothing behavioural moved, and `/bee-handback` has been run. Mark BL-035 `done` in `docs/BACKLOG.md` only if eslint is at zero.
