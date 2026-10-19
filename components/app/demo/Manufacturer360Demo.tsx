"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Pill } from "./DemoShell";
import {
  STATUS_FILTERS,
  findManufacturer,
  inr,
  useManufacturers,
  type ComplianceStatus,
  type ManufacturerProfile,
} from "@/lib/client/runtimeManufacturers";

const STATUS_STYLE: Record<ComplianceStatus, string> = {
  Compliant: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]",
  "Under observation": "bg-[#e7effb] text-[#14315E] border-[#c9d9f7]",
  "On hold": "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]",
  "Registration pending": "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]",
  Suspended: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]",
  Revoked: "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]",
};

function StatusChip({ status }: { status: ComplianceStatus }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>{status}</span>;
}

type DirectoryManufacturer = ManufacturerProfile;
const dash = (v: string | null | undefined) => (v && v.trim() ? v : "-");

function Collapsible({
  title,
  icon,
  badge,
  open,
  onToggle,
  children,
  testId,
}: {
  title: string;
  icon: string;
  badge?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  testId: string;
}) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-white shadow-sm overflow-hidden" data-testid={testId}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 bg-white px-space-md py-3 text-left hover:bg-surface-container-lowest"
        data-testid={`${testId}-toggle`}
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon name={icon} size={18} />
        </span>
        <span role="heading" aria-level={2} className="flex-1 font-title-sm font-semibold text-on-surface">{title}</span>
        {badge}
        <Icon name={open ? "expand_less" : "expand_more"} size={22} className="text-on-surface-variant" />
      </button>
      {open ? <div className="border-t border-border-subtle p-space-md">{children}</div> : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-on-surface-variant">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-on-surface break-words">{children}</div>
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-on-surface-variant">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 align-top">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const BRAND_TONE: Record<string, string> = {
  active: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]",
  suspended: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]",
  revoked: "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]",
};
function BrandChip({ status }: { status: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${BRAND_TONE[status] ?? ""}`}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>;
}

function Stars({ n }: { n: number }) {
  return <span className="whitespace-nowrap text-[#b7791f]" aria-label={`${n} stars`}>{"★".repeat(n)}<span className="text-outline-variant">{"★".repeat(5 - n)}</span></span>;
}

const SECTION_IDS = ["company", "registration", "brands", "models", "fees", "qr", "documents", "compliance", "advisory", "activity"] as const;
type SectionId = (typeof SECTION_IDS)[number];

function Profile({ m, back }: { m: DirectoryManufacturer; back: () => void }) {
  const [open, setOpen] = useState<Record<SectionId, boolean>>({
    company: true, registration: true, brands: false, models: false, fees: false, qr: false, documents: false, compliance: true, advisory: false, activity: false,
  });
  const toggle = (id: SectionId) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const setAll = (v: boolean) => setOpen(Object.fromEntries(SECTION_IDS.map((s) => [s, v])) as Record<SectionId, boolean>);
  const sec = (id: SectionId, title: string, icon: string, children: ReactNode, badge?: ReactNode) => (
    <Collapsible key={id} testId={`m360-section-${id}`} title={title} icon={icon} open={open[id]} onToggle={() => toggle(id)} badge={badge}>
      {children}
    </Collapsible>
  );
  const approved = m.models.filter((x) => x.status === "Approved").length;
  const openAnomalies = m.anomalies.filter((a) => a.status === "Open").length;
  const qrPct = m.qr.issued ? Math.round((m.qr.bound / m.qr.issued) * 100) : 0;
  const count = (n: number, label: string) => <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{n} {label}</span>;

  const kpis: { key: string; label: string; value: string | number }[] = [
    { key: "brands", label: "Brands", value: m.brands.length },
    { key: "models", label: "Approved models", value: approved },
    { key: "qr", label: "QR issued / used", value: `${m.qr.issued.toLocaleString("en-IN")} / ${m.qr.bound.toLocaleString("en-IN")}` },
    { key: "fees-paid", label: "Fees paid", value: inr(m.fees.paid) },
    { key: "fees-out", label: "Fees outstanding", value: inr(m.fees.outstanding) },
    { key: "anomalies", label: "Open anomalies", value: openAnomalies },
    { key: "brand-holds", label: "Brands suspended or revoked", value: m.brands.filter((b) => b.status !== "active").length },
  ];

  return (
    <div className="space-y-space-md" data-testid="m360-profile">
      <button type="button" onClick={back} className="inline-flex items-center gap-1 bg-white text-sm font-semibold text-primary hover:underline" data-testid="m360-back">
        <Icon name="arrow_back" size={16} /> All manufacturers
      </button>

      <div className="rounded-2xl bg-gradient-to-r from-forest-dark to-primary text-on-primary shadow-md p-space-md lg:p-space-lg" data-testid="m360-header">
        <div className="flex flex-wrap items-start justify-between gap-space-md">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.14em] text-on-primary/70">Manufacturer 360 profile</p>
            <div role="heading" aria-level={2} className="mt-1 text-2xl font-bold">{m.name}</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {m.city || m.state ? <span className="rounded-full bg-white/15 px-2.5 py-1">{[m.city, m.state].filter(Boolean).join(", ")}</span> : null}
              {m.categories.length ? <span className="rounded-full bg-white/15 px-2.5 py-1">{m.categories.join(" · ")}</span> : null}
              <span className="rounded-full bg-white/15 px-2.5 py-1">Permittee {dash(m.permitteeNumber)}</span>
              <span className="rounded-full bg-white/15 px-2.5 py-1">Since {dash(m.since)}</span>
            </div>
          </div>
          <div className="rounded-xl bg-white/95 px-3 py-2 shadow-sm"><StatusChip status={m.status} /></div>
        </div>
        <div className="mt-space-md grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {kpis.map((k) => (
            <div key={k.key} className="rounded-xl bg-white/10 px-3 py-2" data-testid={`m360-kpi-${k.key}`}>
              <div className="text-[11px] uppercase tracking-wide text-on-primary/70">{k.label}</div>
              <div className="mt-0.5 text-lg font-bold tabular-nums">{k.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-on-surface-variant">Open a section to see the detail.</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setAll(true)} className="rounded-lg border border-outline-variant bg-white px-3 py-1.5 text-sm font-semibold hover:bg-surface-container-low" data-testid="m360-expand-all">Expand all</button>
          <button type="button" onClick={() => setAll(false)} className="rounded-lg border border-outline-variant bg-white px-3 py-1.5 text-sm font-semibold hover:bg-surface-container-low" data-testid="m360-collapse-all">Collapse all</button>
        </div>
      </div>

      {sec("company", "Company profile", "corporate_fare",
        <div className="space-y-space-md">
          <div className="grid gap-space-md sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Legal name">{m.name}</Fact>
            <Fact label="CIN">{dash(m.cin)}</Fact>
            <Fact label="GSTIN">{dash(m.gstin)}</Fact>
            <div className="sm:col-span-2 lg:col-span-3"><Fact label="Registered office">{dash(m.address)}</Fact></div>
          </div>
          <div>
            <div role="heading" aria-level={3} className="mb-2 text-sm font-semibold text-on-surface">Authorised signatory</div>
            <div className="grid gap-space-md sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Name">{dash(m.signatory.name)}</Fact>
              <Fact label="Designation">{dash(m.signatory.designation)}</Fact>
              <Fact label="Email">{dash(m.signatory.email)}</Fact>
              <Fact label="Phone">{dash(m.signatory.phone)}</Fact>
            </div>
          </div>
          <div>
            <div role="heading" aria-level={3} className="mb-2 text-sm font-semibold text-on-surface">Manufacturing facilities</div>
            <Table head={["Facility", "Location", "Capacity"]} rows={m.facilities.map((f) => [f.name, f.location || "-", f.capacity])} empty="No facility recorded." />
          </div>
        </div>,
      )}

      {sec("registration", "Registration and activation", "verified",
        <div className="grid gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Status"><StatusChip status={m.status} /></Fact>
          <Fact label="Permittee number">{dash(m.permitteeNumber)}</Fact>
          <Fact label="Registered since">{dash(m.since)}</Fact>
          <Fact label="Observation window">{m.observation ? `${m.observation.start} to ${m.observation.end}` : m.applicationReference ? "Completed" : "Not applicable"}</Fact>
          {m.observation ? <Fact label="Days remaining">{m.observation.daysLeft}</Fact> : null}
        </div>,
      )}

      {sec("brands", "Brands and categories", "sell",
        <Table
          head={["Brand", "Register status", "Reason", "Agencies"]}
          rows={m.brands.map((b) => [
            <span key="n" className="font-semibold">{b.name}</span>,
            <BrandChip key="s" status={b.status} />,
            b.status === "active" ? <span key="r" className="text-on-surface-variant">-</span> : <span key="r" data-testid={`m360-brand-reason-${b.id}`}>{b.reason ?? "No reason was recorded."}{b.changedOn ? ` (${b.changedOn})` : ""}</span>,
            b.authorisations,
          ])}
          empty="No brand registered yet."
        />,
        count(m.brands.length, "brands"),
      )}

      {sec("models", "Models and certificates", "workspace_premium",
        <Table
          head={["Reference", "Model", "Category", "Rating", "Status", "Certificate", "Valid to"]}
          rows={m.models.map((x) => [<span key="r" className="font-mono">{x.reference}</span>, x.model, x.category, <Stars key="s" n={x.stars} />, <Pill key="p">{x.status}</Pill>, x.certificate, x.validTo ?? "-"])}
          empty="No model application yet."
        />,
        count(m.models.length, "models"),
      )}

      {sec("fees", "Fees and payments", "payments",
        <div className="space-y-space-md">
          <div className="grid gap-space-md sm:grid-cols-3">
            <Fact label="Paid">{inr(m.fees.paid)}</Fact>
            <Fact label="Outstanding">{inr(m.fees.outstanding)}</Fact>
            <Fact label="Gateway">Simulated, no live transaction</Fact>
          </div>
          <Table
            head={["Receipt", "Date", "Purpose", "Amount", "Status"]}
            rows={m.fees.payments.map((p) => [<span key="r" className="font-mono">{p.receipt}</span>, p.date ?? "-", p.purpose, p.amount === null ? "-" : inr(p.amount), <Pill key="s">{p.status}</Pill>])}
            empty="No payment recorded."
          />
        </div>,
      )}

      {sec("qr", "QR serials and production", "qr_code_2",
        <div className="space-y-space-md">
          <div className="grid gap-space-md sm:grid-cols-4">
            <Fact label="Serials issued">{m.qr.issued.toLocaleString("en-IN")}</Fact>
            <Fact label="Bound to products">{m.qr.bound.toLocaleString("en-IN")}</Fact>
            <Fact label="Unused">{m.qr.unused.toLocaleString("en-IN")}</Fact>
            <Fact label="Use of issued serials">{qrPct}%</Fact>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high" aria-hidden="true">
            <div className="h-full rounded-full bg-primary" style={{ width: `${qrPct}%` }} />
          </div>
          <Table
            head={["Quarter", "Units declared", "Review"]}
            rows={m.production.map((p) => [p.period, p.declared.toLocaleString("en-IN"), <Pill key="s">{p.state}</Pill>])}
            empty="No production declared yet."
          />
        </div>,
      )}

      {sec("documents", "Documents on file", "folder_open",
        <Table head={["Document", "Status", "Date"]} rows={m.documents.map((d) => [d.name, <Pill key="s">{d.status === "Verified" ? "Verified" : d.status === "Missing" ? "Missing (failed)" : "Pending: " + d.status}</Pill>, d.date ?? "-"])} empty="No document on file." />,
        count(m.documents.length, "documents"),
      )}

      {sec("compliance", "Compliance, observation and anomalies", "policy",
        <Table
          head={["Date", "Raised by", "Anomaly", "Outcome"]}
          rows={m.anomalies.map((a) => [a.date ?? "-", a.raisedBy, a.summary, <Pill key="s">{a.status === "Open" ? "Open (pending)" : a.status === "Revoked" ? "Revoked" : "Cleared (accepted)"}</Pill>])}
          empty="No anomaly has been raised."
        />,
        openAnomalies ? <span className="rounded-full bg-[#fdecea] px-2 py-0.5 text-xs font-semibold text-[#93000a]">{openAnomalies} open</span> : count(0, "open"),
      )}

      {sec("advisory", "Advisory signals (simulated)", "psychology",
        <div className="space-y-2">
          <p className="text-xs text-on-surface-variant">Transparent rules over the data above. Advisory only: a person decides.</p>
          {m.flags.length === 0 ? <p className="text-sm text-on-surface-variant">No signal raised.</p> : null}
          {m.flags.map((f) => (
            <div key={f.label} className={`rounded-xl border px-3 py-2 text-sm ${f.level === "Attention" ? "border-[#f5c2c0] bg-[#fdecea]" : f.level === "Watch" ? "border-[#f3dc9c] bg-[#fff4d6]" : "border-border-subtle bg-surface-container-lowest"}`}>
              <span className="font-semibold">{f.level}: {f.label}.</span> {f.detail}
            </div>
          ))}
        </div>,
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Advisory</span>,
      )}

      {sec("activity", "Activity timeline", "timeline",
        <ol className="space-y-4">
          {m.timeline.map((t, i) => (
            <li key={`${t.date}-${t.title}-${i}`} className="relative flex gap-3">
              {i < m.timeline.length - 1 ? <span className="absolute left-[7px] top-5 bottom-[-16px] w-px bg-outline-variant" aria-hidden="true" /> : null}
              <span className="relative z-10 mt-1.5 h-4 w-4 shrink-0 rounded-full bg-primary/15 ring-4 ring-white"><span className="absolute inset-1 rounded-full bg-primary" /></span>
              <div>
                <div className="text-sm font-semibold text-on-surface">{t.title}</div>
                <div className="text-sm text-on-surface-variant">{t.detail}</div>
                <div className="text-xs text-on-surface-variant">{t.date ?? "-"}</div>
              </div>
            </li>
          ))}
        </ol>,
      )}

      <div className="rounded-2xl border border-border-subtle bg-white p-space-md shadow-sm" data-testid="m360-extra-links">
        <div role="heading" aria-level={2} className="mb-2 text-sm font-semibold text-on-surface">Related working screens</div>
        <ul className="flex flex-wrap gap-x-space-md gap-y-2">
          {[
            ["/app/registrations/requests", "Registration requests"],
            ["/app/registrations/register", "Register and revocation"],
            ["/app/model-label/model-dashboard", "Model dashboard"],
            ["/app/demo/payments", "Payments"],
            ["/app/demo/qr", "QR batches and serials"],
            ["/app/demo/production", "Quarterly production"],
            ["/app/demo/ledger", "Secure evidence ledger"],
            ["/verify", "Public verification"],
          ].map(([href, label]) => (
            <li key={href}>
              <Link href={href} className="text-sm font-semibold text-primary hover:underline">{label}</Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Directory({ list, onOpen, restricted }: { list: DirectoryManufacturer[]; onOpen: (id: string) => void; restricted: boolean }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [state, setState] = useState("");
  const categories = useMemo(() => [...new Set(list.flatMap((m) => m.categories))].sort(), [list]);
  const states = useMemo(() => [...new Set(list.map((m) => m.state).filter((x): x is string => !!x))].sort(), [list]);
  const needle = q.trim().toLowerCase();
  const shown = list
    .filter((m) => !status || m.status === status)
    .filter((m) => !category || m.categories.includes(category))
    .filter((m) => !state || m.state === state)
    .filter((m) => !needle || [m.name, m.code, m.city, m.state, m.cin, m.gstin, m.permitteeNumber, ...m.categories].filter(Boolean).join(" ").toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
  const tiles: { label: string; value: number; filter: string }[] = [
    { label: "All manufacturers", value: list.length, filter: "" },
    ...STATUS_FILTERS.map((s) => ({ label: s, value: list.filter((m) => m.status === s).length, filter: s })),
  ];
  const field = "rounded-xl border border-border-subtle bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

  return (
    <div className="space-y-space-md" data-testid="m360-directory">
      {!restricted ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
          {tiles.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => setStatus(t.filter)}
              className={`rounded-2xl border px-4 py-3 text-left shadow-sm transition-colors ${status === t.filter ? "border-primary bg-primary/10" : "border-border-subtle bg-white hover:bg-surface-container-lowest"}`}
              data-testid={`m360-tile-${t.label.toLowerCase().replace(/ /g, "-")}`}
            >
              <span className="block text-2xl font-bold tabular-nums text-on-surface">{t.value}</span>
              <span className="block text-xs text-on-surface-variant">{t.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="rounded-2xl border border-border-subtle bg-white p-space-md shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="relative md:col-span-2">
            <span className="sr-only">Search manufacturers</span>
            <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-2.5 text-on-surface-variant" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, city, CIN, GSTIN or permittee number"
              className={`${field} w-full !pl-10`}
              data-testid="m360-search"
            />
          </label>
          <label>
            <span className="sr-only">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${field} w-full`} data-testid="m360-filter-category">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">State</span>
            <select value={state} onChange={(e) => setState(e.target.value)} className={`${field} w-full`} data-testid="m360-filter-state">
              <option value="">All states</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={field} data-testid="m360-filter-status" aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="text-sm text-on-surface-variant" data-testid="m360-count">{shown.length} of {list.length} manufacturers</span>
          {(q || status || category || state) ? (
            <button type="button" onClick={() => { setQ(""); setStatus(""); setCategory(""); setState(""); }} className="rounded-lg border border-outline-variant bg-white px-3 py-1.5 text-sm font-semibold hover:bg-surface-container-low">Clear filters</button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="m360-table">
            <thead>
              <tr>
                {["Manufacturer", "Status", "Categories", "Models", "Permittee number", "Registered since", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id} className="cursor-pointer" onClick={() => onOpen(m.code)} data-testid={`m360-row-${m.code}`}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-on-surface">{m.name}</div>
                    <div className="text-xs text-on-surface-variant">{[m.city, m.state].filter(Boolean).join(", ") || "-"}</div>
                  </td>
                  <td className="px-4 py-3"><StatusChip status={m.status} /></td>
                  <td className="px-4 py-3">{m.categories.join(", ")}</td>
                  <td className="px-4 py-3 tabular-nums">{m.models.length}</td>
                  <td className="px-4 py-3"><span className="font-mono text-xs">{dash(m.permitteeNumber)}</span></td>
                  <td className="px-4 py-3">{dash(m.since)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-primary">View 360 <Icon name="arrow_forward" size={16} /></span>
                  </td>
                </tr>
              ))}
              {shown.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-on-surface-variant">No manufacturer matches the search or filters.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Manufacturer 360: a searchable directory of manufacturers and, for the one chosen, a collapsible 360-degree profile. */
export function Manufacturer360Demo() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("m");
  const read = useManufacturers();
  const list = read.phase === "ready" ? read.list : [];
  const applicantOnly = false;

  const open = (id: string | null) => router.push(id ? `${pathname}?m=${encodeURIComponent(id)}` : pathname);
  const chosen = selected ? findManufacturer(list, selected) : undefined;

  return (
    <div className="space-y-space-md max-w-6xl">
      <div role="heading" aria-level={1} className="font-headline-md text-headline-md font-bold text-on-surface">Manufacturer 360</div>
      {read.phase === "loading" ? <p className="text-sm text-on-surface-variant" data-testid="m360-loading">Loading manufacturers…</p> : null}
      {read.phase === "failed" ? <p className="text-sm text-error" data-testid="m360-error">{read.message}</p> : null}
      {read.phase === "ready" ? (chosen ? <Profile m={chosen} back={() => open(null)} key={chosen.id} /> : <Directory list={list} onOpen={(id) => open(id)} restricted={applicantOnly || list.length === 1} />) : null}
    </div>
  );
}
