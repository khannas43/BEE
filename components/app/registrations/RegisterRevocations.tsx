"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ModelEntry, ModelsPanel, useModelRegister } from "@/components/app/registrations/ModelsRegister";
import { ManufacturerEntry, ManufacturersPanel } from "@/components/app/registrations/ManufacturersRegister";
import { brandCategories, manufacturerProfileHref, modelsOfBrand, useManufacturers, type ManufacturerProfile } from "@/lib/client/runtimeManufacturers";
import { RegisterDetail, registerDetailHref, type RegisterView } from "@/components/app/registrations/RegisterDetail";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { istStamp } from "@/lib/client/istTime";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { useCommand, type CommandState } from "@/components/app/kit/CommandPanel";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { useAdminDemonstrationReadOnly } from "@/lib/adminDemonstration";
import { commandAdvice, type CommandFailure, gateRead } from "@/lib/client/runtimeHttp";
import {
  type RegisterAuthorisationEntry,
  type RegisterBrandEntry,
  type RegisterRevocationProposal,
  type RegisterRevocations,
  type RevocationAction,
  readRegisterRevocations,
  registerHref,
  runDecideRevocation,
  runProposeRevocation,
  decideRevocationSignature,
  proposeRevocationSignature,
} from "@/lib/client/runtimeRegisterRevocations";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

const loadRegister = () => readRegisterRevocations();

const BRAND_STATUS: Record<string, string> = { active: "Active", suspended: "Suspended", revoked: "Revoked" };
const AUTH_STATUS: Record<string, string> = { active: "Active", revoked: "Revoked" };
const PROPOSAL_STATE: Record<string, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn" };
const ACTION_WORD: Record<string, string> = { revoke: "Revoke", close: "Close" };

function words(table: Record<string, string>, code: string): string {
  return table[code] ?? code;
}

/**
 * The register Spring returns, and the proposals to close or revoke an entry. Programme proposes; the Director decides;
 * the proposer withdraws. The screen shows canPropose, canDecide and proposedByYou. Provisional local rules, not BEE rules.
 */
export function RegisterRevocations({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const readOnlyAdmin = useAdminDemonstrationReadOnly();
  const revalidation = useRevalidation();
  const read = gateRead(identity.status, useRuntimeRead("register", loadRegister, revalidation));
  const [openId, setOpenId] = useState<string | null>(null);
  const params = useSearchParams();
  const viewParam = params.get("view");
  const view: RegisterView | null = viewParam === "brand" || viewParam === "authorisation" || viewParam === "proposal" ? viewParam : null;
  const detailId = params.get("id");
  const manufacturerEntry = viewParam === "manufacturer" && detailId;
  const modelEntry = viewParam === "model" && detailId;

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Register" implemented={runtimeRouteFor(registerHref())?.implemented}>
      <div className="space-y-space-md" data-testid="rvk-screen">
        <IdentityStrip identity={identity} testId="rvk-identity" />
        <ReadPanel
          title="Register"
          read={read}
          loadingText="Loading the register…"
          loadingTestId="rvk-loading"
          errorTestId="rvk-error"
          signInReturnTo={registerHref()}
        >
          {(r) => modelEntry ? (
            <ModelEntry id={detailId} />
          ) : manufacturerEntry ? (
            <ManufacturerEntry code={detailId} />
          ) : view && detailId ? (
            <RegisterDetail register={r.register} view={view} id={detailId} />
          ) : (
            <RegisterBody
              register={r.register}
              readOnlyAdmin={readOnlyAdmin}
              openId={openId}
              onOpen={setOpenId}
              onChanged={() => { setOpenId(null); revalidation.refresh(); }}
              onRefresh={() => revalidation.refresh()}
            />
          )}
        </ReadPanel>
      </div>
    </ScreenChrome>
  );
}

type TabKey = "manufacturers" | "models" | "brands" | "auths" | "pending" | "history";

const FIELD = "rounded-lg border border-outline-variant px-3 h-10 box-border font-body-sm bg-surface-card";
const TH = "py-2 pr-3 text-left font-label-sm text-on-surface-variant";
const TD = "py-2 pr-3 align-top";

