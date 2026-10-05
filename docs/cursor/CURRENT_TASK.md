# Current Cursor task

**Holder:** cursor (handed over 2026-10-05).

- **Brief:** [BRIEF_08_LINT_BASELINE.md](BRIEF_08_LINT_BASELINE.md)
- **Branch:** `cursor/lint-baseline`, already created and checked out by Claude from `main` (PRs #21 to #26 included).
- **Additions or overrides:** none. The brief and this file are the branch's first commit; `main` takes no direct commits.
- **Acceptance commands:** `npx eslint .` (0 problems); `npx tsc --noEmit`; `npm run web:test` (183, unchanged); `npm run web:test:ui` (47, plus yours); `npm run build`.
- **Live checks (you start and stop the runtime: `npm run local:up`, `npm run local:seed`, then `npm run local:down`):** the ones the brief lists for the files you touch. Do not run `local:check`; anything else goes under "Not run".

When finished, run `/bee-handback`.
