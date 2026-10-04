# Current Cursor task

**Holder:** cursor (handed over 2026-10-04).

- **Brief:** [BRIEF_05_SHARED_STAGE_SCREEN.md](BRIEF_05_SHARED_STAGE_SCREEN.md)
- **Branch:** `cursor/shared-stage-screen`, already created and checked out by Claude from `main` (which includes the history work, PR #12).
- **Additions or overrides:** none. The brief and this file are the branch's first commit; `main` takes no direct commits.
- **Acceptance commands:** `npx tsc --noEmit`; `npx eslint` on changed files; `npm run web:test` (167, unchanged); `npm run web:test:ui` (25 plus yours); `npm run build`.
- **Live checks (you start and stop the runtime: `npm run local:up`, `npm run local:seed`, then `npm run local:down`):** `local:iame-recommendation` (63), `local:reviewer-forward` (61), `local:rating` (73), `local:director-recommendation` (65), `local:secretary-approval` (63), `local:return-resubmit` (105), `local:reject` (71), `local:history` (57). Do not run `local:check`; anything else goes under "Not run".

When finished, run `/bee-handback`.