const STATUS_TONE: Record<string, string> = {
  active: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]", suspended: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]", revoked: "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]",
  pending: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]", approved: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]", rejected: "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]",
  withdrawn: "bg-[#eef2f7] text-[#475569] border-[#d8e0ea]",
};
function StatusPill({ code, label }: { code: string; label: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold leading-4 ${STATUS_TONE[code] ?? "bg-[#e7effb] text-[#14315E] border-[#c9d9f7]"}`}>{label}</span>;
}

function FilterSelect({ label, value, onChange, options, testId }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; testId: string }) {
  return (
    <label className="flex flex-col font-label-sm text-label-sm text-on-surface-variant">{label}
      <select className={`${FIELD} mt-1`} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

const distinct = (xs: string[]): [string, string][] => [["", "All"], ...[...new Set(xs)].sort().map((x): [string, string] => [x, x])];

function SummaryCard({ label, value, hint, tone, tab, current, onPick }: { label: string; value: number; hint: string; tone: string; tab: TabKey; current: TabKey; onPick: (t: TabKey) => void }) {
  return (
    <button type="button" onClick={() => onPick(tab)} aria-pressed={current === tab} className={`text-left rounded-2xl border p-space-md bg-surface-card hover:shadow transition ${current === tab ? "border-primary shadow" : "border-outline-variant"}`} data-testid={`rvk-card-${tab}`}>
      <span className="font-label-md uppercase tracking-wide text-on-surface-variant">{label}</span>
      <span className={`block text-[30px] leading-9 font-extrabold tabular-nums ${tone}`}>{value}</span>
      <span className="block font-label-sm text-on-surface-variant">{hint}</span>
    </button>
  );
}

function RegisterBody({
  register,
  readOnlyAdmin,
  openId,
  onOpen,
  onChanged,
  onRefresh,
}: {
  register: RegisterRevocations;
  readOnlyAdmin: boolean;
  openId: string | null;
  onOpen: (id: string | null) => void;
  onChanged: () => void;
  onRefresh: () => void;
}) {
  const view: RegisterRevocations = readOnlyAdmin
    ? { ...register, canPropose: false, canDecide: false }
    : register;
  const tabParam = useSearchParams().get("tab");
  const tabOf = (v: string | null): TabKey => (v === "manufacturers" || v === "models" || v === "auths" || v === "pending" || v === "history" ? v : "brands");
  const [tab, setTab] = useState<TabKey>(tabOf(tabParam));
  const [seenParam, setSeenParam] = useState(tabParam);
  // A menu link can change ?tab= while this page stays mounted; follow it.
  if (tabParam !== seenParam) {
    setSeenParam(tabParam);
    setTab(tabOf(tabParam));
  }
  const count = (xs: { status: string }[], st: string) => xs.filter((x) => x.status === st).length;
  const manufacturerCount = useManufacturerCount();
  const modelCount = useModelCount();
  const brandsActive = count(register.brands, "active");
  const authsActive = count(register.authorisations, "active");
  const tabBtn = (key: TabKey, label: string, n: number) => (
    <button key={key} type="button" role="tab" aria-selected={tab === key} id={`rvk-tab-${key}`} onClick={() => setTab(key)} data-testid={`rvk-tab-${key}`}
      className={`px-space-md py-2 rounded-t-lg font-label-lg border-b-2 ${tab === key ? "border-primary text-primary" : "border-transparent text-on-surface-variant hover:text-on-surface"}`}>
      {label} <span className="ml-1 rounded-full bg-surface-container px-2 text-[12px]">{n}</span>
    </button>
  );

  return (
    <div className="space-y-space-md">
      <div className="grid gap-space-sm sm:grid-cols-2 xl:grid-cols-6" data-testid="rvk-summary">
        <SummaryCard label="Manufacturers" value={manufacturerCount} hint="Permittees and registrations" tone="text-[#14315e]" tab="manufacturers" current={tab} onPick={setTab} />
        <SummaryCard label="Models" value={modelCount} hint="Certificates issued and applications" tone="text-[#14315e]" tab="models" current={tab} onPick={setTab} />
        <SummaryCard label="Brands" value={register.brands.length} hint={`${brandsActive} active, ${count(register.brands, "suspended")} suspended, ${count(register.brands, "revoked")} revoked`} tone="text-[#14315e]" tab="brands" current={tab} onPick={setTab} />
        <SummaryCard label="Agency authorisations" value={register.authorisations.length} hint={`${authsActive} active, ${count(register.authorisations, "revoked")} revoked`} tone="text-[#14315e]" tab="auths" current={tab} onPick={setTab} />
        <SummaryCard label="Waiting for a decision" value={register.pending.length} hint={register.pending.length ? "Closures or revocations to decide" : "Nothing is waiting"} tone={register.pending.length ? "text-[#8a4b00]" : "text-[#14532d]"} tab="pending" current={tab} onPick={setTab} />
        <SummaryCard label="Decided" value={register.decided.length} hint="Approved, rejected or withdrawn" tone="text-[#14315e]" tab="history" current={tab} onPick={setTab} />
      </div>

      <div role="tablist" aria-label="Register" className="flex flex-wrap gap-space-xs border-b border-outline-variant">
        {tabBtn("manufacturers", "Manufacturers", manufacturerCount)}
        {tabBtn("brands", "Brands & categories", register.brands.length)}
        {tabBtn("models", "Models & certificates", modelCount)}
        {tabBtn("auths", "Agency authorisations", register.authorisations.length)}
        {tabBtn("pending", "Waiting for a decision", register.pending.length)}
        {tabBtn("history", "History", register.decided.length)}
      </div>

      <section role="tabpanel" aria-labelledby="rvk-tab-manufacturers" hidden={tab !== "manufacturers"}>
        {tab === "manufacturers" ? <ManufacturersPanel /> : null}
      </section>
      <section role="tabpanel" aria-labelledby="rvk-tab-models" hidden={tab !== "models"}>
        {tab === "models" ? <ModelsPanel /> : null}
      </section>
      <section role="tabpanel" aria-labelledby="rvk-tab-brands" hidden={tab !== "brands"}>
        <BrandsPanel register={view} openId={openId} onOpen={onOpen} onChanged={onChanged} onRefresh={onRefresh} />
      </section>
      <section role="tabpanel" aria-labelledby="rvk-tab-auths" hidden={tab !== "auths"}>
        <AuthsPanel register={view} openId={openId} onOpen={onOpen} onChanged={onChanged} onRefresh={onRefresh} />
      </section>
      <section role="tabpanel" aria-labelledby="rvk-tab-pending" hidden={tab !== "pending"} data-testid="rvk-pending">
        <PendingPanel register={view} onChanged={onChanged} onRefresh={onRefresh} />
      </section>
      <section role="tabpanel" aria-labelledby="rvk-tab-history" hidden={tab !== "history"} data-testid="rvk-history">
        <HistoryPanel decided={view.decided} />
      </section>
    </div>
  );
}

function useModelCount(): number {
  const reg = useModelRegister();
  return reg.phase === "ready" ? reg.items.length : 0;
}

function useManufacturerCount(): number {
  const read = useManufacturers();
  return read.phase === "ready" ? read.list.length : 0;
}

type PanelProps = { register: RegisterRevocations; openId: string | null; onOpen: (id: string | null) => void; onChanged: () => void; onRefresh: () => void };

/** Owner code to the manufacturer's name, and brand id to the reason for its status, both from the Manufacturer 360 list. */
function useOwnerLookups(): { names: Map<string, string>; reasons: Map<string, string | null>; all: ManufacturerProfile[] } {
  const read = useManufacturers();
  const all = read.phase === "ready" ? read.list : [];
  const names = new Map(all.map((m) => [m.code, m.name]));
  const reasons = new Map(all.flatMap((m) => m.brands.map((b) => [b.id, b.reason] as [string, string | null])));
  return { names, reasons, all };
}

function BrandsPanel({ register, openId, onOpen, onChanged, onRefresh }: PanelProps) {
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [category, setCategory] = useState("");
  const { names, reasons, all } = useOwnerLookups();
  const info = (b: RegisterBrandEntry) => {
    const o = all.find((m) => m.code === b.owner);
    return { categories: brandCategories(o, b), models: modelsOfBrand(o, b).length, registeredOn: o?.brands.find((x) => x.id === b.id)?.registeredOn ?? "" };
  };
  const rows = register.brands.filter((b) => (!status || b.status === status) && (!owner || b.owner === owner) && (!category || info(b).categories.includes(category)));
  const allCategories = [...new Set(register.brands.flatMap((b) => info(b).categories))].sort();
  const tools = useListTools({
    rows,
    text: (b) => `${b.name} ${b.owner} ${names.get(b.owner) ?? ""} ${b.source} ${words(BRAND_STATUS, b.status)} ${info(b).categories.join(" ")}`,
    sortValue: (b, k) => (k === "name" ? b.name : k === "owner" ? b.owner : k === "status" ? b.status : k === "cat" ? info(b).categories.join(",") : k === "models" ? info(b).models : k === "on" ? info(b).registeredOn : b.source),
    pageSize: 8,
  });
  const openBrand = register.brands.find((b) => b.id === openId) ?? null;
  const clear = () => { tools.clear(); setStatus(""); setOwner(""); setCategory(""); };
  const byCategory = allCategories.map((c) => ({ c, brands: register.brands.filter((b) => info(b).categories.includes(c)) }));
  return (
    <div className="space-y-space-sm">
      <div className="grid gap-space-sm sm:grid-cols-2 lg:grid-cols-4" data-testid="rvk-categories">
        {byCategory.map(({ c, brands }) => (
          <button key={c} type="button" onClick={() => { setCategory(category === c ? "" : c); tools.setPage(1); }} aria-pressed={category === c} className={`rounded-xl border bg-white p-3 text-left hover:border-primary ${category === c ? "border-primary ring-2 ring-[#c9d9f7]" : "border-[#dbe6f7]"}`} data-testid={`rvk-category-${c}`}>
            <span className="block text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">Category</span>
            <span className="block text-[18px] font-extrabold text-[#14315E]">{c}</span>
            <span className="block text-[12px] text-[#64748b]">{brands.length} brands · {brands.filter((x) => x.status === "active").length} active · {brands.filter((x) => x.status !== "active").length} held or revoked</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-space-md">
        <ListToolbar tools={tools} searchLabel="Search brands" placeholder="Brand, category, owner or source"
          exportCsv={{ filename: "register-brands", header: ["Name", "Category", "Owner", "Status", "Models", "Registered on", "Source"], rows: tools.visible.map((b) => [b.name, info(b).categories.join(", "), b.owner, words(BRAND_STATUS, b.status), info(b).models, info(b).registeredOn, b.source]) }} />
      </div>
      <div className="flex flex-wrap items-end gap-space-md" data-testid="rvk-filters">
        <FilterSelect label="Status" value={status} onChange={(v) => { setStatus(v); tools.setPage(1); }} testId="rvk-brand-status" options={[["", "All"], ["active", "Active"], ["suspended", "Suspended"], ["revoked", "Revoked"]]} />
        <FilterSelect label="Owner" value={owner} onChange={(v) => { setOwner(v); tools.setPage(1); }} testId="rvk-brand-owner" options={all.length > 0 ? [["", "All"], ...all.map((m) => [m.code, m.name] as [string, string])] : distinct(register.brands.map((b) => b.owner))} />
        <FilterSelect label="Category" value={category} onChange={(v) => { setCategory(v); tools.setPage(1); }} testId="rvk-brand-category" options={[["", "All"], ...allCategories.map((c): [string, string] => [c, c])]} />
        {(status || owner || category) ? <button type="button" className="font-label-md text-primary underline pb-2" onClick={clear} data-testid="rvk-brand-clear">Clear filters</button> : null}
      </div>
      {register.brands.length === 0 ? <p className="font-body-sm text-on-surface-variant">No brand is on the register.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full font-body-sm text-body-sm" data-testid="rvk-brands">
            <caption className="sr-only">Registered brands</caption>
            <thead>
              <tr>
                <SortableTh tools={tools} k="name" className={TH}>Name</SortableTh><SortableTh tools={tools} k="cat" className={TH}>Category</SortableTh><SortableTh tools={tools} k="owner" className={TH}>Owner</SortableTh>
                <SortableTh tools={tools} k="status" className={TH}>Status</SortableTh><SortableTh tools={tools} k="models" className={TH}>Models</SortableTh><SortableTh tools={tools} k="on" className={TH}>Registered on</SortableTh><th className={TH}>Reason for status</th><SortableTh tools={tools} k="source" className={TH}>Source</SortableTh>
                <th className={TH}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {tools.paged.pageRows.map((brand) => (
                <tr key={brand.id} className="border-t border-outline-variant" data-testid={`rvk-brand-${brand.id}`} data-status={brand.status}>
                  <td className={`${TD} font-semibold`}><Link href={registerDetailHref("brand", brand.id)} className="text-primary hover:underline" data-testid={`rvk-brand-open-${brand.id}`}>{brand.name}</Link></td>
                  <td className={TD}>{info(brand).categories.join(", ")}</td>
                  <td className={TD}><Link href={manufacturerProfileHref(brand.owner)} className="text-primary hover:underline" data-testid={`rvk-brand-owner-link-${brand.id}`}>{names.get(brand.owner) ?? brand.owner}</Link></td>
                  <td className={TD}>
                    <StatusPill code={brand.status} label={words(BRAND_STATUS, brand.status)} />
                  </td>
                  <td className={TD}>{info(brand).models}</td>
                  <td className={TD}>{info(brand).registeredOn || "-"}</td>
                  <td className={`${TD} max-w-sm text-on-surface-variant`} data-testid={`rvk-brand-reason-${brand.id}`}>{brand.status === "active" ? "-" : reasons.get(brand.id) ?? "No reason recorded."}</td>
                  <td className={TD}>{brand.source}</td>
                  <td className={TD}>{proposeButton(register.canPropose, brand.status === "active", brand.id, openId, onOpen)}</td>
                </tr>
              ))}
              {tools.paged.total === 0 ? <tr><td className={TD} colSpan={9}>No brand matches these filters.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      <ListPager tools={tools} />
      {openBrand && register.canPropose ? <ProposeBrand key={openBrand.id} brand={openBrand} onDone={onChanged} onStale={onRefresh} /> : null}
    </div>
  );
}

function AuthsPanel({ register, openId, onOpen, onChanged, onRefresh }: PanelProps) {
  const { names } = useOwnerLookups();
  const [status, setStatus] = useState("");
  const [agency, setAgency] = useState("");
  const [principal, setPrincipal] = useState("");
  const [period, setPeriod] = useState("");
  const rows = register.authorisations.filter((a) => (!status || a.status === status) && (!agency || a.agency === agency) && (!principal || a.principal === principal)
    && (!period || (period === "open" ? a.validTo === null : a.validTo !== null)));
  const tools = useListTools({
    rows,
    text: (a) => `${a.brandName} ${a.agency} ${a.principal} ${words(AUTH_STATUS, a.status)}`,
    date: (a) => a.validFrom,
    sortValue: (a, k) => (k === "brand" ? a.brandName : k === "agency" ? a.agency : k === "principal" ? a.principal : k === "from" ? a.validFrom : k === "to" ? a.validTo ?? "9999-12-31" : a.status),
    pageSize: 8,
  });
  const openAuth = register.authorisations.find((a) => a.id === openId) ?? null;
  const clear = () => { tools.clear(); setStatus(""); setAgency(""); setPrincipal(""); setPeriod(""); };
  return (
    <div className="space-y-space-sm">
      <div className="flex flex-wrap items-end gap-space-md">
        <ListToolbar tools={tools} searchLabel="Search authorisations" placeholder="Brand, agency or principal" dateLabel="Valid from"
          exportCsv={{ filename: "register-authorisations", header: ["Brand", "Agency", "Principal", "From", "To", "Status"], rows: tools.visible.map((a) => [a.brandName, a.agency, a.principal, a.validFrom, a.validTo, words(AUTH_STATUS, a.status)]) }} />
      </div>
      <div className="flex flex-wrap items-end gap-space-md" data-testid="rvk-filters">
        <FilterSelect label="Status" value={status} onChange={(v) => { setStatus(v); tools.setPage(1); }} testId="rvk-auth-status" options={[["", "All"], ["active", "Active"], ["revoked", "Revoked"]]} />
        <FilterSelect label="Agency" value={agency} onChange={(v) => { setAgency(v); tools.setPage(1); }} testId="rvk-auth-agency" options={distinct(register.authorisations.map((a) => a.agency))} />
        <FilterSelect label="Principal" value={principal} onChange={(v) => { setPrincipal(v); tools.setPage(1); }} testId="rvk-auth-principal" options={distinct(register.authorisations.map((a) => a.principal))} />
        <FilterSelect label="Period" value={period} onChange={(v) => { setPeriod(v); tools.setPage(1); }} testId="rvk-auth-period" options={[["", "All"], ["open", "No end date"], ["dated", "Has an end date"]]} />
        {(status || agency || principal || period) ? <button type="button" className="font-label-md text-primary underline pb-2" onClick={clear} data-testid="rvk-auth-clear">Clear filters</button> : null}
      </div>
      {register.authorisations.length === 0 ? <p className="font-body-sm text-on-surface-variant">No agency authorisation is on the register.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full font-body-sm text-body-sm" data-testid="rvk-auths">
            <caption className="sr-only">Agency authorisations</caption>
            <thead>
              <tr>
                <SortableTh tools={tools} k="brand" className={TH}>Brand</SortableTh><SortableTh tools={tools} k="agency" className={TH}>Agency</SortableTh>
                <SortableTh tools={tools} k="principal" className={TH}>Principal</SortableTh><SortableTh tools={tools} k="from" className={TH}>From</SortableTh>
                <SortableTh tools={tools} k="to" className={TH}>To</SortableTh><SortableTh tools={tools} k="status" className={TH}>Status</SortableTh>
                <th className={TH}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {tools.paged.pageRows.map((auth) => (
                <tr key={auth.id} className="border-t border-outline-variant" data-testid={`rvk-auth-${auth.id}`} data-status={auth.status}>
                  <td className={`${TD} font-semibold`}><Link href={registerDetailHref("authorisation", auth.id)} className="text-primary hover:underline" data-testid={`rvk-auth-open-${auth.id}`}>{auth.brandName}</Link></td>
                  <td className={TD}>{auth.agency}</td>
                  <td className={TD}><Link href={manufacturerProfileHref(auth.principal)} className="text-primary hover:underline">{names.get(auth.principal) ?? auth.principal}</Link></td>
                  <td className={TD}>{auth.validFrom}</td>
                  <td className={TD}>{auth.validTo ?? "—"}</td>
                  <td className={TD}><StatusPill code={auth.status} label={words(AUTH_STATUS, auth.status)} /></td>
                  <td className={TD}>{proposeButton(register.canPropose, auth.status === "active", auth.id, openId, onOpen)}</td>
                </tr>
              ))}
              {tools.paged.total === 0 ? <tr><td className={TD} colSpan={7}>No authorisation matches these filters.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      <ListPager tools={tools} />
      {openAuth && register.canPropose ? <ProposeAuthorisation key={openAuth.id} auth={openAuth} onDone={onChanged} onStale={onRefresh} /> : null}
    </div>
  );
}

function PendingPanel({ register, onChanged, onRefresh }: { register: RegisterRevocations; onChanged: () => void; onRefresh: () => void }) {
  const [action, setAction] = useState("");
  const [kind, setKind] = useState("");
  const [mine, setMine] = useState("");
  const rows = register.pending.filter((p) => (!action || p.action === action) && (!kind || p.targetKind === kind) && (!mine || (mine === "yours") === p.proposedByYou));
  const tools = useListTools({
    rows,
    text: (p) => `${p.targetLabel} ${p.reason} ${p.proposedBy}`,
    date: (p) => p.proposedAt.slice(0, 10),
    sortValue: (p, k) => (k === "target" ? p.targetLabel : k === "action" ? p.action : k === "by" ? p.proposedBy : p.proposedAt),
    pageSize: 5,
  });
  const clear = () => { tools.clear(); setAction(""); setKind(""); setMine(""); };
  if (register.pending.length === 0) return <p className="font-body-sm text-on-surface-variant">Nothing is waiting for a decision.</p>;
  return (
    <div className="space-y-space-sm">
      <div className="flex flex-wrap items-end gap-space-md">
        <ListToolbar tools={tools} searchLabel="Search proposals" placeholder="Entry, reason or proposer" dateLabel="Proposed" />
      </div>
      <div className="flex flex-wrap items-end gap-space-md" data-testid="rvk-filters">
        <FilterSelect label="Action" value={action} onChange={(v) => { setAction(v); tools.setPage(1); }} testId="rvk-pending-action" options={[["", "All"], ["revoke", "Revoke"], ["close", "Close on a date"]]} />
        <FilterSelect label="Entry" value={kind} onChange={(v) => { setKind(v); tools.setPage(1); }} testId="rvk-pending-kind" options={[["", "All"], ["brand", "Brand"], ["authorisation", "Agency authorisation"]]} />
        <FilterSelect label="Proposed by" value={mine} onChange={(v) => { setMine(v); tools.setPage(1); }} testId="rvk-pending-mine" options={[["", "Anyone"], ["yours", "You"], ["others", "Someone else"]]} />
        {(action || kind || mine) ? <button type="button" className="font-label-md text-primary underline pb-2" onClick={clear} data-testid="rvk-pending-clear">Clear filters</button> : null}
      </div>
      <ul className="space-y-space-sm">
        {tools.paged.pageRows.map((proposal) => (
          <PendingRow key={proposal.id} proposal={proposal} canPropose={register.canPropose} canDecide={register.canDecide} onChanged={onChanged} onStale={onRefresh} />
        ))}
        {tools.paged.total === 0 ? <li className="font-body-sm text-on-surface-variant">No proposal matches these filters.</li> : null}
      </ul>
      <ListPager tools={tools} />
    </div>
  );
}

function HistoryPanel({ decided }: { decided: RegisterRevocationProposal[] }) {
  const [state, setState] = useState("");
  const [action, setAction] = useState("");
  const [kind, setKind] = useState("");
  const rows = decided.filter((p) => (!state || p.state === state) && (!action || p.action === action) && (!kind || p.targetKind === kind));
  const tools = useListTools({
    rows,
    text: (p) => `${p.targetLabel} ${p.reason} ${p.proposedBy} ${p.decidedBy ?? ""} ${p.decisionNote ?? ""}`,
    date: (p) => (p.decidedAt ?? p.proposedAt).slice(0, 10),
    sortValue: (p, k) => (k === "decision" ? p.state : k === "target" ? p.targetLabel : k === "action" ? p.action : k === "by" ? p.decidedBy ?? "" : k === "proposer" ? p.proposedBy : p.decidedAt ?? ""),
    pageSize: 8,
  });
  const clear = () => { tools.clear(); setState(""); setAction(""); setKind(""); };
  if (decided.length === 0) return <p className="font-body-sm text-on-surface-variant">No proposal has been decided.</p>;
  return (
    <div className="space-y-space-sm">
      <div className="flex flex-wrap items-end gap-space-md">
        <ListToolbar tools={tools} searchLabel="Search history" placeholder="Entry, reason, person or note" dateLabel="Decided"
          exportCsv={{ filename: "register-history", header: ["Decision", "Entry", "Action", "Closing date", "Proposed by", "Decided by", "Decided at (IST)", "Note"],
            rows: tools.visible.map((p) => [words(PROPOSAL_STATE, p.state), p.targetLabel, words(ACTION_WORD, p.action), p.closeOn, p.proposedBy, p.decidedBy, istStamp(p.decidedAt), p.decisionNote]) }} />
      </div>
      <div className="flex flex-wrap items-end gap-space-md" data-testid="rvk-filters">
        <FilterSelect label="Decision" value={state} onChange={(v) => { setState(v); tools.setPage(1); }} testId="rvk-history-state" options={[["", "All"], ["approved", "Approved"], ["rejected", "Rejected"], ["withdrawn", "Withdrawn"]]} />
        <FilterSelect label="Action" value={action} onChange={(v) => { setAction(v); tools.setPage(1); }} testId="rvk-history-action" options={[["", "All"], ["revoke", "Revoke"], ["close", "Close on a date"]]} />
        <FilterSelect label="Entry" value={kind} onChange={(v) => { setKind(v); tools.setPage(1); }} testId="rvk-history-kind" options={[["", "All"], ["brand", "Brand"], ["authorisation", "Agency authorisation"]]} />
        {(state || action || kind) ? <button type="button" className="font-label-md text-primary underline pb-2" onClick={clear} data-testid="rvk-history-clear">Clear filters</button> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full font-body-sm text-body-sm">
          <caption className="sr-only">Decided proposals</caption>
          <thead>
            <tr>
              <SortableTh tools={tools} k="decision" className={TH}>Decision</SortableTh><SortableTh tools={tools} k="target" className={TH}>Entry</SortableTh>
              <SortableTh tools={tools} k="action" className={TH}>Action</SortableTh><SortableTh tools={tools} k="proposer" className={TH}>Proposed by</SortableTh>
              <SortableTh tools={tools} k="by" className={TH}>Decided by</SortableTh><SortableTh tools={tools} k="at" className={TH}>Decided (IST)</SortableTh>
              <th className={TH}>Note</th>
            </tr>
          </thead>
          <tbody>
            {tools.paged.pageRows.map((p) => (
              <tr key={p.id} className="border-t border-outline-variant" data-testid={`rvk-history-${p.id}`} data-state={p.state}>
                <td className={TD}><StatusPill code={p.state} label={words(PROPOSAL_STATE, p.state)} /></td>
                <td className={`${TD} font-semibold`}><Link href={registerDetailHref("proposal", p.id)} className="text-primary hover:underline" data-testid={`rvk-history-open-${p.id}`}>{p.targetLabel}</Link></td>
                <td className={TD}>{words(ACTION_WORD, p.action)}{p.closeOn ? ` on ${p.closeOn}` : ""}</td>
                <td className={TD}>{p.proposedBy}</td>
                <td className={TD}>{p.decidedBy ?? ""}</td>
                <td className={TD}>{p.decidedAt ? istStamp(p.decidedAt) : ""}</td>
                <td className={TD}>{p.decisionNote ?? p.reason}</td>
              </tr>
            ))}
            {tools.paged.total === 0 ? <tr><td className={TD} colSpan={7}>No proposal matches these filters.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <ListPager tools={tools} />
    </div>
  );
}

function proposeButton(canPropose: boolean, active: boolean, id: string, openId: string | null, onOpen: (id: string | null) => void) {
  if (!canPropose || !active) return null;
  const open = openId === id;
  return (
    <button type="button" className="text-primary font-label-sm" data-testid={`rvk-propose-${id}`} aria-expanded={open} onClick={() => onOpen(open ? null : id)}>
      Propose…
    </button>
  );
}

function ProposeBrand({ brand, onDone, onStale }: { brand: RegisterBrandEntry; onDone: () => void; onStale: () => void }) {
  return (
    <ProposeForm
      targetKind="brand"
      targetId={brand.id}
      intro="Revoke this brand (its authorisations will be revoked with it)"
      onDone={onDone}
      onStale={onStale}
    />
  );
}

function ProposeAuthorisation({ auth, onDone, onStale }: { auth: RegisterAuthorisationEntry; onDone: () => void; onStale: () => void }) {
  const [action, setAction] = useState<RevocationAction>("revoke");
  const [closeOn, setCloseOn] = useState("");
  return (
    <ProposeForm
      targetKind="authorisation"
      targetId={auth.id}
      action={action}
      closeOn={closeOn}
      intro={null}
      onDone={onDone}
      onStale={onStale}
      choice={
        <div className="mt-space-sm space-y-space-sm">
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Action
            <select value={action} onChange={(e) => setAction(e.target.value === "close" ? "close" : "revoke")} className="mt-1 block py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="rvk-action">
              <option value="revoke">Revoke</option>
              <option value="close">Close on a date</option>
            </select>
          </label>
          {action === "close" ? (
            <label className="block font-label-sm text-label-sm text-on-surface-variant">
              Closing date
              <input type="date" value={closeOn} onChange={(e) => setCloseOn(e.target.value)} className="mt-1 block py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="rvk-close-on" aria-describedby="rvk-close-rule" />
            </label>
          ) : null}
          {action === "close" ? (
            <p id="rvk-close-rule" className="font-body-sm text-on-surface-variant" data-testid="rvk-close-rule">
              A closing date is not before today, after the authorisation&apos;s start ({auth.validFrom}) and before its end ({auth.validTo ?? "no end date"}).
            </p>
          ) : null}
        </div>
      }
    />
  );
}

function ProposeForm({
  targetKind,
  targetId,
  action = "revoke",
  closeOn = "",
  intro,
  choice,
  onDone,
  onStale,
}: {
  targetKind: "brand" | "authorisation";
  targetId: string;
  action?: RevocationAction;
  closeOn?: string;
  intro: string | null;
  choice?: ReactNode;
  onDone: () => void;
  onStale: () => void;
}) {
  const [reason, setReason] = useState("");
  const command = useCommand(runProposeRevocation, proposeRevocationSignature);
  const text = reason.trim();
  const needsDate = action === "close" && closeOn.trim().length === 0;
  const ready = text.length >= 1 && text.length <= 500 && !needsDate;

  async function submit() {
    if (!ready) return;
    const result = await command.execute({
      targetKind,
      targetId,
      action,
      reason: text,
      ...(action === "close" ? { closeOn } : {}),
    });
    if (result?.ok) onDone();
    else if (result && !result.ok && isStale(result.failure)) onStale();
  }

  return (
    <div className="mt-space-sm bg-surface-ground rounded-lg p-space-sm" data-testid="rvk-panel">
      {intro ? <p className="font-body-sm">{intro}</p> : null}
      {choice}
      <label className="block font-label-sm text-label-sm text-on-surface-variant mt-space-sm">
        Reason
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-card font-body-sm" data-testid="rvk-reason" aria-describedby="rvk-reason-help" />
      </label>
      {text.length < 1 ? <p id="rvk-reason-help" className="font-body-sm text-on-surface-variant mt-1" data-testid="rvk-reason-help">A reason of 1 to 500 characters is required.</p> : null}
      <CommandOutcome state={command.state} errorTestId="rvk-propose-error" signInReturnTo={registerHref()} />
      <button type="button" disabled={!ready || command.state.phase === "busy"} onClick={() => void submit()} className="mt-space-sm border border-primary text-primary py-2 px-4 rounded-lg font-label-md disabled:opacity-50" data-testid="rvk-submit">
        {command.state.phase === "busy" ? "Sending…" : "Submit"}
      </button>
    </div>
  );
}

function PendingRow({
  proposal,
  canPropose,
  canDecide,
  onChanged,
  onStale,
}: {
  proposal: RegisterRevocationProposal;
  canPropose: boolean;
  canDecide: boolean;
  onChanged: () => void;
  onStale: () => void;
}) {
  const [note, setNote] = useState("");
  const command = useCommand(runDecideRevocation, decideRevocationSignature);
  const text = note.trim();
  const yours = proposal.proposedByYou;
  const showDecision = canDecide && !yours;

  async function act(decision: "approve" | "reject" | "withdraw") {
    if (decision === "reject" && (text.length < 1 || text.length > 500)) return;
    const result = await command.execute({ id: proposal.id, decision, ...(decision === "reject" ? { note: text } : {}) });
    if (result?.ok) onChanged();
    else if (result && !result.ok && isStale(result.failure)) onStale();
  }

  return (
    <li className="font-body-sm border border-outline-variant rounded-lg p-space-sm" data-testid={`rvk-pending-${proposal.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href={registerDetailHref("proposal", proposal.id)} className="font-semibold text-primary hover:underline" data-testid={`rvk-pending-open-${proposal.id}`}>{proposal.targetLabel}</Link>
        <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]">
          {words(ACTION_WORD, proposal.action)}{proposal.closeOn ? ` on ${proposal.closeOn}` : ""}
        </span>
        <span className="text-on-surface-variant">{proposal.targetKind === "brand" ? "Brand" : "Agency authorisation"}</span>
      </div>
      <p className="mt-1">{proposal.reason}</p>
      <p className="mt-1 text-on-surface-variant">Proposed by {proposal.proposedBy} on {istStamp(proposal.proposedAt, false)} IST</p>
      {yours ? <p className="mt-1" data-testid={`rvk-yours-${proposal.id}`}>You proposed this; another person decides</p> : null}
      {showDecision ? (
        <div className="mt-space-sm">
          <p data-testid={`rvk-confirm-${proposal.id}`}>{confirmLine(proposal)}</p>
          <label className="block font-label-sm text-label-sm text-on-surface-variant mt-space-sm">
            Reason for a rejection
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid={`rvk-note-${proposal.id}`} aria-describedby={`rvk-note-help-${proposal.id}`} />
          </label>
          {text.length < 1 ? <p id={`rvk-note-help-${proposal.id}`} className="font-body-sm text-on-surface-variant mt-1">A reason of 1 to 500 characters is needed to reject.</p> : null}
        </div>
      ) : null}
      <CommandOutcome state={command.state} errorTestId="rvk-decide-error" signInReturnTo={registerHref()} />
      <div className="mt-space-sm flex flex-wrap gap-space-sm">
        {showDecision ? (
          <>
            <button type="button" disabled={command.state.phase === "busy"} onClick={() => void act("approve")} className="border border-primary text-primary py-2 px-4 rounded-lg font-label-md disabled:opacity-50" data-testid={`rvk-approve-${proposal.id}`}>Approve</button>
            <button type="button" disabled={command.state.phase === "busy" || text.length < 1 || text.length > 500} onClick={() => void act("reject")} className="border border-primary text-primary py-2 px-4 rounded-lg font-label-md disabled:opacity-50" data-testid={`rvk-reject-${proposal.id}`}>Reject</button>
          </>
        ) : null}
        {canPropose && yours ? (
          <button type="button" disabled={command.state.phase === "busy"} onClick={() => void act("withdraw")} className="border border-primary text-primary py-2 px-4 rounded-lg font-label-md disabled:opacity-50" data-testid={`rvk-withdraw-${proposal.id}`}>Withdraw</button>
        ) : null}
      </div>
    </li>
  );
}

