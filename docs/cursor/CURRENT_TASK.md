# Current Cursor task

**Holder:** cursor (handed over 3 October 2026)

- **Brief:** `docs/cursor/BRIEF_03_REACT_TEST_RUNNER.md`
- **Branch:** `cursor/react-test-runner` (already created and checked out by Claude)
- **Additions or overrides:** none. Work only in this folder; no second clone or worktree. After `npm ci`, run `npm run setup:nosync`.
- **Acceptance commands** (run in order, report totals):
  1. `npm ci && npm run setup:nosync`
  2. `npm run web:test:ui` (all new tests pass; any real kit defect goes in as `it.fails` and is reported)
  3. `npm run web:test` (unchanged: 105 passing)
  4. `npx tsc --noEmit`
  5. `npm run build`
- **Live checks:** none. Do not start the runtime; list any `local:*` check under "Not run".
- **Finish with:** `/bee-handback`. Never push.
