"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Pill } from "./DemoShell";
import { demoGet, demoPath, type DemoBody } from "@/lib/client/runtimeDemo";
import { manufacturerProfileHref, useManufacturers, type ManufacturerProfile } from "@/lib/client/runtimeManufacturers";
import { type ModelApplication, modelDashboardHref, readModelApplicationList, stateLabel } from "@/lib/client/runtimeModelApplications";
import type { QrBatch } from "./QrDemo";

/**
 * One quarter at a glance for a manufacturer: the products it declared, the QR codes generated for each and their status, and the
 * result of BEE's testing. Everything is read from what the portal already holds; nothing is written here.
 * Local demonstration, not BEE rules.
 */

type Submission = { id: string; organisationName?: string; quarter: string; state: string; rowCount?: number; totalUnits?: number };
type Row = { id: string; registrationId: string; modelNumber: string; units: number; periodStart: string; periodEnd: string };
type Recon = { models: { modelApplicationId: string; modelNumber: string; registrationId: string; declaredUnits: number; boundSerials: number | null; flag: string }[]; marginPercent: number; message: string };

const card = "rounded-xl border border-[#dbe6f7] bg-white";
const th = "px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[#475569]";
const td = "px-3 py-2 align-top";
const STATE_WORD: Record<string, string> = { draft: "Draft", submitted: "Submitted", accepted: "Accepted", query: "Query raised" };

