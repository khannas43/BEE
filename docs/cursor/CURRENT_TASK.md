# Current Cursor task

**Holder:** cursor (handed over 4 October 2026)

- **Brief:** `docs/cursor/BRIEF_02_TABLE_AND_TABS_KIT.md`
- **Branch:** `cursor/table-and-tabs-kit` (already created and checked out by Claude, from the integration tip)
- **Additions or overrides:** Work only in this folder. The React test runner now exists (`npm run web:test:ui`, Vitest; see `docs/kit/UI_TESTS.md`): test `DataTable` and `RecordTabs` behaviour there (paging, sort with `aria-sort`, filter, empty and no-match states, arrow/Home/End keys), plus node:test for any pure helpers. `web:test` is now 110 and `web:test:ui` 19 before your additions. Keep the dashboard's existing `data-testid` values and strings exactly (the live `local:read-ui` check depends on them). iCloud may create stray "name 2.ext" copies; do not commit them.
- **Acceptance commands:**
  1. `npx tsc --noEmit`
  2. `npx eslint` on every changed file
  3. `npm run web:test` and `npm run web:test:ui`
  4. `npm run build`
- **Live checks:** Not run by you. Do not start the runtime; list `local:read-ui` under "Not run". Claude runs it at merge, and BL-020 and BL-021 stay `open` with a note until then.
- **Finish with:** `/bee-handback`. Never push.
