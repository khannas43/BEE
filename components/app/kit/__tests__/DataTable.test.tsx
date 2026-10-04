import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DataTable, type DataTableColumn } from "@/components/app/kit/DataTable";

type Row = { id: string; name: string; score: number };

const columns: DataTableColumn<Row>[] = [
  { key: "name", header: "Name", sortValue: (r) => r.name, render: (r) => r.name },
  { key: "score", header: "Score", sortValue: (r) => r.score, render: (r) => String(r.score) },
];

const rows: Row[] = [
  { id: "1", name: "Charlie", score: 30 },
  { id: "2", name: "Alpha", score: 10 },
  { id: "3", name: "Bravo", score: 20 },
];

function table(overrides?: { rows?: Row[]; pageSize?: number }) {
  cleanup();
  return render(
    <DataTable
      columns={columns}
      rows={overrides?.rows ?? rows}
      rowKey={(r) => r.id}
      pageSize={overrides?.pageSize ?? 2}
      tableTestId="dt-table"
      filterTestId="dt-filter"
      emptyTestId="dt-empty"
      noMatchTestId="dt-no-match"
      rangeLiveTestId="dt-range"
      paginationTestId="dt-pager"
    />,
  );
}

describe("DataTable", () => {
  it("shows empty state when there are no rows", () => {
    table({ rows: [] });
    expect(screen.getByTestId("dt-empty").textContent).toContain("No rows");
    expect(screen.queryByTestId("dt-table")).toBeNull();
  });

  it("filters rows and shows no-match when nothing matches", async () => {
    const user = userEvent.setup();
    table();
    await user.type(screen.getByTestId("dt-filter"), "zzz");
    expect(screen.getByTestId("dt-no-match")).toBeTruthy();
    expect(screen.queryByTestId("dt-table")).toBeNull();
  });

  it("pages rows and announces range in the live region", () => {
    table();
    expect(screen.getByTestId("dt-range").textContent).toBe("Showing 1–2 of 3");
    expect(within(screen.getByTestId("dt-table")).getAllByRole("row")).toHaveLength(3); // header + 2
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByTestId("dt-range").textContent).toBe("Showing 3–3 of 3");
  });

  it("sets aria-sort when a sortable header is clicked", async () => {
    const user = userEvent.setup();
    table({ pageSize: 10 });
    const nameHeader = screen.getByRole("columnheader", { name: "Name" });
    const nameSort = within(nameHeader).getByRole("button", { name: "Sort ascending" });
    expect(nameHeader.getAttribute("aria-sort")).toBe("none");
    await user.click(nameSort);
    expect(nameHeader.getAttribute("aria-sort")).toBe("ascending");
    await user.click(within(nameHeader).getByRole("button", { name: "Sort descending" }));
    expect(nameHeader.getAttribute("aria-sort")).toBe("descending");
  });
});