/** Refusals that mean the register has moved on since it was read: read it again so the controls match the record. */
const STALE_CODES = new Set(["proposal_not_pending", "target_not_active", "revocation_pending", "not_found", "closing_date_passed"]);

function isStale(failure: CommandFailure): boolean {
  return failure.kind === "conflict" ? STALE_CODES.has(failure.code) : failure.kind === "not_found";
}

function confirmLine(proposal: RegisterRevocationProposal): string {
  if (proposal.action === "close") return `This closes the authorisation on ${proposal.closeOn ?? ""}`;
  if (proposal.targetKind === "brand") return "This revokes the brand and its authorisations";
  return "This revokes the authorisation";
}

function CommandOutcome<T>({ state, errorTestId, signInReturnTo }: { state: CommandState<T>; errorTestId: string; signInReturnTo: string }) {
  if (state.phase !== "failed") return null;
  const failure = state.failure;
  const advice = commandAdvice(failure);
  return (
    <div className="mt-space-sm" data-testid={errorTestId} data-failure-code={"code" in failure ? failure.code : failure.kind}>
      <p className="text-error font-body-sm">{failure.message}</p>
      {advice.signIn ? <Link href={`/api/auth/login?returnTo=${signInReturnTo}`} className="mt-1 inline-block text-primary font-label-md">Sign in</Link> : null}
    </div>
  );
}
