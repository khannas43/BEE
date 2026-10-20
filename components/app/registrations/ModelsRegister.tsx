"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { demoGet, demoPath, type DemoBody } from "@/lib/client/runtimeDemo";
import { manufacturerProfileHref, useManufacturers, type ManufacturerProfile } from "@/lib/client/runtimeManufacturers";
import { modelDashboardHref } from "@/lib/client/runtimeModelApplications";
import { registerHref } from "@/lib/client/runtimeRegisterRevocations";
import { ProductDetails } from "@/components/app/lifecycle/ProductDetails";
import { manufacturerEntryHref } from "@/components/app/registrations/ManufacturersRegister";
import type { QrBatch } from "@/components/app/demo/QrDemo";

/**
 * The register of models and their certificates: every certificate issued, and every model still on its way to one. Certificates come
 * from the certificate ledger list, models from the Manufacturer 360 list, so the register agrees with both. Local demonstration.
 */

type LedgerRow = { certificateId: string; registrationId: string; manufacturer: string; brandName: string; modelNumber: string; category?: string; stars?: number; validFrom?: string; validTo: string; ledgerValidTo: string; ledgerStatus: string };
type Status = "Valid" | "Expiring soon" | "Expired" | "Revoked" | "Awaiting approval" | "Returned" | "Rejected";
type Item = {
  key: string; certificate: string | null; certificateId: string | null; model: string; brand: string; manufacturer: string; manufacturerCode: string; category: string;
  stars: number; validFrom: string | null; validTo: string | null; ledgerValidTo: string | null; ledger: string; status: Status; stage: string; reference: string | null; applicationId: string | null;
};

export const modelEntryHref = (key: string) => `${registerHref()}?view=model&id=${encodeURIComponent(key)}`;

