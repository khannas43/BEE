# Current Cursor task

**Holder:** cursor (handed over 2026-10-04).

- **Brief:** [BRIEF_06_APPROVAL_SCREEN_TEST_IDS.md](BRIEF_06_APPROVAL_SCREEN_TEST_IDS.md)
- **Branch:** `cursor/approval-test-ids`, already created and checked out by Claude from `main` (which includes the inbox, containers and workflow views, PRs #15 to #17).
- **Additions or overrides:** none. The brief and this file are the branch's first commit; `main` takes no direct commits.
- **Acceptance commands:** `npx tsc --noEmit`; `npx eslint` on changed files; `npm run web:test` (167, unchanged); `npm run web:test:ui` (all pass); `npm run build`.
- **Live checks (you start and stop the runtime: `npm run local:up`, `npm run local:seed`, then `npm run local:down`):** `local:director-recommendation` (65), `local:secretary-approval` (63), `local:return-resubmit` (105), `local:reject` (71), `local:history` (57), `local:inbox` (58). Do not run `local:check`; anything else goes under "Not run".

When finished, run `/bee-handback`.
