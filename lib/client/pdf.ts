/**
 * A real PDF file made in the browser, with no library: the certificate and the star label of an approved model, each with a QR code that
 * a phone reads (the same code as on the screen), drawn as vector squares. Plain PDF 1.4: standard fonts (Helvetica, Courier), no
 * compression, so the text can be searched and copied. Pages are A4.
 */
import { qrMatrix, QR_QUIET_ZONE } from "@/lib/client/qr";

const PAGE_W = 595.28;
const PAGE_H = 841.89;

/** WinAnsi-safe text: Latin-1 characters stay, the typographic dashes and quotes are simplified, anything else becomes "?". */
export function pdfText(s: string): string {
  const mapped = s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/→/g, "->");
  let out = "";
  for (const ch of mapped) {
    const code = ch.codePointAt(0) ?? 63;
    out += code >= 32 && code <= 255 && code !== 127 ? ch : "?";
  }
  return out;
}

const esc = (s: string) => pdfText(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const n = (v: number) => (Math.round(v * 100) / 100).toString();

type Font = "F1" | "F2" | "F3";

let measurer: CanvasRenderingContext2D | null | undefined;
function textWidth(s: string, size: number, font: Font): number {
  if (measurer === undefined) {
    try {
      measurer = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    } catch {
      measurer = null;
    }
  }
  if (measurer) {
    measurer.font = `${font === "F2" ? "bold " : ""}100px ${font === "F3" ? "Courier, monospace" : "Helvetica, Arial, sans-serif"}`;
    const w = measurer.measureText(s).width;
    if (w > 0) return (w / 100) * size;
  }
  return s.length * size * (font === "F3" ? 0.6 : font === "F2" ? 0.52 : 0.48);
}

/** One page: drawing calls collect PDF content stream operators. Coordinates are in points from the top-left, like a screen. */
export class Page {
  private ops: string[] = [];

  text(x: number, y: number, size: number, s: string, font: Font = "F1", gray = 0): this {
    this.ops.push(`BT ${n(gray)} g /${font} ${n(size)} Tf ${n(x)} ${n(PAGE_H - y)} Td (${esc(s)}) Tj ET`);
    return this;
  }

  /** Text centred on the page, measured with the browser's own Helvetica or Arial; without a canvas (tests) the width is estimated. */
  centered(y: number, size: number, s: string, font: Font = "F1", gray = 0): this {
    const w = textWidth(pdfText(s), size, font);
    return this.text(Math.max(20, (PAGE_W - w) / 2), y, size, s, font, gray);
  }

  rect(x: number, y: number, w: number, h: number, opts: { stroke?: number; fill?: number } = {}): this {
    const lines: string[] = [];
    if (opts.fill !== undefined) lines.push(`${n(opts.fill)} g`);
    if (opts.stroke !== undefined) lines.push(`${n(opts.stroke)} w 0 G`);
    lines.push(`${n(x)} ${n(PAGE_H - y - h)} ${n(w)} ${n(h)} re ${opts.fill !== undefined && opts.stroke !== undefined ? "B" : opts.fill !== undefined ? "f" : "S"}`);
    this.ops.push(lines.join(" "));
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5): this {
    this.ops.push(`${n(width)} w 0 G ${n(x1)} ${n(PAGE_H - y1)} m ${n(x2)} ${n(PAGE_H - y2)} l S`);
    return this;
  }

  /** A five-pointed star, filled or only outlined. */
  star(cx: number, cy: number, r: number, filled: boolean): this {
    const pts: string[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.4;
      pts.push(`${n(cx + rr * Math.cos(a))} ${n(PAGE_H - (cy + rr * Math.sin(a)))} ${i === 0 ? "m" : "l"}`);
    }
    this.ops.push(`${filled ? "0 g" : "0.5 w 0 G"} ${pts.join(" ")} h ${filled ? "f" : "S"}`);
    return this;
  }

  /** A QR code of the text, `size` points square with its quiet zone. Horizontal runs of dark modules are merged into one rectangle each. */
  qr(x: number, y: number, size: number, content: string): this {
    const m = qrMatrix(content);
    const side = m.length + 2 * QR_QUIET_ZONE;
    const u = size / side;
    this.ops.push(`1 g ${n(x)} ${n(PAGE_H - y - size)} ${n(size)} ${n(size)} re f 0 g`);
    m.forEach((row, r) => {
      let c = 0;
      while (c < row.length) {
        if (!row[c]) {
          c++;
          continue;
        }
        let end = c;
        while (end < row.length && row[end]) end++;
        this.ops.push(`${n(x + (c + QR_QUIET_ZONE) * u)} ${n(PAGE_H - y - (r + QR_QUIET_ZONE + 1) * u)} ${n((end - c) * u)} ${n(u)} re f`);
        c = end;
      }
    });
    return this;
  }

  content(): string {
    return this.ops.join("\n");
  }
}

/** Assembles the pages into a PDF file: catalog, page tree, three standard fonts, one content stream per page, a cross-reference table. */
export function buildPdf(pages: Page[], info: { title: string; subject?: string }): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  // 1 catalog, 2 page tree, 3 to 5 fonts, 6 info, then a page and a content stream per page
  add("<< /Type /Catalog /Pages 2 0 R >>");
  const firstPage = 7;
  add(`<< /Type /Pages /Kids [${pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  add(`<< /Title (${esc(info.title)}) /Subject (${esc(info.subject ?? "")}) /Producer (BEE local demonstration) >>`);
  pages.forEach((p, i) => {
    const stream = p.content();
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PAGE_W)} ${n(PAGE_H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${firstPage + i * 2 + 1} 0 R >>`);
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // every character is Latin-1 (the content was filtered), so one byte each
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

export type CertificateFacts = {
  registrationId: string;
  organisation: string;
  brandName: string;
  modelNumber: string;
  category: string;
  stars: number;
  verifiedIseer: string;
  validFrom: string;
  validTo: string;
  status: string;
  schemeKey: string;
  verifyUrl: string;
};

const DEMO = "LOCAL DEMONSTRATION: not issued by BEE, no legal effect.";

function certificatePage(c: CertificateFacts): Page {
  const p = new Page();
  p.rect(36, 36, PAGE_W - 72, PAGE_H - 72, { stroke: 2 });
  p.rect(44, 44, PAGE_W - 88, PAGE_H - 88, { stroke: 0.5 });
  p.centered(78, 9, DEMO, "F1", 0.25);
  p.centered(122, 26, "Certificate of registration", "F2");
  p.centered(150, 11, "Bureau of Energy Efficiency - Standards and Labelling (local demonstration)", "F1", 0.3);
  p.line(90, 170, PAGE_W - 90, 170, 0.8);
  p.centered(206, 18, c.registrationId, "F3");
  const rows: [string, string][] = [
    ["Manufacturer", c.organisation],
    ["Brand and model", `${c.brandName} ${c.modelNumber}`],
    ["Category", c.category],
    ["Star rating", `${c.stars} of 5 stars`],
    ["Verified efficiency (ISEER)", c.verifiedIseer],
    ["Valid", `${c.validFrom} to ${c.validTo}`],
    ["Status", c.status.replaceAll("_", " ")],
    ["Rating scheme", `${c.schemeKey} (a local demonstration scheme)`],
  ];
  rows.forEach(([k, v], i) => {
    const y = 262 + i * 30;
    p.text(80, y, 10, k, "F1", 0.4);
    p.text(240, y, 12, v, "F2");
    p.line(80, y + 9, PAGE_W - 80, y + 9, 0.25);
  });
  for (let i = 0; i < 5; i++) p.star(250 + i * 28, 546, 11, i < c.stars);
  p.text(80, 551, 10, "Star rating", "F1", 0.4);
  p.qr(PAGE_W - 80 - 150, 590, 150, c.verifyUrl);
  p.text(80, 640, 10, "Scan the code to verify this registration", "F2");
  p.text(80, 656, 9, "It opens the public verification page:", "F1", 0.4);
  p.text(80, 670, 8, c.verifyUrl.length > 70 ? `${c.verifyUrl.slice(0, 67)}...` : c.verifyUrl, "F3", 0.2);
  p.centered(PAGE_H - 70, 8, "Synthetic data. Nothing on this page is a BEE record.", "F1", 0.4);
  return p;
}

function labelPage(c: CertificateFacts): Page {
  const p = new Page();
  const w = 300;
  const x = (PAGE_W - w) / 2;
  p.rect(x, 120, w, 520, { stroke: 4 });
  p.text(x + 18, 150, 8, DEMO, "F1", 0.25);
  p.centered(196, 24, "Star label", "F2");
  for (let i = 0; i < 5; i++) p.star(PAGE_W / 2 - 80 + i * 40, 250, 17, i < c.stars);
  p.centered(300, 14, `${c.stars} of 5 stars`, "F2");
  p.centered(330, 16, `ISEER ${c.verifiedIseer}`, "F2");
  p.centered(362, 12, `${c.brandName} ${c.modelNumber}`, "F1");
  p.centered(384, 11, c.registrationId, "F3");
  p.qr((PAGE_W - 140) / 2, 410, 140, c.verifyUrl);
  p.centered(572, 10, `Valid until ${c.validTo}`, "F1");
  p.centered(592, 8, "Scan to verify on the public page", "F1", 0.4);
  return p;
}

/** The certificate (page 1) and the star label (page 2) of an approved model. */
export function buildCertificatePdf(c: CertificateFacts): Uint8Array {
  return buildPdf([certificatePage(c), labelPage(c)], { title: `Certificate ${c.registrationId}`, subject: "Local demonstration certificate and label" });
}

export const PDF_TYPE = "application/pdf";
