# Current Cursor task

**Holder:** cursor (handed over 2026-10-05).

- **Brief:** [BRIEF_09_STORED_STATE.md](BRIEF_09_STORED_STATE.md)
- **Branch:** `cursor/stored-state-hook`, already created and checked out by Claude from `main` (PRs #21 to #29 included).
- **Additions or overrides:** none. The brief and this file are the branch's first commit; `main` takes no direct commits.
- **Acceptance commands:** `npx eslint . --max-warnings 0` (zero); `npx tsc --noEmit`; `npm run web:test` (191, unchanged); `npm run web:test:ui` (53, plus yours); `npm run build`.
- **Live checks (you start and stop the runtime: `npm run local:up`, `npm run local:seed`, then `npm run local:down`):** `local:read-ui` (26), `local:inbox` (58), `local:fee-rules` (80), `local:history` (57). Do not run `local:check`; anything else goes under "Not run".

When finished, run `/bee-handback`.
