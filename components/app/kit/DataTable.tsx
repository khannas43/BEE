"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  filterRows,
  paginate,
  sortRows,
  type SortDirection,
} from "@/components/app/kit/dataTableLogic";

export const DATA_TABLE_COPY = {
  filterLabel: "Filter rows",
  filterPlaceholder: "Type to filter…",
  empty: "No rows to show.",
  noMatch: "No rows match your filter.",
  prevPage: "Previous page",
  nextPage: "Next page",
  sortAscending: "Sort ascending",
  sortDescending: "Sort descending",
  clearSort: "Clear sort",
  rangeTemplate: (start: number, end: number, total: number) =>
    total === 0 ? "Showing 0 of 0" : `Showing ${start}–${end} of ${total}`,
  pageTemplate: (page: number, totalPages: number) => `Page ${page} of ${totalPages}`,
} as const;

export type DataTableColumn<TRow> = {
  key: string;
  header: string;
  sortValue?: (row: TRow) => string | number;
  filterText?: (row: TRow) => string;
  render: (row: TRow) => ReactNode;
};

export type DataTableProps<TRow> = {
  columns: DataTableColumn<TRow>[];
  rows: TRow[];
  rowKey: (row: TRow) => string;
  pageSize?: number;
  labels?: typeof DATA_TABLE_COPY;
  tableTestId?: string;
  filterTestId?: string;
  emptyTestId?: string;
  noMatchTestId?: string;
  rangeLiveTestId?: string;
  paginationTestId?: string;
};

type SortState = { columnKey: string; direction: SortDirection };

function rowFilterText<TRow>(columns: DataTableColumn<TRow>[], row: TRow): string {
  return columns
    .map((col) => {
      if (col.filterText) return col.filterText(row);
      if (col.sortValue) return String(col.sortValue(row));
      return "";
    })
    .join(" ");
}

function nextSortDirection(current: SortState | null, columnKey: string): SortDirection {
  if (!current || current.columnKey !== columnKey) return "asc";
  if (current.direction === "asc") return "desc";
  if (current.direction === "desc") return "none";
  return "asc";
}

function ariaSortFor(columnKey: string, sort: SortState | null): "ascending" | "descending" | "none" | undefined {
  if (!sort || sort.columnKey !== columnKey || sort.direction === "none") return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

export function DataTable<TRow>({
  columns,
  rows,
  rowKey,
  pageSize = 10,
  labels = DATA_TABLE_COPY,
  tableTestId,
  filterTestId,
  emptyTestId,
  noMatchTestId,
  rangeLiveTestId,
  paginationTestId,
}: DataTableProps<TRow>) {
  const [filterQuery, setFilterQuery] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);

  const filtered = useMemo(
    () => filterRows(rows, filterQuery, (row) => rowFilterText(columns, row)),
    [rows, filterQuery, columns],
  );

  const sorted = useMemo(() => {
    if (!sort || sort.direction === "none") return filtered;
    const col = columns.find((c) => c.key === sort.columnKey);
    if (!col?.sortValue) return filtered;
    return sortRows(filtered, sort.direction, col.sortValue);
  }, [filtered, sort, columns]);

  const paged = useMemo(() => paginate(sorted, page, pageSize), [sorted, page, pageSize]);

  const rangeText = labels.rangeTemplate(paged.start, paged.end, paged.total);
  const pageText = labels.pageTemplate(paged.page, paged.totalPages);

  function onSortClick(columnKey: string, sortable: boolean) {
    if (!sortable) return;
    setSort((prev) => {
      const direction = nextSortDirection(prev, columnKey);
      if (direction === "none") return null;
      return { columnKey, direction };
    });
    setPage(1);
  }

  function onFilterChange(value: string) {
    setFilterQuery(value);
    setPage(1);
  }

  if (rows.length === 0) {
    return (
      <p className="font-body-sm text-body-sm text-on-surface-variant" data-testid={emptyTestId}>
        {labels.empty}
      </p>
    );
  }

  return (
    <div className="space-y-space-sm">
      <label className="block font-label-sm text-label-sm text-on-surface-variant">
        {labels.filterLabel}
        <input
          type="search"
          value={filterQuery}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={labels.filterPlaceholder}
          className="mt-1 w-full max-w-md py-2 px-3 rounded-lg bg-surface-ground font-body-sm text-body-sm"
          data-testid={filterTestId}
        />
      </label>

      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid={rangeLiveTestId}>
        {rangeText}
      </div>

      {filtered.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant" data-testid={noMatchTestId}>
          {labels.noMatch}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto app-scroll">
            <table className="w-full text-left border-collapse" data-testid={tableTestId}>
              <thead>
                <tr className="border-b border-border-subtle">
                  {columns.map((col) => {
                    const sortable = Boolean(col.sortValue);
                    const ariaSort = sortable ? ariaSortFor(col.key, sort) : undefined;
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        aria-sort={ariaSort}
                        className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide py-2 pr-space-md whitespace-nowrap"
                      >
                        {sortable ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 uppercase tracking-wide text-inherit hover:text-on-surface"
                            onClick={() => onSortClick(col.key, sortable)}
                            aria-label={
                              ariaSort === "ascending"
                                ? labels.sortDescending
                                : ariaSort === "descending"
                                  ? labels.clearSort
                                  : labels.sortAscending
                            }
                          >
                            {col.header}
                          </button>
                        ) : (
                          col.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {paged.pageRows.map((row) => (
                  <tr key={rowKey(row)} className="border-b border-border-subtle/60 hover:bg-surface-container-low">
                    {columns.map((col) => (
                      <td key={col.key} className="py-2.5 pr-space-md font-body-sm text-body-sm text-on-surface whitespace-nowrap">
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            className="flex flex-wrap items-center gap-space-md font-label-sm text-label-sm text-on-surface-variant"
            data-testid={paginationTestId}
          >
            <span aria-hidden="true">{rangeText}</span>
            <span aria-hidden="true">{pageText}</span>
            <button
              type="button"
              className="text-primary hover:underline disabled:opacity-40 disabled:no-underline"
              disabled={paged.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {labels.prevPage}
            </button>
            <button
              type="button"
              className="text-primary hover:underline disabled:opacity-40 disabled:no-underline"
              disabled={paged.page >= paged.totalPages}
              onClick={() => setPage((p) => Math.min(paged.totalPages, p + 1))}
            >
              {labels.nextPage}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