function Stat({ icon, label, value, note, tone = "text-[#14315E]" }: { icon: string; label: string; value: string | number; note: string; tone?: string }) {
  return (
    <div className={`${card} p-4`}>
      <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#64748b]"><Icon name={icon} size={16} />{label}</span>
      <span className={`mt-1 block text-[26px] font-extrabold leading-8 ${tone}`}>{value}</span>
      <span className="block text-[12px] text-[#64748b]">{note}</span>
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return <span aria-label={`${n} star`} className="whitespace-nowrap text-[#b45309]">{"★".repeat(n)}<span className="text-[#cbd5e1]">{"★".repeat(Math.max(0, 5 - n))}</span></span>;
}

const qrTone = (flag: string, bound: number | null) =>
  bound === null || flag === "unavailable" ? "bg-[#eef2f7] text-[#475569] border-[#d8e0ea]" : flag === "review" ? "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]" : "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]";

export function QuarterlySubmission() {
  const [subs, setSubs] = useState<Submission[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [batches, setBatches] = useState<QrBatch[]>([]);
  const [apps, setApps] = useState<ModelApplication[]>([]);
  const directory = useManufacturers();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([
      demoGet<DemoBody & { submissions: Submission[]; canCreate: boolean }>(demoPath("production")),
      demoGet<DemoBody & { items: QrBatch[] }>(demoPath("qr")),
      readModelApplicationList(),
    ]).then(([p, q, a]) => {
      if (!live) return;
      if (!p.ok) { setError(p.message); setSubs([]); return; }
      const sorted = [...(Array.isArray(p.value.submissions) ? p.value.submissions : [])].sort((x, y) => y.quarter.localeCompare(x.quarter));
      setSubs(sorted);
      setCanCreate(p.value.canCreate);
      if (q.ok && Array.isArray(q.value.items)) setBatches(q.value.items);
      if (a.ok) setApps(a.list.items);
    });
    return () => { live = false; };
  }, []);

  const selected = pick ?? subs?.[0]?.id ?? null;
  useEffect(() => {
    if (!selected) return;
    let live = true;
    void Promise.all([
      demoGet<DemoBody & { rows: Row[] }>(demoPath("production", selected)),
      demoGet<DemoBody & Recon>(demoPath("production", selected, "reconciliation")),
    ]).then(([d, r]) => {
      if (!live) return;
      setRows(d.ok && Array.isArray(d.value.rows) ? d.value.rows : []);
      setRecon(r.ok && Array.isArray(r.value.models) ? r.value : null);
    });
    return () => { live = false; };
  }, [selected]);

  const sub = subs?.find((s) => s.id === selected) ?? null;
  const org: ManufacturerProfile | undefined = directory.phase === "ready" ? directory.list.find((m) => m.name === sub?.organisationName?.replace(/\s*\(synthetic[^)]*\)\s*$/, "")) ?? (directory.list.length === 1 ? directory.list[0] : undefined) : undefined;

  const byReg = new Map<string, { model: string; units: number; periods: string[]; appId?: string; declared: number; bound: number | null; flag: string }>();
  for (const r of rows) {
    const e = byReg.get(r.registrationId) ?? { model: r.modelNumber, units: 0, periods: [], declared: 0, bound: null as number | null, flag: "unavailable" };
    e.units += r.units;
    e.periods.push(`${r.periodStart.slice(5, 7)}`);
    byReg.set(r.registrationId, e);
  }
  for (const m of recon?.models ?? []) {
    const e = byReg.get(m.registrationId);
    if (e) { e.appId = m.modelApplicationId; e.bound = m.boundSerials; e.flag = m.flag; e.declared = m.declaredUnits; }
  }
  const products = [...byReg.entries()].map(([reg, e]) => {
    const mine = batches.filter((b) => b.registrationId === reg);
    const gen = mine.reduce((n, b) => n + b.quantity, 0);
    const bound = mine.reduce((n, b) => n + b.bound, 0);
    const voided = mine.reduce((n, b) => n + b.void, 0);
    const app = apps.find((a) => a.id === e.appId);
    const rated = org?.models.find((m) => m.certificate === reg);
    return { reg, ...e, gen, boundAll: bound, voided, batches: mine.length, app, rated };
  });
  const totalUnits = products.reduce((n, p) => n + p.units, 0);
  const totalBound = products.reduce((n, p) => n + (p.bound ?? 0), 0);
  const tested = products.filter((p) => p.rated && p.rated.stars > 0).length;
  const inTesting = apps.filter((a) => !["approved", "rejected"].includes(a.state));
  const result = (ref: string) => org?.models.find((m) => m.reference === ref);

  if (subs === null) return <p role="status" className="font-body-sm">Loading the quarterly submission…</p>;
  return (
    <div className="space-y-space-md" data-testid="quarterly-submission">
      {error ? <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm font-body-sm">{error}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="heading" aria-level={2} className="text-[18px] font-bold text-[#14315E]">Quarter at a glance</div>
        {canCreate ? (
          <Link href="/app/model-label/new-model-application" className="inline-flex items-center gap-1 rounded-lg !bg-[#1f3c88] px-4 py-2 text-[13px] font-semibold !text-white hover:!bg-[#14315E]" data-testid="qs-submit-product">
            <Icon name="note_add" size={16} /> Submit a product for testing
          </Link>
        ) : null}
      </div>

      {subs.length === 0 ? <p className="font-body-sm text-on-surface-variant">No quarter has been submitted yet.</p> : (
        <>
          <div role="tablist" aria-label="Quarters" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {subs.slice(0, 4).map((s) => (
              <button key={s.id} role="tab" aria-selected={s.id === selected} onClick={() => setPick(s.id)} className="ai-tile" data-testid={`qs-quarter-${s.quarter}`}>
                <span className="ai-tile-title">{s.quarter}</span>
                <span className="ai-tile-blurb">{STATE_WORD[s.state] ?? s.state} · {(s.totalUnits ?? 0).toLocaleString("en-IN")} units</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="qs-summary">
            <Stat icon="inventory_2" label="Products" value={products.length} note="declared this quarter" />
            <Stat icon="factory" label="Units declared" value={totalUnits.toLocaleString("en-IN")} note={sub ? `${STATE_WORD[sub.state] ?? sub.state}` : ""} />
            <Stat icon="qr_code_2" label="QR serials bound" value={totalBound.toLocaleString("en-IN")} note="to certificates, all batches" />
            <Stat icon="rule" label="Needs review" value={products.filter((p) => p.flag === "review").length} note="declared above bound QR" tone={products.some((p) => p.flag === "review") ? "text-[#8a4b00]" : "text-[#14532d]"} />
            <Stat icon="verified" label="Tested and rated" value={`${tested} of ${products.length}`} note="with a star result" />
          </div>

          <div className={`${card} p-5`}>
            <div role="heading" aria-level={2} className="mb-1 text-[16px] font-bold text-[#14315E]">Products in {sub?.quarter}</div>
            <p className="mb-3 text-[13px] text-[#64748b]">Units declared for the quarter, the QR codes generated for each product and their status, and the BEE test result.</p>
            {products.length === 0 ? <p className="text-[13px] text-[#64748b]">No product rows have been entered for this quarter.</p> : (
              <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]">
                <table className="w-full text-[13px]" data-testid="qs-products">
                  <caption className="sr-only">Products declared in the quarter with QR status and test result</caption>
                  <thead><tr className="bg-[#eef3fb]">
                    <th className={th}>Model</th><th className={th}>Units declared</th><th className={th}>QR generated</th><th className={th}>QR bound</th><th className={th}>QR void</th><th className={th}>QR status</th><th className={th}>Test result</th>
                  </tr></thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.reg} className="border-t border-[#e7edf6]" data-testid={`qs-row-${p.reg}`}>
                        <td className={td}>
                          {p.appId ? <Link href={modelDashboardHref(p.appId)} className="font-semibold text-primary hover:underline">{p.model}</Link> : <span className="font-semibold text-[#14315E]">{p.model}</span>}
                          <div className="text-[12px] text-[#64748b]">{p.reg}</div>
                        </td>
                        <td className={td}>{p.units.toLocaleString("en-IN")}</td>
                        <td className={td}>{p.gen.toLocaleString("en-IN")}<div className="text-[12px] text-[#64748b]">{p.batches} batch{p.batches === 1 ? "" : "es"}</div></td>
                        <td className={td}>{p.boundAll.toLocaleString("en-IN")}</td>
                        <td className={td}>{p.voided}</td>
                        <td className={td}>
                          <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${qrTone(p.flag, p.bound)}`}>
                            {p.bound === null || p.flag === "unavailable" ? "Not available" : p.flag === "review" ? "Review: units above bound QR" : "Matches QR"}
                          </span>
                        </td>
                        <td className={td}>
                          {p.rated ? (<><Stars n={p.rated.stars} /><div className="text-[12px] text-[#64748b]">{p.rated.status}{p.app?.declaredIseer ? ` · declared ${p.app.declaredIseer}` : ""}</div></>) : <span className="text-[#64748b]">No result yet</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {recon ? <p className="mt-2 text-[12px] text-[#64748b]">{recon.message}</p> : null}
          </div>

          <div className={`${card} p-5`}>
            <div role="heading" aria-level={2} className="mb-1 text-[16px] font-bold text-[#14315E]">Products submitted for testing</div>
            <p className="mb-3 text-[13px] text-[#64748b]">Each model application is a product sent to BEE for testing. The result appears when the rating is computed and approved.</p>
            {apps.length === 0 ? <p className="text-[13px] text-[#64748b]">No product has been submitted for testing.</p> : (
              <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]">
                <table className="w-full text-[13px]" data-testid="qs-testing">
                  <caption className="sr-only">Model applications and their test status</caption>
                  <thead><tr className="bg-[#eef3fb]">
                    <th className={th}>Application</th><th className={th}>Model</th><th className={th}>Stage</th><th className={th}>Test lab</th><th className={th}>Tested on</th><th className={th}>Declared ISEER</th><th className={th}>Result</th>
                  </tr></thead>
                  <tbody>
                    {[...apps].sort((a, b) => Number(["approved", "rejected"].includes(a.state)) - Number(["approved", "rejected"].includes(b.state)) || a.reference.localeCompare(b.reference)).slice(0, 12).map((a) => {
                      const r = result(a.reference);
                      return (
                        <tr key={a.id} className="border-t border-[#e7edf6]">
                          <td className={`${td} font-mono`}><Link href={modelDashboardHref(a.id)} className="text-primary hover:underline">{a.reference}</Link></td>
                          <td className={td}>{a.brandName} {a.modelNumber}</td>
                          <td className={td}><Pill>{stateLabel(a.state)}</Pill></td>
                          <td className={td}>{a.laboratoryCode ?? "-"}</td>
                          <td className={td}>{a.testedOn ?? "-"}</td>
                          <td className={td}>{a.declaredIseer ?? "-"}</td>
                          <td className={td}>{r && r.stars > 0 ? <><Stars n={r.stars} /><div className="text-[12px] text-[#64748b]">{r.status}</div></> : <span className="text-[#64748b]">{["approved", "rejected"].includes(a.state) ? stateLabel(a.state) : "Awaiting result"}</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[12px] text-[#64748b]">{inTesting.length} in progress{org ? <> · <Link href={manufacturerProfileHref(org.code)} className="text-primary hover:underline">Open the Manufacturer 360 profile</Link></> : null}</p>
          </div>
        </>
      )}
    </div>
  );
}
