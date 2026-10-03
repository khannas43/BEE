# Current Cursor task

**Holder:** cursor (handed over 3 October 2026)

- **Brief:** `docs/cursor/BRIEF_04_CHECK_TOOLING.md`
- **Branch:** `cursor/check-tooling` (already created and checked out by Claude)
- **Additions or overrides:** none. Work only in this folder. You own `scripts/local/check.sh`, `lib.sh` and `health.sh` for this task. The `web:test` count is now 110 (not 105), and `web:test:ui` (Vitest, 19 tests) exists; run both and expect them unchanged.
- **Acceptance commands:**
  1. `bash -n` on every shell file you change
  2. With the runtime stopped: `bash scripts/local/check.sh` gives one clear failure and exits early, in seconds
  3. Dead-pid lock removed with a message; live-pid lock still refused (show both outputs)
  4. `npm run local:up`, then a full `npm run local:check`: same pass and fail counts as before (422 passed, 0 failed at the time of writing) and the memory samples printed
  5. `npm run web:test`, `npm run web:test:ui`, `npx tsc --noEmit`
  6. `npm run local:down` when finished
- **Live checks:** yes. You start and stop the runtime yourself, and it must be stopped before hand-back.
- **Finish with:** `/bee-handback`. Never push.
