import { QR_QUIET_ZONE, qrMatrix, qrPath } from "@/lib/client/qr";

/** A scannable QR code as an SVG. `text` is what a phone reads; it is also kept on the element for the checks. */
export function QrCode({ text, size = 144, title, testId }: { text: string; size?: number; title: string; testId?: string }) {
  const matrix = qrMatrix(text);
  const side = matrix.length + 2 * QR_QUIET_ZONE;
  return (
    <svg
      role="img"
      aria-label={title}
      viewBox={`0 0 ${side} ${side}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      data-testid={testId}
      data-qr-text={text}
      data-qr-modules={matrix.length}
    >
      <title>{title}</title>
      <rect width={side} height={side} fill="#fff" />
      <path d={qrPath(matrix)} fill="#000" />
    </svg>
  );
}
