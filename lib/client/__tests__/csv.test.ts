import { describe, expect, it } from "vitest";
import { csvCell, csvFileName, toCsv } from "@/lib/client/csv";

describe("csv", () => {
  it("quotes commas, quotes and line breaks, and writes numbers as they are", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(42.5)).toBe("42.5");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("neutralises text a spreadsheet would run as a formula, but not numbers", () => {
    expect(csvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-5 units")).toBe("'-5 units");
    expect(csvCell(-5)).toBe("-5");
  });

  it("joins a header and rows with CRLF and a closing line break", () => {
    expect(toCsv(["A", "B"], [[1, "x,y"], [2, null]])).toBe('A,B\r\n1,"x,y"\r\n2,\r\n');
  });

  it("makes a safe file name with the date", () => {
    expect(csvFileName("qr serials/BEE 1", new Date("2026-10-16T10:00:00Z"))).toBe("qr-serials-BEE-1-2026-10-16.csv");
    expect(csvFileName("", new Date("2026-10-16T10:00:00Z"))).toBe("export-2026-10-16.csv");
  });
});
