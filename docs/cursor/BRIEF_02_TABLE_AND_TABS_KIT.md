# Brief 02 — Table and tabs for the kit (BL-020, BL-021)

Branch `cursor/table-and-tabs-kit` (created and checked out for you by Claude). Frontend only. Hand back with /bee-handback (it releases the folder and prints the report; you never push).

## Objective

The matrix has 55 contextual tabs and many list screens. Today a screen renders its list with the prototype's `FakeTable` and has no tab component. Build two kit components, then prove them on the model dashboard.

## What to build (new files in `components/app/kit/`)

1. **`DataTable`**: a table over rows a screen already holds. Client-side paging, sorting by a column, and a text filter over the displayed rows. Props: columns (header, a `key`, optional `sortValue`, `render`), rows, a stable `rowKey`, page size, and test-id props so each screen keeps its ids. Accessible: a real `<table>` with `<th scope="col">`, `aria-sort` on the sorted header, keyboard-operable controls, a live region announcing the shown range. Empty and "no match" states.
2. **`RecordTabs`**: accessible tabs (`role="tablist"`, `tab`, `tabpanel`, arrow-key navigation, Home and End), with the active tab in the URL query (`?tab=`) so a tab can be linked and survives reload. It takes `tabs: {id, label, render}` and renders only the active panel. The caller reads the query (`useSearchParams`) and passes the current id; do not read it inside the kit (see `docs/kit/SCREEN_KIT.md`).

## Hard rule

Sorting, filtering and paging here are **display only, over what Spring already returned**. They never decide what a user may see. Do not add role or organisation logic. Server-side paging is a contract change and belongs to Claude (note it in the backlog, do not guess an API).

## Prove it

Use `DataTable` in `components/app/lifecycle/ModelDashboard.tsx` in place of `FakeTable`, keeping every `data-testid` (`model-app-ref-*`, `model-app-open-*`, `model-app-edit-*`) and the existing columns, copy and the Selected/View/Edit actions. Use `RecordTabs` in the dashboard's detail panel with two tabs: "Details" (today's `DescriptionList`) and "Documents" (a read-only list of the application's test-report versions through `listModelDocuments`, with the same download link as `DraftTestReports`). Read `components/app/kit/` and `docs/kit/SCREEN_KIT.md` first and follow the existing hook and panel conventions.

## Constraints

- Strings that a person reads go in one exported object per component so Hindi copy can be added later (BL-052); do not translate now.
- No new dependencies. No changes to `lib/client/*`, the BFF or the backend.
- Existing node:test suites must still pass.

## Evidence

`npx tsc --noEmit`, `npx eslint` on changed files, `npm run web:test`, `npm run build`. Unit tests for pure logic you extract (sort comparison, paging maths, filter). If the runtime is free, run `npm run local:read-ui` (26 checks expected, plus any you add) and report it; otherwise list it under "Not run". Add a short `docs/kit/` section describing both components and update `docs/BACKLOG.md` (BL-020 and BL-021: done only if the live check passed; add a row for server-side paging).
