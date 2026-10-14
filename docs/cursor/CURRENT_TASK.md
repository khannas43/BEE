# Current Cursor task

**Holder:** cursor (handed over by Claude on 14 October 2026). Claude resets this file to its idle text when the task is merged.

- **Brief:** [BRIEF_12_BUSINESS_SETTINGS_SCREEN.md](BRIEF_12_BUSINESS_SETTINGS_SCREEN.md)
- **Branch:** `cursor/business-settings-screen`, created from `wp08-business-settings` (the WP08.1h backend, commit `b70745b`, gate 1549/0). The backend and the routes exist; build only the screen.
- **Project folder:** `~/Developer/BEE` (moved out of iCloud on 14 October 2026). Open this folder in Cursor, not the old `~/Documents/Projects/BEE`.
- **Additions or overrides:**
  - Settings use the `scheduled` array (all not-yet-started versions, earliest first), not a single `next`. Show the first one, or all of them if more than one.
  - A proposal carries `valueBefore` (the value in force the day before it starts): print `<label>: <valueBefore> → <value> from <date>`.
  - Value inputs: `decimals` 0 means whole numbers only (`inputMode="numeric"`, no decimal point); 2 means up to two decimals. Show `min`, `max`, `unit`, the `description`, and the `warning` (when not null) beside the form.
  - `defaultValue` applies while `inForceFrom` is null: label it "default, not a BEE rule".
  - Menu entry: add the one row to `lib/runtimeRoutes.ts` allowed by the brief (`navCapabilities: ["business_setting_manage"]`) and its row in `scripts/local/read-ui.test.mjs`; nothing else outside the lane.
- **Acceptance commands** (run in `~/Developer/BEE`):
  - `npx tsc --noEmit`
  - `npx eslint . --max-warnings 0` (zero)
  - `npm run web:test` (current total 215 plus none from you; it must not drop)
  - `npm run web:test:ui` (the current total plus your tests)
  - `npm run build`
- **Live checks:** you may start the runtime yourself (`npm run local:up`, `npm run local:seed`) and run `npm run local:fee-rules` (80) and `npm run local:rating-schemes` (78); their totals must not change. `npm run local:business-settings` (74 over two runs, API level) must pass too. Stop the runtime with `npm run local:down` before `/bee-handback`. Do **not** run `npm run local:check`: Claude runs the full gate at merge.
- **Not run (list in the hand-back):** `local:check`, and the screen's own live check (Claude writes it after the merge).
