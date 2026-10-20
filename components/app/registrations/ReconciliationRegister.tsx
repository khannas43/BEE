"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { demoGet, demoPath, type DemoBody } from "@/lib/client/runtimeDemo";
import { registerHref } from "@/lib/client/runtimeRegisterRevocations";
import { useManufacturers } from "@/lib/client/runtimeManufacturers";
import { manufacturerEntryHref } from "@/components/app/registrations/ManufacturersRegister";

/**
 * QR and production reconciliation: for every quarterly submission, the units a manufacturer declared for each model against the QR serials
 * bound to that model's certificate. A flag is a prompt for a person, not a decision. Local demonstration, not BEE rules.
 */

type Submission = { id: string; organisationName?: string; quarter: string; state: string; rowCount?: number; totalUnits?: number };
type Recon = { models: { modelApplicationId: string; modelNumber: string; registrationId: string; declaredUnits: number; boundSerials: number | null; flag: string }[]; marginPercent: number; declaredTotal: number; boundTotal: number | null; message: string; qrAvailable: boolean };
type Line = { key: string; submissionId: string; quarter: string; state: string; organisation: string; model: string; certificate: string; declared: number; bound: number | null; gap: number | null; flag: "match" | "review" | "none"; margin: number };

export const reconciliationEntryHref = (id: string) => `${registerHref()}?view=reconciliation&id=${encodeURIComponent(id)}`;

