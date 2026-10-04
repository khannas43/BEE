# Table and tabs kit components

**Status:** Added 4 October 2026 (Brief 02). Client-side display only over rows Spring already returned.

## DataTable

**File:** `components/app/kit/DataTable.tsx`  
**Logic:** `components/app/kit/dataTableLogic.ts` (tested in `scripts/local/data-table.test.mjs`)

Props: column definitions (`header`, `key`, optional `sortValue` / `filterText`, `render`), `rows`, `rowKey`, optional `pageSize`, optional test-id props, optional `labels` from exported `DATA_TABLE_COPY`.

Behaviour: text filter over displayed row text, column sort with `aria-sort` on `<th scope="col">`, paging with previous/next controls, a polite live region for the shown range, empty and no-match states. Sorting and filtering never change server scope.

## RecordTabs

**File:** `components/app/kit/RecordTabs.tsx`

Props: `tabs` (`id`, `label`, `render`), `activeTabId`, `onTabChange`, optional test-id helpers, optional `labels` from `RECORD_TABS_COPY`.

Accessible tablist (`role="tablist"`, `tab`, `tabpanel`), Arrow Left/Right and Home/End. **Does not read the URL** — the screen uses `useSearchParams`, passes the active tab id, and updates `?tab=` in `onTabChange` (see `ModelDashboard` detail panel).

## Proof screen

`ModelDashboard` uses `DataTable` for the application list (stable `model-app-ref-*`, `model-app-open-*`, `model-app-edit-*` ids) and `RecordTabs` for Details vs Documents on the detail panel.

Vitest: `components/app/kit/__tests__/DataTable.test.tsx`, `RecordTabs.test.tsx` via `npm run web:test:ui`.
