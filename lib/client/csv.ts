/**
 * CSV files made in the browser from rows already on the screen (demonstration exports). Cells that a spreadsheet could run as a formula
 * (a leading =, +, - or @ in text) get a leading apostrophe; numbers are written as they are. The file opens in Excel or any spreadsheet.
 */
export type CsvCell = string | number | boolean | null | undefined;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** A file name safe on every system: letters, digits, dot, dash and underscore, then .csv. */
export function csvFileName(name: string, date: Date = new Date()): string {
  const stem = name.replace(/\.csv$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
  return `${stem}-${date.toISOString().slice(0, 10)}.csv`;
}

/** Saves the text as a file through the browser (a user action must have started it). */
export function saveCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Some browsers cancel the save if the address is revoked at once, so it is released a little later.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