const TODAY = () => new Date().toISOString().slice(0, 10);
const LEDGER_WORD: Record<string, string> = { not_submitted: "Issued, awaiting ledger record", pending: "Pending", active: "Active", failed: "Failed", revoked: "Revoked", amended: "Amended" };
const TONE: Record<string, string> = {
  Valid: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]", "Expiring soon": "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]", Expired: "bg-[#eef2f7] text-[#475569] border-[#d8e0ea]",
  Revoked: "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]", "Awaiting approval": "bg-[#e7effb] text-[#14315E] border-[#c9d9f7]", Returned: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]", Rejected: "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]",
  Active: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]", Pending: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]", Failed: "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]",
  Amended: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]", "Issued, awaiting ledger record": "bg-[#eef2f7] text-[#475569] border-[#d8e0ea]",
};
function Chip({ value }: { value: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold leading-4 ${TONE[value] ?? TONE["Awaiting approval"]}`}>{value}</span>;
}
const th = "px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[#475569]";
const td = "px-3 py-2 align-top";
const card = "rounded-xl border border-[#dbe6f7] bg-white";
const sel = "mt-1 block rounded-lg border border-outline-variant bg-white px-3 py-2 text-[13px]";
const Stars = ({ n }: { n: number }) => (n > 0 ? <span className="whitespace-nowrap text-[#b45309]" aria-label={`${n} star`}>{"★".repeat(n)}<span className="text-[#cbd5e1]">{"★".repeat(Math.max(0, 5 - n))}</span></span> : <span className="text-[#64748b]">-</span>);

function certStatus(revoked: boolean, validTo: string | null): Status {
  if (revoked) return "Revoked";
  if (validTo && validTo < TODAY()) return "Expired";
  if (validTo && validTo < new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10)) return "Expiring soon";
  return "Valid";
}

/** Certificates (from the ledger list) and models without one (from the manufacturer list), as one list. */
export function useModelRegister(): { phase: "loading" | "failed" | "ready"; items: Item[]; message: string; manufacturers: ManufacturerProfile[] } {
  const dir = useManufacturers();
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    void demoGet<DemoBody & { certificates: LedgerRow[] }>(demoPath("ledger")).then((r) => {
      if (!live) return;
      if (r.ok && Array.isArray(r.value.certificates)) setLedger(r.value.certificates); else { setLedger([]); if (!r.ok) setMessage(r.message); }
    });
    return () => { live = false; };
  }, []);
  if (dir.phase === "failed") return { phase: "failed", items: [], message: dir.message, manufacturers: [] };
  if (dir.phase === "loading" || ledger === null) return { phase: "loading", items: [], message, manufacturers: [] };
  const orgs = dir.list;
  const byCert = new Map<string, { org: ManufacturerProfile; m: ManufacturerProfile["models"][number] }>();
  for (const o of orgs) for (const m of o.models) if (m.certificate !== "Not issued") byCert.set(m.certificate, { org: o, m });
  const items: Item[] = ledger.map((c) => {
    const hit = byCert.get(c.registrationId);
    return {
      key: c.registrationId, certificate: c.registrationId, certificateId: c.certificateId, model: c.modelNumber, brand: c.brandName,
      manufacturer: (hit?.org.name ?? c.manufacturer).replace(/\s*\(synthetic[^)]*\)\s*$/, ""), manufacturerCode: hit?.org.code ?? "", category: c.category ?? hit?.m.category ?? "RAC",
      stars: c.stars ?? hit?.m.stars ?? 0, validFrom: c.validFrom ?? null, validTo: c.validTo, ledgerValidTo: c.ledgerValidTo, ledger: LEDGER_WORD[c.ledgerStatus] ?? c.ledgerStatus,
      status: certStatus(c.ledgerStatus === "revoked", c.validTo), stage: "Certificate issued", reference: hit?.m.reference ?? null, applicationId: hit?.m.applicationId ?? null,
    };
  });
  for (const o of orgs) for (const m of o.models) {
    if (m.certificate !== "Not issued") continue;
    items.push({
      key: m.reference, certificate: null, certificateId: null, model: m.model, brand: m.brandName ?? "-", manufacturer: o.name, manufacturerCode: o.code, category: m.category || "RAC",
      stars: m.stars, validFrom: null, validTo: null, ledgerValidTo: null, ledger: "-", status: m.status === "Rejected" ? "Rejected" : m.status === "Returned" ? "Returned" : "Awaiting approval", stage: m.status, reference: m.reference, applicationId: m.applicationId,
    });
  }
  return { phase: "ready", items, message, manufacturers: orgs };
}

export function ModelsPanel() {
  const reg = useModelRegister();
  const items = reg.items;
  const [status, setStatus] = useState("");
  const [ledger, setLedger] = useState("");
  const [stars, setStars] = useState("");
  const [category, setCategory] = useState("");
  const [maker, setMaker] = useState("");
  const rows = items.filter((i) => (!status || i.status === status) && (!ledger || i.ledger === ledger) && (!stars || String(i.stars) === stars) && (!category || i.category === category) && (!maker || i.manufacturer === maker));
  const tools = useListTools({
    rows,
    text: (i) => `${i.certificate ?? ""} ${i.model} ${i.brand} ${i.manufacturer} ${i.category} ${i.status} ${i.reference ?? ""}`,
    date: (i) => i.validTo ?? undefined,
    sortValue: (i, k) => (k === "cert" ? i.certificate ?? "~" : k === "model" ? i.model : k === "brand" ? i.brand : k === "mfr" ? i.manufacturer : k === "stars" ? i.stars : k === "to" ? i.validTo ?? "" : k === "status" ? i.status : i.ledger),
    pageSize: 12,
  });
  if (reg.phase === "loading") return <p role="status" className="font-body-sm">Loading models and certificates…</p>;
  if (reg.phase === "failed") return <p role="alert" className="text-error font-body-sm">{reg.message}</p>;
  const n = (st: Status) => items.filter((i) => i.status === st).length;
  const makers = [...new Set(items.map((i) => i.manufacturer))].sort();
  const ledgers = [...new Set(items.map((i) => i.ledger).filter((x) => x !== "-"))].sort();
  const categories = [...new Set(items.map((i) => i.category))].sort();
  const tile = (label: string, value: number, note: string, st: Status | "", tone = "text-[#14315E]") => (
    <button type="button" onClick={() => { setStatus(status === st ? "" : st); tools.setPage(1); }} aria-pressed={status === st && st !== ""} className={`${card} p-4 text-left hover:border-[#9dbdec] ${status === st && st !== "" ? "border-[#254e9e] ring-2 ring-[#c9d9f7]" : ""}`}>
      <span className="block text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">{label}</span>
      <span className={`block text-[26px] font-extrabold leading-8 ${tone}`}>{value}</span><span className="block text-[12px] text-[#64748b]">{note}</span>
    </button>
  );
  return (
    <div className="space-y-space-sm" data-testid="modreg-panel">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7" data-testid="modreg-summary">
        {tile("Valid", n("Valid"), "certificates in force", "Valid", "text-[#14532d]")}
        {tile("Expiring soon", n("Expiring soon"), "within 90 days", "Expiring soon", "text-[#8a4b00]")}
        {tile("Expired", n("Expired"), "past their end date", "Expired")}
        {tile("Revoked", n("Revoked"), "withdrawn on the ledger", "Revoked", "text-[#93000a]")}
        {tile("Awaiting approval", n("Awaiting approval"), "application under review", "Awaiting approval")}
        {tile("Returned", n("Returned"), "sent back to the applicant", "Returned", "text-[#8a4b00]")}
        {tile("Rejected", n("Rejected"), "application not approved", "Rejected", "text-[#93000a]")}
      </div>
      <ListToolbar tools={tools} searchLabel="Search models and certificates" placeholder="Certificate, model, brand or manufacturer" dateLabel="Valid to"
        exportCsv={{ filename: "register-models-certificates", header: ["Certificate", "Model", "Brand", "Manufacturer", "Category", "Stars", "Valid from", "Valid to", "Status", "Ledger"],
          rows: tools.visible.map((i) => [i.certificate ?? "", i.model, i.brand, i.manufacturer, i.category, i.stars, i.validFrom ?? "", i.validTo ?? "", i.status, i.ledger]) }} />
      <div className="flex flex-wrap items-end gap-3" data-testid="modreg-filters">
        {([["Status", status, setStatus, ["Valid", "Expiring soon", "Expired", "Revoked", "Awaiting approval", "Returned", "Rejected"], "modreg-status"], ["Ledger", ledger, setLedger, ledgers, "modreg-ledger"], ["Stars", stars, setStars, ["5", "4", "3", "2", "1"], "modreg-stars"], ["Category", category, setCategory, categories, "modreg-category"], ["Manufacturer", maker, setMaker, makers, "modreg-maker"]] as [string, string, (v: string) => void, string[], string][]).map(([label, value, set, opts, id]) => (
          <label key={id} className="text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">{label}
            <select value={value} onChange={(e) => { set(e.target.value); tools.setPage(1); }} className={sel} data-testid={id}>
              <option value="">All</option>{opts.map((o) => <option key={o} value={o}>{label === "Stars" ? `${o} star` : o}</option>)}
            </select>
          </label>
        ))}
        {status || ledger || stars || category || maker ? <button type="button" className="rounded-lg border border-outline-variant bg-white px-3 py-2 text-[13px] font-semibold text-primary" onClick={() => { setStatus(""); setLedger(""); setStars(""); setCategory(""); setMaker(""); tools.setPage(1); }}>Clear filters</button> : null}
      </div>
      {tools.visible.length === 0 ? <p className="font-body-sm text-on-surface-variant">No model or certificate matches these filters.</p> : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-[13px]" data-testid="modreg-table">
            <caption className="sr-only">Models and their certificates</caption>
            <thead><tr className="bg-[#eef3fb]">
              <SortableTh tools={tools} k="cert" className={th}>Certificate</SortableTh><SortableTh tools={tools} k="model" className={th}>Model</SortableTh><SortableTh tools={tools} k="brand" className={th}>Brand</SortableTh>
              <SortableTh tools={tools} k="mfr" className={th}>Manufacturer</SortableTh><SortableTh tools={tools} k="stars" className={th}>Stars</SortableTh><SortableTh tools={tools} k="to" className={th}>Valid to</SortableTh>
              <SortableTh tools={tools} k="status" className={th}>Status</SortableTh><SortableTh tools={tools} k="ledger" className={th}>Ledger</SortableTh><th className={th}><span className="sr-only">Open</span></th>
            </tr></thead>
            <tbody>
              {tools.paged.pageRows.map((i) => (
                <tr key={i.key} className="border-t border-[#e7edf6] hover:bg-[#f4f8ff]" data-testid={`modreg-row-${i.key}`}>
                  <td className={`${td} font-mono`}>{i.certificate ?? "Not issued"}</td>
                  <td className={`${td} font-semibold`}><Link href={modelEntryHref(i.key)} className="text-primary hover:underline" data-testid={`modreg-open-${i.key}`}>{i.model}</Link><div className="text-[12px] font-normal text-[#64748b]">{i.category}{i.certificate === null ? ` · ${i.stage}` : ""}</div></td>
                  <td className={td}>{i.brand}</td><td className={td}>{i.manufacturer}</td><td className={td}><Stars n={i.stars} /></td>
                  <td className={td}>{i.validTo ?? "-"}</td><td className={td}><Chip value={i.status} /></td><td className={td}>{i.ledger === "-" ? "-" : <Chip value={i.ledger} />}</td>
                  <td className={td}><Link href={modelEntryHref(i.key)} className="inline-flex items-center gap-1 font-semibold text-primary">Open <Icon name="arrow_forward" size={14} /></Link></td>
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

function Box({ title, testId, children, defaultOpen = true }: { title: string; testId: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`${card} p-5`} data-testid={testId}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-left">
        <span role="heading" aria-level={2} className="text-[16px] font-bold text-[#14315E]">{title}</span>
        <Icon name={open ? "expand_less" : "expand_more"} size={22} className="text-[#475569]" />
      </button>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
const Fact = ({ label, value }: { label: string; value: ReactNode }) => <div><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">{label}</div><div className="mt-0.5 text-[14px] font-semibold text-[#14315E]">{value || "-"}</div></div>;

/** One model's register entry: its certificate, brand, manufacturer, ledger standing and QR codes. */
export function ModelEntry({ id }: { id: string }) {
  const reg = useModelRegister();
  const [batches, setBatches] = useState<QrBatch[]>([]);
  useEffect(() => {
    let live = true;
    void demoGet<DemoBody & { items: QrBatch[] }>(demoPath("qr")).then((r) => { if (live && r.ok && Array.isArray(r.value.items)) setBatches(r.value.items); });
    return () => { live = false; };
  }, []);
  const back = <Link href={`${registerHref()}?tab=models`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary" data-testid="modreg-back"><Icon name="arrow_back" size={16} /> All models and certificates</Link>;
  if (reg.phase === "loading") return <p role="status" className="font-body-sm">Loading the model…</p>;
  if (reg.phase === "failed") return <p role="alert" className="text-error font-body-sm">{reg.message}</p>;
  const i = reg.items.find((x) => x.key === id);
  if (!i) return <div className="space-y-space-sm">{back}<p className="font-body-sm text-on-surface-variant">No such model or certificate is on the register.</p></div>;
  const owner = reg.manufacturers.find((m) => m.code === i.manufacturerCode);
  const brand = owner?.brands.find((b) => b.name === i.brand);
  const mine = batches.filter((b) => i.certificate && b.registrationId === i.certificate);
  const sum = (f: (b: QrBatch) => number) => mine.reduce((n, b) => n + f(b), 0);
  return (
    <div className="space-y-space-md" data-testid="modreg-entry">
      {back}
      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div role="heading" aria-level={2} className="text-[22px] font-extrabold text-[#14315E]">{i.model}</div>
            <div className="text-[14px] text-[#475569]">{i.brand} · {i.manufacturer} · {i.category}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip value={i.status} />
            {i.applicationId ? <Link href={modelDashboardHref(i.applicationId)} className="inline-flex items-center gap-1 rounded-lg border border-primary px-3 py-1 text-[13px] font-semibold text-primary" data-testid="modreg-open-application"><Icon name="open_in_new" size={16} /> Open application record</Link> : null}
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Certificate" value={i.certificate ?? "Not issued yet"} /><Fact label="Star rating" value={<Stars n={i.stars} />} />
          <Fact label="Valid from" value={i.validFrom} /><Fact label="Valid to" value={i.validTo} />
        </div>
        {i.certificate === null ? <p className="mt-3 rounded-lg bg-[#e7effb] px-3 py-2 text-[13px] text-[#14315E]">This model has no certificate yet. Its application is at the stage: {i.stage}.</p> : null}
      </div>

      <Box title="Certificate and ledger" testId="modreg-box-ledger">
        {i.certificateId ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Ledger status" value={<Chip value={i.ledger} />} /><Fact label="Ledger valid to" value={<>{i.ledgerValidTo}{i.ledgerValidTo !== i.validTo ? <span className="ml-1 text-[#8a4b00]">(differs)</span> : null}</>} />
            <Fact label="Reference" value={i.reference} />
            <div className="self-end"><Link href={`/app/demo/ledger?cert=${encodeURIComponent(i.certificateId)}`} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" data-testid="modreg-open-ledger"><Icon name="link" size={16} /> Open on the certificate ledger</Link></div>
          </div>
        ) : <p className="text-[13px] text-[#64748b]">A certificate is placed on the ledger once the model is approved.</p>}
      </Box>

      {i.applicationId ? <ProductDetails applicationId={i.applicationId} /> : null}

      <Box title="QR codes" testId="modreg-box-qr" defaultOpen={false}>
        {mine.length === 0 ? <p className="text-[13px] text-[#64748b]">No QR batch has been generated for this certificate.</p> : (
          <div className="space-y-3">
            <div className="grid gap-4 sm:grid-cols-4"><Fact label="Batches" value={mine.length} /><Fact label="Generated" value={sum((b) => b.quantity).toLocaleString("en-IN")} /><Fact label="Bound" value={sum((b) => b.bound).toLocaleString("en-IN")} /><Fact label="Void" value={sum((b) => b.void)} /></div>
            <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]"><table className="w-full text-[13px]"><caption className="sr-only">QR batches for this certificate</caption>
              <thead><tr className="bg-[#eef3fb]"><th className={th}>Batch</th><th className={th}>Quantity</th><th className={th}>Bound</th><th className={th}>Void</th><th className={th}>Created</th></tr></thead>
              <tbody>{mine.map((b) => <tr key={b.id} className="border-t border-[#e7edf6]"><td className={`${td} font-mono`}>{b.reference}</td><td className={td}>{b.quantity}</td><td className={td}>{b.bound}</td><td className={td}>{b.void}</td><td className={td}>{b.createdAt?.slice(0, 10)}</td></tr>)}</tbody></table></div>
          </div>
        )}
      </Box>

      <Box title="Brand and manufacturer" testId="modreg-box-owner">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Brand" value={brand ? <Link href={`${registerHref()}?view=brand&id=${encodeURIComponent(brand.id)}`} className="text-primary hover:underline">{i.brand}</Link> : i.brand} />
          <Fact label="Manufacturer" value={i.manufacturerCode ? <Link href={manufacturerEntryHref(i.manufacturerCode)} className="text-primary hover:underline">{i.manufacturer}</Link> : i.manufacturer} />
          <Fact label="Permittee number" value={owner?.permitteeNumber} />
          <div className="self-end">{i.manufacturerCode ? <Link href={manufacturerProfileHref(i.manufacturerCode)} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"><Icon name="hub" size={16} /> Manufacturer 360 profile</Link> : null}</div>
        </div>
      </Box>
    </div>
  );
}