const STATE: Record<string, string> = { draft: "Draft", submitted: "Submitted", accepted: "Accepted", query: "Query raised" };
const FLAG_WORD = { match: "Matches QR", review: "Needs review", none: "No QR data" } as const;
const TONE: Record<string, string> = {
  match: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]", review: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]", none: "bg-[#eef2f7] text-[#475569] border-[#d8e0ea]",
  Accepted: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]", Submitted: "bg-[#e7effb] text-[#14315E] border-[#c9d9f7]", "Query raised": "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]", Draft: "bg-[#eef2f7] text-[#475569] border-[#d8e0ea]",
};
const Chip = ({ tone, children }: { tone: string; children: ReactNode }) => <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold leading-4 ${TONE[tone] ?? TONE.none}`}>{children}</span>;
const th = "px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[#475569]";
const td = "px-3 py-2 align-top";
const card = "rounded-xl border border-[#dbe6f7] bg-white";
const sel = "mt-1 block rounded-lg border border-outline-variant bg-white px-3 py-2 text-[13px]";
const n = (v: number | null) => (v === null ? "-" : v.toLocaleString("en-IN"));

export function useReconciliation(): { phase: "loading" | "failed" | "ready"; message: string; submissions: Submission[]; lines: Line[]; recon: Map<string, Recon> } {
  const [state, setState] = useState<{ phase: "loading" | "failed" | "ready"; message: string; submissions: Submission[]; recon: Map<string, Recon> }>({ phase: "loading", message: "", submissions: [], recon: new Map() });
  useEffect(() => {
    let live = true;
    void (async () => {
      const list = await demoGet<DemoBody & { submissions: Submission[] }>(demoPath("production"));
      if (!live) return;
      if (!list.ok) return setState({ phase: "failed", message: list.message, submissions: [], recon: new Map() });
      const subs = Array.isArray(list.value.submissions) ? list.value.submissions : [];
      const results = await Promise.all(subs.map((s) => demoGet<DemoBody & Recon>(demoPath("production", s.id, "reconciliation"))));
      if (!live) return;
      const recon = new Map<string, Recon>();
      results.forEach((r, i) => { if (r.ok && Array.isArray(r.value.models)) recon.set(subs[i].id, r.value); });
      setState({ phase: "ready", message: "", submissions: subs, recon });
    })();
    return () => { live = false; };
  }, []);
  const lines: Line[] = [];
  for (const s of state.submissions) {
    const r = state.recon.get(s.id);
    for (const m of r?.models ?? []) {
      const bound = m.boundSerials;
      lines.push({
        key: `${s.id}:${m.registrationId}`, submissionId: s.id, quarter: s.quarter, state: STATE[s.state] ?? s.state, organisation: (s.organisationName ?? "").replace(/\s*\(synthetic[^)]*\)\s*$/, ""),
        model: m.modelNumber, certificate: m.registrationId, declared: m.declaredUnits, bound, gap: bound === null ? null : bound - m.declaredUnits,
        flag: bound === null || m.flag === "unavailable" ? "none" : m.flag === "review" ? "review" : "match", margin: r?.marginPercent ?? 10,
      });
    }
  }
  return { ...state, lines };
}

export function ReconciliationPanel() {
  const data = useReconciliation();
  const [quarter, setQuarter] = useState("");
  const [maker, setMaker] = useState("");
  const [flag, setFlag] = useState("");
  const [sub, setSub] = useState("");
  const rows = data.lines.filter((l) => (!quarter || l.quarter === quarter) && (!maker || l.organisation === maker) && (!flag || l.flag === flag) && (!sub || l.state === sub));
  const tools = useListTools({
    rows,
    text: (l) => `${l.quarter} ${l.organisation} ${l.model} ${l.certificate} ${FLAG_WORD[l.flag]}`,
    sortValue: (l, k) => (k === "q" ? l.quarter : k === "mfr" ? l.organisation : k === "model" ? l.model : k === "decl" ? l.declared : k === "bound" ? l.bound ?? -1 : k === "gap" ? l.gap ?? 0 : k === "flag" ? l.flag : l.state),
    pageSize: 12,
  });
  if (data.phase === "loading") return <p role="status" className="font-body-sm">Reconciling quarterly submissions with QR serials…</p>;
  if (data.phase === "failed") return <p role="alert" className="text-error font-body-sm">{data.message}</p>;
  const quarters = [...new Set(data.lines.map((l) => l.quarter))].sort().reverse();
  const makers = [...new Set(data.lines.map((l) => l.organisation))].sort();
  const flagged = data.lines.filter((l) => l.flag === "review");
  const declared = data.lines.reduce((t, l) => t + l.declared, 0);
  const tile = (label: string, value: string | number, note: string, pick?: string, tone = "text-[#14315E]") => pick === undefined ? (
    <div className={`${card} p-4 text-left`}>
      <span className="block text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">{label}</span><span className={`block text-[26px] font-extrabold leading-8 ${tone}`}>{value}</span><span className="block text-[12px] text-[#64748b]">{note}</span>
    </div>
  ) : (
    <button type="button" onClick={() => { setFlag(flag === pick ? "" : pick ?? ""); tools.setPage(1); }} aria-pressed={flag === pick} className={`${card} p-4 text-left hover:border-[#9dbdec] ${flag === pick ? "border-[#254e9e] ring-2 ring-[#c9d9f7]" : ""}`}>
      <span className="block text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">{label}</span><span className={`block text-[26px] font-extrabold leading-8 ${tone}`}>{value}</span><span className="block text-[12px] text-[#64748b]">{note}</span>
    </button>
  );
  return (
    <div className="space-y-space-sm" data-testid="recon-panel">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="recon-summary">
        {tile("Submissions", data.submissions.length, `${quarters.length} quarters`)}
        {tile("Models reconciled", data.lines.length, "declared against QR serials")}
        {tile("Match QR", data.lines.filter((l) => l.flag === "match").length, "within the margin", "match", "text-[#14532d]")}
        {tile("Need review", flagged.length, "declared above bound QR", "review", flagged.length ? "text-[#8a4b00]" : "text-[#14532d]")}
        {tile("Units declared", declared.toLocaleString("en-IN"), "across all submissions")}
      </div>
      <p className="text-[13px] text-[#64748b]">A line needs review when the units declared for the quarter exceed the QR serials bound to that model&apos;s certificate by more than the margin (10%). It is a prompt for a person, not a decision. Serials are counted over all time on the simulated QR data.</p>
      <ListToolbar tools={tools} searchLabel="Search reconciliation" placeholder="Quarter, manufacturer, model or certificate"
        exportCsv={{ filename: "qr-production-reconciliation", header: ["Quarter", "Manufacturer", "Model", "Certificate", "Declared units", "Bound QR serials", "Difference", "Result", "Submission"],
          rows: tools.visible.map((l) => [l.quarter, l.organisation, l.model, l.certificate, l.declared, l.bound ?? "", l.gap ?? "", FLAG_WORD[l.flag], l.state]) }} />
      <div className="flex flex-wrap items-end gap-3" data-testid="recon-filters">
        {([["Quarter", quarter, setQuarter, quarters.map((q): [string, string] => [q, q]), "recon-quarter"], ["Manufacturer", maker, setMaker, makers.map((q): [string, string] => [q, q]), "recon-maker"],
          ["Result", flag, setFlag, Object.entries(FLAG_WORD) as [string, string][], "recon-flag"], ["Submission", sub, setSub, Object.values(STATE).map((q): [string, string] => [q, q]), "recon-state"]] as [string, string, (v: string) => void, [string, string][], string][]).map(([label, value, set, opts, id]) => (
          <label key={id} className="text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">{label}
            <select value={value} onChange={(e) => { set(e.target.value); tools.setPage(1); }} className={sel} data-testid={id}><option value="">All</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        ))}
        {quarter || maker || flag || sub ? <button type="button" className="rounded-lg border border-outline-variant bg-white px-3 py-2 text-[13px] font-semibold text-primary" onClick={() => { setQuarter(""); setMaker(""); setFlag(""); setSub(""); tools.setPage(1); }}>Clear filters</button> : null}
      </div>
      {tools.visible.length === 0 ? <p className="font-body-sm text-on-surface-variant">No line matches these filters.</p> : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-[13px]" data-testid="recon-table">
            <caption className="sr-only">Declared units against bound QR serials, by submission and model</caption>
            <thead><tr className="bg-[#eef3fb]">
              <SortableTh tools={tools} k="q" className={th}>Quarter</SortableTh><SortableTh tools={tools} k="mfr" className={th}>Manufacturer</SortableTh><SortableTh tools={tools} k="model" className={th}>Model</SortableTh>
              <SortableTh tools={tools} k="decl" className={th}>Declared units</SortableTh><SortableTh tools={tools} k="bound" className={th}>Bound QR serials</SortableTh><SortableTh tools={tools} k="gap" className={th}>Difference</SortableTh>
              <SortableTh tools={tools} k="flag" className={th}>Result</SortableTh><SortableTh tools={tools} k="state" className={th}>Submission</SortableTh><th className={th}><span className="sr-only">Open</span></th>
            </tr></thead>
            <tbody>
              {tools.paged.pageRows.map((l) => (
                <tr key={l.key} className="border-t border-[#e7edf6] hover:bg-[#f4f8ff]" data-testid={`recon-row-${l.key}`}>
                  <td className={`${td} font-semibold`}>{l.quarter}</td><td className={td}>{l.organisation}</td>
                  <td className={td}><span className="font-semibold text-[#14315E]">{l.model}</span><div className="text-[12px] text-[#64748b]">{l.certificate}</div></td>
                  <td className={td}>{n(l.declared)}</td><td className={td}>{n(l.bound)}</td>
                  <td className={`${td} ${l.gap !== null && l.gap < 0 ? "font-semibold text-[#93000a]" : ""}`}>{l.gap === null ? "-" : l.gap > 0 ? `+${n(l.gap)}` : n(l.gap)}</td>
                  <td className={td}><Chip tone={l.flag}>{FLAG_WORD[l.flag]}</Chip></td><td className={td}><Chip tone={l.state}>{l.state}</Chip></td>
                  <td className={td}><Link href={reconciliationEntryHref(l.submissionId)} className="inline-flex items-center gap-1 font-semibold text-primary" data-testid={`recon-open-${l.key}`}>Open <Icon name="arrow_forward" size={14} /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ListPager tools={tools} />
    </div>
  );
}

function Box({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`${card} p-5`} data-testid={testId}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-left">
        <span role="heading" aria-level={2} className="text-[16px] font-bold text-[#14315E]">{title}</span><Icon name={open ? "expand_less" : "expand_more"} size={22} className="text-[#475569]" />
      </button>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
const Fact = ({ label, value }: { label: string; value: ReactNode }) => <div><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">{label}</div><div className="mt-0.5 text-[14px] font-semibold text-[#14315E]">{value || "-"}</div></div>;

/** One submission's reconciliation, model by model. */
export function ReconciliationEntry({ id }: { id: string }) {
  const data = useReconciliation();
  const dir = useManufacturers();
  const back = <Link href={`${registerHref()}?tab=reconciliation`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary" data-testid="recon-back"><Icon name="arrow_back" size={16} /> All reconciliations</Link>;
  if (data.phase === "loading") return <p role="status" className="font-body-sm">Loading the reconciliation…</p>;
  if (data.phase === "failed") return <p role="alert" className="text-error font-body-sm">{data.message}</p>;
  const s = data.submissions.find((x) => x.id === id);
  if (!s) return <div className="space-y-space-sm">{back}<p className="font-body-sm text-on-surface-variant">No such submission is on record.</p></div>;
  const r = data.recon.get(id);
  const lines = data.lines.filter((l) => l.submissionId === id);
  const name = (s.organisationName ?? "").replace(/\s*\(synthetic[^)]*\)\s*$/, "");
  const owner = dir.phase === "ready" ? dir.list.find((m) => m.name === name) : undefined;
  const review = lines.filter((l) => l.flag === "review").length;
  return (
    <div className="space-y-space-md" data-testid="recon-entry">
      {back}
      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div role="heading" aria-level={2} className="text-[22px] font-extrabold text-[#14315E]">{name} · {s.quarter}</div>
            <div className="text-[14px] text-[#475569]">Quarterly submission · {lines.length} model{lines.length === 1 ? "" : "s"}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={STATE[s.state] ?? "none"}>{STATE[s.state] ?? s.state}</Chip>
            {owner ? <Link href={manufacturerEntryHref(owner.code)} className="inline-flex items-center gap-1 rounded-lg border border-primary px-3 py-1 text-[13px] font-semibold text-primary"><Icon name="factory" size={16} /> Manufacturer register entry</Link> : null}
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Units declared" value={n(r?.declaredTotal ?? s.totalUnits ?? 0)} /><Fact label="QR serials bound" value={n(r?.boundTotal ?? null)} />
          <Fact label="Models needing review" value={review} /><Fact label="Margin" value={`${r?.marginPercent ?? 10}%`} />
        </div>
        {review ? <p className="mt-3 rounded-lg bg-[#fff4d6] px-3 py-2 text-[13px] text-[#8a4b00]">{review} model{review === 1 ? "" : "s"} declared more units than the QR serials bound to {review === 1 ? "its" : "their"} certificate{review === 1 ? "" : "s"}. A person should ask the manufacturer to explain the gap or generate and bind more QR codes.</p> : null}
      </div>
      <Box title="Model by model" testId="recon-box-models">
        {lines.length === 0 ? <p className="text-[13px] text-[#64748b]">No product row has been entered for this submission.</p> : (
          <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]"><table className="w-full text-[13px]">
            <caption className="sr-only">Declared units against bound QR serials for this submission</caption>
            <thead><tr className="bg-[#eef3fb]"><th className={th}>Model</th><th className={th}>Certificate</th><th className={th}>Declared units</th><th className={th}>Bound QR serials</th><th className={th}>Difference</th><th className={th}>Result</th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.key} className="border-t border-[#e7edf6]"><td className={`${td} font-semibold`}>{l.model}</td><td className={`${td} font-mono`}>{l.certificate}</td><td className={td}>{n(l.declared)}</td><td className={td}>{n(l.bound)}</td>
                <td className={`${td} ${l.gap !== null && l.gap < 0 ? "font-semibold text-[#93000a]" : ""}`}>{l.gap === null ? "-" : l.gap > 0 ? `+${n(l.gap)}` : n(l.gap)}</td><td className={td}><Chip tone={l.flag}>{FLAG_WORD[l.flag]}</Chip></td></tr>
            ))}</tbody></table></div>
        )}
        {r ? <p className="mt-2 text-[12px] text-[#64748b]">{r.message}</p> : null}
      </Box>
    </div>
  );
}
