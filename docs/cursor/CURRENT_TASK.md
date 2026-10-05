# Current Cursor task

**Holder:** cursor (handed over 2026-10-05).

- **Brief:** [BRIEF_07_SHARED_PROPOSAL_PANELS.md](BRIEF_07_SHARED_PROPOSAL_PANELS.md)
- **Branch:** `cursor/shared-proposal-panels`, already created and checked out by Claude from `main` (which includes fee-rule administration, tax, rating schemes and the permission-driven menu, PRs #21 to #24).
- **Additions or overrides:** none. The brief and this file are the branch's first commit; `main` takes no direct commits.
- **Acceptance commands:** `npx tsc --noEmit`; `npx eslint` on changed files; `npm run web:test` (183, unchanged); `npm run web:test:ui` (44, plus yours); `npm run build`.
- **Live checks (you start and stop the runtime: `npm run local:up`, `npm run local:seed`, then `npm run local:down`):** `npm run local:fee-rules` (80) and `npm run local:rating-schemes` (78). Do not run `local:check`; anything else goes under "Not run".

When finished, run `/bee-handback`.
