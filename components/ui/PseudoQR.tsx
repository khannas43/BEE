/**
 * A deterministic QR-like glyph derived from a string. Purely decorative —
 * not a scannable code — used to give QR screens visual texture.
 */
export function PseudoQR({ value, size = 88 }: { value: string; size?: number }) {
  const n = 11;
  // simple deterministic hash → bit for each cell
  let h = 2166136261;
  const bit = (i: number) => {
    h ^= (value.charCodeAt(i % value.length) + i * 31);
    h = Math.imul(h, 16777619);
    return ((h >>> (i % 13)) & 1) === 1;
  };
  const cells: boolean[] = [];
  for (let i = 0; i < n * n; i++) cells.push(bit(i));

  // force finder-pattern corners on
  const finder = (r: number, c: number) => (r < 3 && c < 3) || (r < 3 && c >= n - 3) || (r >= n - 3 && c < 3);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} className="rounded" aria-hidden="true">
      <rect width={n} height={n} fill="#ffffff" />
      {cells.map((on, i) => {
        const r = Math.floor(i / n);
        const c = i % n;
        const filled = finder(r, c) ? !((r === 1 && c === 1) || (r === 1 && c === n - 2) || (r === n - 2 && c === 1)) : on;
        return filled ? <rect key={i} x={c} y={r} width={1} height={1} fill="#0F172A" /> : null;
      })}
    </svg>
  );
}
