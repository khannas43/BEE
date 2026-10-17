"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { filterRows, paginate, sortRows, type SortDirection } from "@/components/app/kit/dataTableLogic";
import { csvFileName, datedFileName, saveBytes, saveCsv, toCsv, type CsvCell } from "@/lib/client/csv";
import { buildXlsx, XLSX_TYPE } from "@/lib/client/xlsx";

/**
 * Search, an optional date range, sort on every column and paging for a list that is already loaded in the browser.
 * It only changes what is shown; it never asks the service for anything.
 */
export type ListToolsOptions<T> = {
  rows: T[];
  /** The text the search box looks in. */
  text: (row: T) => string;
  /** The date a row is filtered by (YYYY-MM-DD), when the list has one. */
  date?: (row: T) => string | undefined;
  /** What a column sorts by. */
  sortValue: (row: T, key: string) => string | number;
  pageSize?: number;
};

export function useListTools<T>({ rows, text, date, sortValue, pageSize = 10 }: ListToolsOptions<T>) {
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: SortDirection } | null>(null);
  const [page, setPage] = useState(1);
  const visible = useMemo(() => {
    const byText = filterRows(rows, query, text);
    const byDate = date && (from || to) ? byText.filter((r) => { const d = date(r) ?? ""; return d !== "" && (!from || d >= from) && (!to || d <= to); }) : byText;
    return sort && sort.dir !== "none" ? sortRows(byDate, sort.dir, (r) => sortValue(r, sort.key)) : byDate;
    // text, date and sortValue are re-created each render by the callers; the inputs that matter are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, from, to, sort]);
  const paged = paginate(visible, page, pageSize);
  return {
    query, from, to, sort, paged, visible, hasDate: Boolean(date), filtered: Boolean(query || from || to),
    setQuery: (v: string) => { setQuery(v); setPage(1); },
    setFrom: (v: string) => { setFrom(v); setPage(1); },
    setTo: (v: string) => { setTo(v); setPage(1); },
    clear: () => { setQuery(""); setFrom(""); setTo(""); setPage(1); },
    setPage,
    onSort: (key: string) => { setSort((p) => (!p || p.key !== key ? { key, dir: "asc" } : p.dir === "asc" ? { key, dir: "desc" } : null)); setPage(1); },
  };
}
/** What the toolbar, headers and pager need; any list's tools fit it. */
export type ListTools = {
  query: string; from: string; to: string; hasDate: boolean; filtered: boolean;
  sort: { key: string; dir: SortDirection } | null;
  paged: { page: number; totalPages: number; start: number; end: number; total: number };
  setQuery: (v: string) => void; setFrom: (v: string) => void; setTo: (v: string) => void; clear: () => void;
  setPage: (n: number) => void; onSort: (key: string) => void;
};

const field = "rounded-lg border border-outline-variant px-3 py-1.5 font-body-sm text-body-sm bg-surface-card";

/** What "Download CSV" saves: every row the filters leave (not only the page), under the given file name. */
export type CsvExport = { filename: string; header: string[]; rows: CsvCell[][] };

export function ListToolbar({ tools, placeholder = "Type to search", searchLabel = "Search", dateLabel = "Date", exportCsv }: { tools: ListTools; placeholder?: string; searchLabel?: string; dateLabel?: string; exportCsv?: CsvExport }) {
  return (
    <div className="flex flex-wrap items-end gap-space-md" data-testid="list-filters">
      <label className="flex flex-col font-label-sm text-label-sm text-on-surface-variant">{searchLabel}
        <input type="search" value={tools.query} onChange={(e) => tools.setQuery(e.target.value)} placeholder={placeholder} className={`${field} mt-1 w-64`} data-testid="list-search" />
      </label>
      {tools.hasDate ? (
        <>
          <label className="flex flex-col font-label-sm text-label-sm text-on-surface-variant">{dateLabel} from
            <input type="date" value={tools.from} max={tools.to || undefined} onChange={(e) => tools.setFrom(e.target.value)} className={`${field} mt-1`} data-testid="list-from" />
          </label>
          <label className="flex flex-col font-label-sm text-label-sm text-on-surface-variant">{dateLabel} to
            <input type="date" value={tools.to} min={tools.from || undefined} onChange={(e) => tools.setTo(e.target.value)} className={`${field} mt-1`} data-testid="list-to" />
          </label>
        </>
      ) : null}
      {tools.filtered ? <button type="button" className="font-label-md text-primary underline pb-2" onClick={tools.clear} data-testid="list-clear">Clear filters</button> : null}
      {exportCsv ? (
        <span className="ml-auto inline-flex flex-wrap gap-space-sm">
          <button type="button" disabled={exportCsv.rows.length === 0} onClick={() => saveCsv(csvFileName(exportCsv.filename), toCsv(exportCsv.header, exportCsv.rows))}
            className="inline-flex items-center gap-1 rounded-lg border border-outline-variant px-3 py-1.5 font-label-md text-primary disabled:opacity-40" data-testid="list-export">
            <Icon name="download" size={16} /> Download CSV
          </button>
          <button type="button" disabled={exportCsv.rows.length === 0} onClick={() => saveBytes(datedFileName(exportCsv.filename, "xlsx"), buildXlsx(exportCsv.filename, exportCsv.header, exportCsv.rows), XLSX_TYPE)}
            className="inline-flex items-center gap-1 rounded-lg border border-outline-variant px-3 py-1.5 font-label-md text-primary disabled:opacity-40" data-testid="list-export-xlsx">
            <Icon name="table_view" size={16} /> Download Excel
          </button>
        </span>
      ) : null}
    </div>
  );
}

export function SortableTh({ tools, k, children, className = "" }: { tools: ListTools; k: string; children: ReactNode; className?: string }) {
  const dir = tools.sort?.key === k ? tools.sort.dir : "none";
  return (
    <th scope="col" className={className} aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
      <button type="button" onClick={() => tools.onSort(k)} className="list-sort inline-flex items-center gap-1 uppercase tracking-wide text-inherit" data-testid={`list-sort-${k}`}>
        {children}
        <Icon name={dir === "asc" ? "arrow_upward" : dir === "desc" ? "arrow_downward" : "unfold_more"} size={14} />
      </button>
    </th>
  );
}

export function ListPager({ tools }: { tools: ListTools }) {
  const p = tools.paged;
  return (
    <nav className="flex flex-wrap items-center justify-between gap-space-sm pt-space-sm" aria-label="Pagination" data-testid="list-pagination">
      <span className="font-label-sm text-label-sm text-on-surface-variant" aria-live="polite">{p.total === 0 ? "Showing 0 of 0" : `Showing ${p.start}–${p.end} of ${p.total}`}</span>
      <span className="flex items-center gap-space-sm">
        <button type="button" disabled={p.page <= 1} onClick={() => tools.setPage(p.page - 1)} className="font-label-md text-primary disabled:opacity-40" data-testid="list-prev">Previous page</button>
        <span className="font-label-sm text-label-sm text-on-surface-variant">Page {p.page} of {p.totalPages}</span>
        <button type="button" disabled={p.page >= p.totalPages} onClick={() => tools.setPage(p.page + 1)} className="font-label-md text-primary disabled:opacity-40" data-testid="list-next">Next page</button>
      </span>
    </nav>
  );
}

/** The plain text of a rendered cell, for searching and sorting. */
export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(" ");
  if (typeof node === "object" && "props" in node) return nodeText((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

/** A number when the text is an amount such as "₹27,500.00" or "INR 11800", so amounts sort by value. */
export function sortableText(t: string): string | number {
  const m = t.trim().match(/^(?:₹|INR\s?)?\s*(-?[\d,]+(?:\.\d+)?)\s*(?:INR)?$/);
  if (m) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isNaN(n)) return n;
  }
  return t.toLowerCase();
}
