"use client";

import { useId } from "react";

/**
 * Small charts drawn as plain SVG (no chart library): a donut, a ranked bar list and a trend with a soft area. Each one has a text alternative,
 * so the numbers are readable without the picture. Colours follow the meaning of the words (green for healthy, amber for waiting, red for broken).
 */
export type Point = { label: string; value: number };

const PALETTE = ["#1f6f4a", "#3b5ea8", "#c7881a", "#8a5ba8", "#2a8f9c", "#b5547a", "#6b7a3a", "#7d8590"];

const GOOD = /^(active|match|accepted|paid|committed|started|issue|review_accepted|low|valid|submit)$/i;
const BAD = /^(failed|mismatch|reject|rejected|high|declined)$/i;
const REVOKED = /^(revoked|revoke)$/i;
const WAIT = /^(waiting for a second signature|pending|submitted|query|review_query|medium|override|retry|amend|initiated)$/i;
const NONE = /^(not submitted|none|\?)$/i;

/** The colour for a label: by meaning when the word is a known state, otherwise from the palette by position. */
export function colourFor(label: string, index: number): string {
  if (REVOKED.test(label)) return "#7a1f16";
  if (BAD.test(label)) return "#c0392b";
  if (WAIT.test(label)) return "#d99a1c";
  if (GOOD.test(label)) return "#2e7d4f";
  if (NONE.test(label)) return "#98a2b3";
  return PALETTE[index % PALETTE.length];
}

export const prettyLabel = (s: string) => s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export const formatNumber = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(n);

export function DonutChart({ data, title, size = 132, centre, legendMax = 8 }: { data: Point[]; title: string; size?: number; centre?: string; legendMax?: number }) {
  const total = data.reduce((n, d) => n + d.value, 0);
  const r = 46;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const desc = data.map((d) => `${prettyLabel(d.label)} ${formatNumber(d.value)}`).join(", ");
  return (
    <div className="flex items-center gap-space-md" data-testid="dash-chart-donut">
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`${title}: ${desc}`} className="shrink-0">
        <title>{title}</title>
        <circle cx="60" cy="60" r={r} fill="none" stroke="#eef1f5" strokeWidth="16" />
        {total > 0 ? data.map((d, i) => {
          const len = (d.value / total) * c;
          const el = <circle key={d.label} cx="60" cy="60" r={r} fill="none" stroke={colourFor(d.label, i)} strokeWidth="16" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" />;
          offset += len;
          return el;
        }) : null}
        <text x="60" y="58" textAnchor="middle" className="fill-on-surface" style={{ font: "700 22px Inter, system-ui, sans-serif" }}>{centre ?? formatNumber(total)}</text>
        <text x="60" y="76" textAnchor="middle" className="fill-on-surface-variant" style={{ font: "500 9px Inter, system-ui, sans-serif" }}>{centre ? "" : "in all"}</text>
      </svg>
      <ul className="space-y-1.5 text-[12px] leading-4 text-on-surface min-w-0">
        {data.slice(0, legendMax).map((d, i) => (
          <li key={d.label} className="flex items-start gap-2 min-w-0">
            <span className="mt-[3px] inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: colourFor(d.label, i) }} />
            <span className="min-w-0 break-words" title={prettyLabel(d.label)}>{prettyLabel(d.label)}</span>
            <span className="ml-auto pl-2 font-semibold tabular-nums">{formatNumber(d.value)}</span>
          </li>
        ))}
        {data.length > legendMax ? <li className="font-label-sm text-on-surface-variant">+ {data.length - legendMax} more</li> : null}
      </ul>
    </div>
  );
}

