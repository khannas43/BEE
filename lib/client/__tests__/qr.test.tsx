import { cleanup, render } from "@testing-library/react";
import jsQR from "jsqr";
import { afterEach, describe, expect, it } from "vitest";
import { QrCode } from "@/components/app/lifecycle/QrCode";
import { QR_QUIET_ZONE, qrMatrix, verificationUrl } from "@/lib/client/qr";

/** Draws a matrix as RGBA pixels (white background, black modules, quiet zone) and reads it back with a QR reader. */
function decode(matrix: boolean[][], scale = 6): string | null {
  const side = (matrix.length + 2 * QR_QUIET_ZONE) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  matrix.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (!dark) return;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const i = (((r + QR_QUIET_ZONE) * scale + y) * side + (c + QR_QUIET_ZONE) * scale + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }),
  );
  return jsQR(data, side, side)?.data ?? null;
}

describe("the QR code", () => {
  afterEach(cleanup);

  it("reads back as exactly the verification address, for the registration IDs we issue", () => {
    for (const reg of ["BEE/RAC/2026/10001", "BEE/RAC/2026/10016", "BEE/RAC/2027/99999"]) {
      const url = verificationUrl("http://127.0.0.1:3100", reg);
      expect(url).toBe(`http://127.0.0.1:3100/verify?reg=${encodeURIComponent(reg)}`);
      expect(decode(qrMatrix(url))).toBe(url);
    }
  });

  it("reads back for a longer address on another host and is square", () => {
    const url = verificationUrl("https://verify.example.org/", "BEE/RAC/2026/10001");
    const m = qrMatrix(url);
    expect(m.length).toBe(m[0].length);
    expect(decode(m)).toBe(url);
  });

  it("the SVG component carries the text and as many dark modules as the matrix", () => {
    const url = verificationUrl("http://127.0.0.1:3100", "BEE/RAC/2026/10001");
    const { getByTestId } = render(<QrCode text={url} title="Verification code" testId="qr" />);
    const svg = getByTestId("qr");
    expect(svg.getAttribute("data-qr-text")).toBe(url);
    expect(Number(svg.getAttribute("data-qr-modules"))).toBe(qrMatrix(url).length);
    expect(svg.querySelector("path")?.getAttribute("d")).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${qrMatrix(url).length + 2 * QR_QUIET_ZONE} ${qrMatrix(url).length + 2 * QR_QUIET_ZONE}`);
  });
});
