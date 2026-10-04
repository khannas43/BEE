/** Pure display logic for DataTable (sort, filter, paging). */

export type SortDirection = "asc" | "desc" | "none";

export function compareSortValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function filterRows<TRow>(rows: TRow[], query: string, textOf: (row: TRow) => string): TRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => textOf(row).toLowerCase().includes(q));
}

export function sortRows<TRow>(
  rows: TRow[],
  direction: SortDirection,
  sortValue: (row: TRow) => string | number | undefined,
): TRow[] {
  if (direction === "none") return rows;
  const sorted = [...rows].sort((a, b) => compareSortValues(sortValue(a) ?? "", sortValue(b) ?? ""));
  return direction === "desc" ? sorted.reverse() : sorted;
}

export type PaginateResult<TRow> = {
  pageRows: TRow[];
  totalPages: number;
  page: number;
  start: number;
  end: number;
  total: number;
};

export function paginate<TRow>(rows: TRow[], page: number, pageSize: number): PaginateResult<TRow> {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (clampedPage - 1) * pageSize + 1;
  const end = Math.min(clampedPage * pageSize, total);
  const pageRows = rows.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);
  return { pageRows, totalPages, page: clampedPage, start, end, total };
}
