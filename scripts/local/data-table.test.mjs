// DataTable pure logic (components/app/kit/dataTableLogic.ts). Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareSortValues,
  filterRows,
  paginate,
  sortRows,
} from "../../components/app/kit/dataTableLogic.ts";

test("compareSortValues orders numbers and strings", () => {
  assert.equal(compareSortValues(1, 2), -1);
  assert.equal(compareSortValues("b", "a"), 1);
  assert.equal(compareSortValues("item-2", "item-10"), -1);
});

test("filterRows matches case-insensitively and ignores blank query", () => {
  const rows = [{ name: "Alpha" }, { name: "Beta" }];
  assert.deepEqual(filterRows(rows, "", (r) => r.name), rows);
  assert.deepEqual(filterRows(rows, "  alpha ", (r) => r.name), [{ name: "Alpha" }]);
});

test("sortRows respects direction and none", () => {
  const rows = [{ n: 3 }, { n: 1 }, { n: 2 }];
  assert.deepEqual(sortRows(rows, "none", (r) => r.n), rows);
  assert.deepEqual(
    sortRows(rows, "asc", (r) => r.n).map((r) => r.n),
    [1, 2, 3],
  );
  assert.deepEqual(
    sortRows(rows, "desc", (r) => r.n).map((r) => r.n),
    [3, 2, 1],
  );
});

test("paginate clamps page and computes range", () => {
  const rows = [1, 2, 3, 4, 5];
  assert.deepEqual(paginate([], 1, 2), {
    pageRows: [],
    totalPages: 1,
    page: 1,
    start: 0,
    end: 0,
    total: 0,
  });
  assert.deepEqual(paginate(rows, 99, 2), {
    pageRows: [5],
    totalPages: 3,
    page: 3,
    start: 5,
    end: 5,
    total: 5,
  });
  assert.deepEqual(paginate(rows, 2, 2).pageRows, [3, 4]);
});