export function BarList({ data, title, unit = "" }: { data: Point[]; title: string; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2" role="list" aria-label={title} data-testid="dash-chart-bars">
      {data.length === 0 ? <li className="font-body-sm text-on-surface-variant">Nothing in this period.</li> : null}
      {data.map((d, i) => (
        <li key={d.label}>
          <div className="flex items-start justify-between gap-2 text-[12px] leading-4 text-on-surface"><span className="min-w-0 break-words" title={prettyLabel(d.label)}>{prettyLabel(d.label)}</span><span className="font-semibold tabular-nums">{unit}{formatNumber(d.value)}</span></div>
          <div className="h-2.5 rounded-full bg-[#eef1f5] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(3, (d.value / max) * 100)}%`, background: colourFor(d.label, i) }} /></div>
        </li>
      ))}
    </ul>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym: string) => (/^\d{4}-\d{2}/.test(ym) ? `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(2, 4)}` : ym);

export function TrendChart({ data, title, colour = "#1f6f4a", height = 110, unit = "", compact = false }: { data: Point[]; title: string; colour?: string; height?: number; unit?: string; compact?: boolean }) {
  const id = useId().replace(/:/g, "");
  const w = 320;
  const h = height;
  const pad = { l: 4, r: 4, t: 10, b: compact ? 4 : 20 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = data.length > 1 ? (w - pad.l - pad.r) / (data.length - 1) : 0;
  const pts = data.map((d, i) => [pad.l + (data.length > 1 ? i * step : (w - pad.l - pad.r) / 2), pad.t + (1 - d.value / max) * (h - pad.t - pad.b)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = pts.length ? `${line} L${pts[pts.length - 1][0].toFixed(1)} ${h - pad.b} L${pts[0][0].toFixed(1)} ${h - pad.b} Z` : "";
  const total = data.reduce((n, d) => n + d.value, 0);
  const peak = data.reduce((a, d) => (d.value > a.value ? d : a), data[0] ?? { label: "", value: 0 });
  return (
    <div data-testid="dash-chart-trend">
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={`${title}: ${formatNumber(total)} in all${peak?.value ? `, highest in ${monthName(peak.label)} (${unit}${formatNumber(peak.value)})` : ""}`} preserveAspectRatio="none">
        <title>{title}</title>
        <defs><linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colour} stopOpacity="0.32" /><stop offset="100%" stopColor={colour} stopOpacity="0.02" /></linearGradient></defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={pad.l} x2={w - pad.r} y1={pad.t + f * (h - pad.t - pad.b)} y2={pad.t + f * (h - pad.t - pad.b)} stroke="#e6eaf0" strokeWidth="1" />)}
        {area ? <path d={area} fill={`url(#g${id})`} /> : null}
        {line ? <path d={line} fill="none" stroke={colour} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" /> : null}
        {pts.map(([x, y], i) => (data[i].value > 0 ? <circle key={i} cx={x} cy={y} r={compact ? 2 : 3} fill="#fff" stroke={colour} strokeWidth="2" /> : null))}
        {!compact && data.length > 0 ? [0, Math.floor((data.length - 1) / 2), data.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
          <text key={i} x={pts[i][0]} y={h - 4} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} style={{ font: "500 9px Inter, system-ui, sans-serif" }} fill="#667085">{monthName(data[i].label)}</text>
        )) : null}
      </svg>
    </div>
  );
}

export type TwoPoint = { label: string; a: number; b: number };

/** Two series side by side for each month (for example received against issued), with a legend and a text alternative. */
export function GroupedBars({ data, title, aName, bName, height = 150 }: { data: TwoPoint[]; title: string; aName: string; bName: string; height?: number }) {
  const w = 640;
  const pad = { l: 4, r: 4, t: 8, b: 20 };
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const slot = (w - pad.l - pad.r) / Math.max(1, data.length);
  const bw = Math.min(14, slot / 2.6);
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const sa = data.reduce((n, d) => n + d.a, 0);
  const sb = data.reduce((n, d) => n + d.b, 0);
  return (
    <div data-testid="dash-chart-grouped">
      <div className="flex gap-4 font-label-md text-on-surface mb-1">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#3b5ea8" }} />{aName} <strong className="tabular-nums">{formatNumber(sa)}</strong></span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#2e7d4f" }} />{bName} <strong className="tabular-nums">{formatNumber(sb)}</strong></span>
      </div>
      <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label={`${title}: ${aName} ${formatNumber(sa)}, ${bName} ${formatNumber(sb)} in all`} preserveAspectRatio="none">
        <title>{title}</title>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={pad.l} x2={w - pad.r} y1={pad.t + f * (height - pad.t - pad.b)} y2={pad.t + f * (height - pad.t - pad.b)} stroke="#e6eaf0" strokeWidth="1" />)}
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          return (
            <g key={d.label}>
              <title>{`${monthName(d.label)}: ${aName} ${d.a}, ${bName} ${d.b}`}</title>
              <rect x={cx - bw - 1} y={y(d.a)} width={bw} height={Math.max(0, height - pad.b - y(d.a))} rx="2" fill="#3b5ea8" />
              <rect x={cx + 1} y={y(d.b)} width={bw} height={Math.max(0, height - pad.b - y(d.b))} rx="2" fill="#2e7d4f" />
              {data.length <= 14 || i % 2 === 0 ? <text x={cx} y={height - 5} textAnchor="middle" style={{ font: "500 10px Inter, system-ui, sans-serif" }} fill="#667085">{monthName(d.label)}</text> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
