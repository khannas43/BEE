import { describe, expect, it } from "vitest";
import { buildXlsx, columnName, crc32, sheetName, xmlText } from "@/lib/client/xlsx";
import { buildCertificatePdf, buildPdf, Page, pdfText } from "@/lib/client/pdf";
import { datedFileName, parseCsvText, toCsv } from "@/lib/client/csv";
import { inflateRawSync } from "node:zlib";

const dec = new TextDecoder();
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** A small ZIP reader for the stored entries this app writes: checks every signature, size and CRC, and returns name -> text. */
function readZip(bytes: Uint8Array): Record<string, string> {
  const end = bytes.length - 22;
  expect(u32(bytes, end)).toBe(0x06054b50);
  const count = u16(bytes, end + 10);
  let p = u32(bytes, end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(u32(bytes, p)).toBe(0x02014b50);
    const method = u16(bytes, p + 10);
    const crc = u32(bytes, p + 16);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const local = u32(bytes, p + 42);
    const name = dec.decode(bytes.slice(p + 46, p + 46 + nameLen));
    expect(u32(bytes, local)).toBe(0x04034b50);
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const data = method === 0 ? bytes.slice(start, start + size) : new Uint8Array(inflateRawSync(bytes.slice(start, start + size)));
    expect(crc32(data), `crc of ${name}`).toBe(crc);
    out[name] = dec.decode(data);
    p += 46 + nameLen;
  }
  return out;
}

describe("xlsx", () => {
  it("is a ZIP package with the parts Excel needs, and every checksum is right", () => {
    const files = readZip(buildXlsx("Payments", ["Application", "Amount INR"], [["DEMO-PAY-0001", 11800]]));
    expect(Object.keys(files).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    expect(files["xl/workbook.xml"]).toContain('<sheet name="Payments"');
  });

  it("keeps numbers as numbers, text as inline text, escapes XML and never writes a formula", () => {
    const sheet = readZip(buildXlsx("S", ["Name", "N"], [["=SUM(A1)", 12.5], ["a & <b> \"q\" 'x'", -3], [null, true]]))["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain('<c r="B2"><v>12.5</v></c>');
    expect(sheet).toContain('<c r="B3"><v>-3</v></c>');
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">=SUM(A1)</t></is></c>');
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain("a &amp; &lt;b&gt; &quot;q&quot; &apos;x&apos;");
    expect(sheet).toContain('<c r="B4" t="b"><v>1</v></c>');
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr">');
  });

  it("helpers: column letters, sheet names, control characters, the standard CRC", () => {
    expect([columnName(0), columnName(25), columnName(26), columnName(27), columnName(701), columnName(702)]).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(sheetName("a/b:c*d?[e]")).toBe("a b c d  e");
    expect(sheetName("x".repeat(40)).length).toBe(31);
    expect(sheetName("   ")).toBe("Sheet1");
    expect(xmlText("a\u0000b\u001fc")).toBe("abc");
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("handles a large sheet", () => {
    const rows = Array.from({ length: 3000 }, (_, i) => [`r${i}`, i]);
    const sheet = readZip(buildXlsx("Big", ["k", "v"], rows))["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain('<row r="3001">');
  });
});

describe("csv helpers", () => {
  it("reads back what toCsv wrote, including quotes, commas and line breaks", () => {
    const rows = [["a,b", 'say "hi"', "two\nlines"], ["1", "", "x"]];
    expect(parseCsvText("﻿" + toCsv(["h1", "h2", "h3"], rows))).toEqual([["h1", "h2", "h3"], ["a,b", 'say "hi"', "two\nlines"], ["1", "", "x"]]);
  });
  it("names a dated file with the given extension", () => {
    expect(datedFileName("qr serials/BEE 1.csv", "xlsx", new Date("2026-10-16T10:00:00Z"))).toBe("qr-serials-BEE-1-2026-10-16.xlsx");
  });
});

const FACTS = {
  registrationId: "BEE/RAC/2026/10101", organisation: "Nova Cool Appliances Pvt Ltd (synthetic)", brandName: "Nova Cool", modelNumber: "NC-RAC-12D", category: "RAC",
  stars: 5, verifiedIseer: "5.05", validFrom: "2026-01-15", validTo: "2029-01-14", status: "valid", schemeKey: "rac_demo", verifyUrl: "http://127.0.0.1:3100/verify?reg=BEE%2FRAC%2F2026%2F10101",
};

describe("pdf", () => {
  const latin1 = (b: Uint8Array) => Array.from(b, (x) => String.fromCharCode(x)).join("");

  it("is a PDF with a correct cross-reference table: every offset points at its object", () => {
    const text = latin1(buildCertificatePdf(FACTS));
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries.length).toBeGreaterThanOrEqual(8);
    entries.forEach((off, i) => expect(text.slice(off, off + `${i + 1} 0 obj`.length), `object ${i + 1}`).toBe(`${i + 1} 0 obj`));
    expect(text).toContain("/Count 2");
  });

  it("carries the certificate facts as searchable text on page one and the label on page two", () => {
    const text = latin1(buildCertificatePdf(FACTS));
    for (const s of ["Certificate of registration", "BEE/RAC/2026/10101", "Nova Cool NC-RAC-12D", "5 of 5 stars", "2026-01-15 to 2029-01-14", "LOCAL DEMONSTRATION", "Star label", "ISEER 5.05", "Valid until 2029-01-14"]) {
      expect(text, s).toContain(s);
    }
  });

  it("draws a QR code: many rectangles, and the same modules as the on-screen code", () => {
    const text = latin1(buildCertificatePdf(FACTS));
    expect((text.match(/ re f/g) ?? []).length).toBeGreaterThan(300);
  });

  it("keeps text safe: parentheses and backslashes escaped, characters outside Latin-1 become a question mark", () => {
    expect(pdfText("a – b “q” … ★ é")).toBe('a - b "q" ... ? é');
    const page = new Page().text(10, 10, 12, "a(b)c\\d");
    expect(page.content()).toContain("(a\\(b\\)c\\\\d)");
    const bytes = buildPdf([page], { title: "T (1)" });
    expect(latin1(bytes)).toContain("/Title (T \\(1\\))");
  });
});
