import qrcode from "qrcode-generator";

/**
 * A real QR code (ISO 18004, byte mode, error-correction level M), as a square matrix of dark modules. Provided by the
 * `qrcode-generator` library; the tests decode the rendered picture with a QR reader to prove it reads back as the same text.
 */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** The quiet zone round a QR code, in modules (the standard asks for four). */
export const QR_QUIET_ZONE = 4;

/** The SVG path of the dark modules (one square per module, quiet zone included in the coordinates). */
export function qrPath(matrix: boolean[][]): string {
  const parts: string[] = [];
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) {
        c++;
        continue;
      }
      let end = c;
      while (end < row.length && row[end]) end++;
      parts.push(`M${c + QR_QUIET_ZONE} ${r + QR_QUIET_ZONE}h${end - c}v1h-${end - c}z`);
      c = end;
    }
  });
  return parts.join("");
}

/** The address a QR code on a certificate or label points to: the public verification page for the registration ID. */
export function verificationUrl(origin: string, registrationId: string): string {
  return `${origin.replace(/\/+$/, "")}/verify?reg=${encodeURIComponent(registrationId)}`;
}
