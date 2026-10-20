"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { manufacturerProfileHref, STATUS_FILTERS, useManufacturers, type ManufacturerProfile } from "@/lib/client/runtimeManufacturers";
import { registerHref } from "@/lib/client/runtimeRegisterRevocations";

/**
 * The register of manufacturers (permittees): who is registered, since when, in what status, and what they hold. Read from the same
 * Manufacturer 360 list as the profile screen, so both always agree. Local demonstration, not BEE rules.
 */

export const manufacturerEntryHref = (code: string) => `${registerHref()}?view=manufacturer&id=${encodeURIComponent(code)}`;

const TONE: Record<string, string> = {
  Compliant: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]",
  "Under observation": "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]",
  "On hold": "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]",
  "Registration pending": "bg-[#e7effb] text-[#14315E] border-[#c9d9f7]",
  Suspended: "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]",
  Revoked: "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]",
};
function Status({ value }: { value: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold leading-4 ${TONE[value] ?? TONE["Registration pending"]}`}>{value}</span>;
}

const th = "px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[#475569]";
const td = "px-3 py-2 align-top";
const card = "rounded-xl border border-[#dbe6f7] bg-white";
const sel = "mt-1 block rounded-lg border border-outline-variant bg-white px-3 py-2 text-[13px]";
const iso = (d: string | null) => { if (!d) return undefined; const t = new Date(d); return Number.isNaN(t.getTime()) ? undefined : `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
const location = (m: ManufacturerProfile) => [m.city, m.state].filter(Boolean).join(", ") || "-";
const approvedModels = (m: ManufacturerProfile) => m.models.filter((x) => x.status === "Approved").length;

export function ManufacturersPanel() {
  const read = useManufacturers();
  const all = read.phase === "ready" ? read.list : [];
  const [status, setStatus] = useState("");
  const [state, setState] = useState("");
  const [category, setCategory] = useState("");
  const rows = all.filter((m) => (!status || m.status === status) && (!state || m.state === state) && (!category || m.categories.includes(category)));
  const tools = useListTools({
    rows,
    text: (m) => `${m.name} ${m.code} ${m.permitteeNumber ?? ""} ${location(m)} ${m.status} ${m.categories.join(" ")}`,
    date: (m) => iso(m.since),
    sortValue: (m, k) => (k === "permittee" ? m.permitteeNumber ?? "" : k === "name" ? m.name : k === "loc" ? location(m) : k === "since" ? m.since ?? "" : k === "status" ? m.status : k === "brands" ? m.brands.length : approvedModels(m)),
    pageSize: 10,
  });
  const states = [...new Set(all.map((m) => m.state).filter((x): x is string => Boolean(x)))].sort();
  const categories = [...new Set(all.flatMap((m) => m.categories))].sort();
  const n = (st: string) => all.filter((m) => m.status === st).length;
  if (read.phase === "loading") return <p role="status" className="font-body-sm">Loading the manufacturers…</p>;
  if (read.phase === "failed") return <p role="alert" className="text-error font-body-sm">{read.message}</p>;
  return (
    <div className="space-y-space-sm" data-testid="mreg-panel">
      <ListToolbar tools={tools} searchLabel="Search manufacturers" placeholder="Name, permittee number, city or category" dateLabel="Registered"
        exportCsv={{ filename: "register-manufacturers", header: ["Permittee number", "Manufacturer", "Location", "Categories", "Registered since", "Status", "Brands", "Approved models"],
          rows: tools.visible.map((m) => [m.permitteeNumber ?? "", m.name, location(m), m.categories.join(", "), m.since ?? "", m.status, m.brands.length, approvedModels(m)]) }} />
      <div className="flex flex-wrap items-end gap-3" data-testid="mreg-filters">
        <label className="text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">Status
          <select value={status} onChange={(e) => { setStatus(e.target.value); tools.setPage(1); }} className={sel} data-testid="mreg-status">
            <option value="">All ({all.length})</option>
            {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s} ({n(s)})</option>)}
          </select>
        </label>
        <label className="text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">State
          <select value={state} onChange={(e) => { setState(e.target.value); tools.setPage(1); }} className={sel} data-testid="mreg-state">
            <option value="">All</option>{states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">Category
          <select value={category} onChange={(e) => { setCategory(e.target.value); tools.setPage(1); }} className={sel} data-testid="mreg-category">
            <option value="">All</option>{categories.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {status || state || category ? <button type="button" className="rounded-lg border border-outline-variant bg-white px-3 py-2 text-[13px] font-semibold text-primary" onClick={() => { setStatus(""); setState(""); setCategory(""); tools.setPage(1); }}>Clear filters</button> : null}
      </div>
      {tools.visible.length === 0 ? <p className="font-body-sm text-on-surface-variant">No manufacturer matches these filters.</p> : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-[13px]" data-testid="mreg-table">
            <caption className="sr-only">Registered manufacturers</caption>
            <thead><tr className="bg-[#eef3fb]">
              <SortableTh tools={tools} k="permittee" className={th}>Permittee no.</SortableTh><SortableTh tools={tools} k="name" className={th}>Manufacturer</SortableTh>
              <SortableTh tools={tools} k="loc" className={th}>Location</SortableTh><th className={th}>Categories</th>
              <SortableTh tools={tools} k="since" className={th}>Registered since</SortableTh><SortableTh tools={tools} k="status" className={th}>Status</SortableTh>
              <SortableTh tools={tools} k="brands" className={th}>Brands</SortableTh><SortableTh tools={tools} k="models" className={th}>Approved models</SortableTh>
              <th className={th}><span className="sr-only">Open</span></th>
            </tr></thead>
            <tbody>
              {tools.paged.pageRows.map((m) => (
                <tr key={m.id} className="border-t border-[#e7edf6] hover:bg-[#f4f8ff]" data-testid={`mreg-row-${m.code}`}>
                  <td className={`${td} font-mono`}>{m.permitteeNumber ?? "-"}</td>
                  <td className={`${td} font-semibold`}><Link href={manufacturerEntryHref(m.code)} className="text-primary hover:underline" data-testid={`mreg-open-${m.code}`}>{m.name}</Link><div className="text-[12px] font-normal text-[#64748b]">{m.code}</div></td>
                  <td className={td}>{location(m)}</td>
                  <td className={td}>{m.categories.join(", ") || "-"}</td>
                  <td className={td}>{m.since ?? "-"}</td>
                  <td className={td}><Status value={m.status} /></td>
                  <td className={td}>{m.brands.length}</td>
                  <td className={td}>{approvedModels(m)}</td>
                  <td className={td}><Link href={manufacturerEntryHref(m.code)} className="inline-flex items-center gap-1 font-semibold text-primary">Open <Icon name="arrow_forward" size={14} /></Link></td>
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

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">{label}</div><div className="mt-0.5 text-[14px] font-semibold text-[#14315E]">{value || "-"}</div></div>;
}

/** One manufacturer's register entry: identity, status and what it holds on the register. */
export function ManufacturerEntry({ code }: { code: string }) {
  const read = useManufacturers();
  const m = read.phase === "ready" ? read.list.find((x) => x.code === code || x.id === code) : undefined;
  const back = <Link href={`${registerHref()}?tab=manufacturers`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary" data-testid="mreg-back"><Icon name="arrow_back" size={16} /> All manufacturers</Link>;
  if (read.phase === "loading") return <p role="status" className="font-body-sm">Loading the manufacturer…</p>;
  if (read.phase === "failed") return <p role="alert" className="text-error font-body-sm">{read.message}</p>;
  if (!m) return <div className="space-y-space-sm">{back}<p className="font-body-sm text-on-surface-variant">No such manufacturer is on the register.</p></div>;
  const onHold = m.brands.filter((b) => b.status !== "active");
  return (
    <div className="space-y-space-md" data-testid="mreg-entry">
      {back}
      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div role="heading" aria-level={2} className="text-[22px] font-extrabold text-[#14315E]">{m.name}</div>
            <div className="text-[14px] text-[#475569]">{m.permitteeNumber ? `Permittee ${m.permitteeNumber}` : "Not yet a permittee"}{m.since ? ` · registered ${m.since}` : ""}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Status value={m.status} />
            <Link href={manufacturerProfileHref(m.code)} className="inline-flex items-center gap-1 rounded-lg border border-primary px-3 py-1 text-[13px] font-semibold text-primary" data-testid="mreg-open-360"><Icon name="hub" size={16} /> Open Manufacturer 360 profile</Link>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Location" value={location(m)} />
          <Fact label="Categories" value={m.categories.join(", ")} />
          <Fact label="Brands" value={`${m.brands.length}${onHold.length ? ` (${onHold.length} suspended or revoked)` : ""}`} />
          <Fact label="Approved models" value={approvedModels(m)} />
        </div>
      </div>

      <Box title="Company" testId="mreg-box-company">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="CIN" value={m.cin} /><Fact label="GSTIN" value={m.gstin} /><Fact label="Application" value={m.applicationReference} />
          <div className="sm:col-span-2 lg:col-span-3"><Fact label="Registered office" value={m.address} /></div>
          <Fact label="Authorised signatory" value={[m.signatory.name, m.signatory.designation].filter(Boolean).join(", ")} />
          <Fact label="Email" value={m.signatory.email} /><Fact label="Phone" value={m.signatory.phone} />
        </div>
        {m.observation ? <p className="mt-3 rounded-lg bg-[#fff4d6] px-3 py-2 text-[13px] text-[#8a4b00]">Under observation from {m.observation.start} to {m.observation.end} ({m.observation.daysLeft} days left).</p> : null}
      </Box>

      <Box title={`Brands (${m.brands.length})`} testId="mreg-box-brands">
        {m.brands.length === 0 ? <p className="text-[13px] text-[#64748b]">No brand is registered.</p> : (
          <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]"><table className="w-full text-[13px]">
            <caption className="sr-only">Brands of this manufacturer</caption>
            <thead><tr className="bg-[#eef3fb]"><th className={th}>Brand</th><th className={th}>Status</th><th className={th}>Reason for status</th><th className={th}>Agency authorisations</th></tr></thead>
            <tbody>{m.brands.map((b) => (
              <tr key={b.id} className="border-t border-[#e7edf6]"><td className={`${td} font-semibold`}><Link href={`${registerHref()}?view=brand&id=${encodeURIComponent(b.id)}`} className="text-primary hover:underline">{b.name}</Link></td>
                <td className={td}><Status value={b.status === "active" ? "Compliant" : b.status === "suspended" ? "Suspended" : "Revoked"} /></td>
                <td className={`${td} max-w-md text-[#475569]`}>{b.status === "active" ? "-" : b.reason ?? "No reason recorded."}</td><td className={td}>{b.authorisations}</td></tr>
            ))}</tbody></table></div>
        )}
      </Box>

      <Box title={`Models (${m.models.length})`} testId="mreg-box-models" defaultOpen={false}>
        {m.models.length === 0 ? <p className="text-[13px] text-[#64748b]">No model application yet.</p> : (
          <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]"><table className="w-full text-[13px]">
            <caption className="sr-only">Models of this manufacturer</caption>
            <thead><tr className="bg-[#eef3fb]"><th className={th}>Model</th><th className={th}>Application</th><th className={th}>Stage</th><th className={th}>Stars</th><th className={th}>Certificate</th><th className={th}>Valid to</th></tr></thead>
            <tbody>{m.models.map((x) => (
              <tr key={x.reference} className="border-t border-[#e7edf6]"><td className={`${td} font-semibold`}>{x.model}</td><td className={`${td} font-mono`}>{x.reference}</td><td className={td}>{x.status}</td>
                <td className={td}>{x.stars > 0 ? "★".repeat(x.stars) : "-"}</td><td className={td}>{x.certificate}</td><td className={td}>{x.validTo ?? "-"}</td></tr>
            ))}</tbody></table></div>
        )}
      </Box>

      <Box title="Register trail" testId="mreg-box-trail" defaultOpen={false}>
        {m.timeline.length === 0 ? <p className="text-[13px] text-[#64748b]">No recorded event.</p> : (
          <ol className="space-y-2">{m.timeline.map((t, i) => (
            <li key={i} className="rounded-lg border border-[#dbe6f7] bg-[#f9fbff] px-3 py-2 text-[13px]"><span className="font-semibold text-[#14315E]">{t.title}</span><span className="ml-2 text-[#64748b]">{t.date ?? ""}</span>{t.detail ? <div className="text-[#475569]">{t.detail}</div> : null}</li>
          ))}</ol>
        )}
      </Box>
    </div>
  );
}
