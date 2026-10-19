"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { istStamp } from "@/lib/client/istTime";
import { manufacturerProfileHref, useManufacturers, type ManufacturerProfile } from "@/lib/client/runtimeManufacturers";
import type {
  RegisterAuthorisationEntry,
  RegisterBrandEntry,
  RegisterRevocationProposal,
  RegisterRevocations,
} from "@/lib/client/runtimeRegisterRevocations";

export type RegisterView = "brand" | "authorisation" | "proposal";

export const registerDetailHref = (view: RegisterView, id: string) => `/app/registrations/register?view=${view}&id=${encodeURIComponent(id)}`;

const TONE: Record<string, string> = {
  active: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]",
  suspended: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]",
  revoked: "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]",
  pending: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]",
  approved: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]",
  rejected: "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]",
  withdrawn: "bg-[#eef2f7] text-[#475569] border-[#d8e0ea]",
};
const LABEL: Record<string, string> = {
  active: "Active", suspended: "Suspended", revoked: "Revoked", pending: "Pending", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn",
};

function Chip({ code }: { code: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[code] ?? ""}`}>{LABEL[code] ?? code}</span>;
}

function Card({ title, icon, children, testId }: { title: string; icon: string; children: ReactNode; testId?: string }) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-white shadow-sm overflow-hidden" data-testid={testId}>
      <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-container-lowest/70 px-space-md py-2.5">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon name={icon} size={16} /></span>
        <div role="heading" aria-level={3} className="font-label-md font-semibold text-on-surface">{title}</div>
      </div>
      <div className="p-space-md">{children}</div>
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

function Hero({ kicker, title, subtitle, chips, status }: { kicker: string; title: string; subtitle?: string; chips: string[]; status: string }) {
  return (
    <div className="rounded-2xl bg-gradient-to-r from-forest-dark to-primary text-on-primary shadow-md p-space-md lg:p-space-lg" data-testid="rvk-detail-hero">
      <div className="flex flex-wrap items-start justify-between gap-space-md">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.14em] text-on-primary/70">{kicker}</p>
          <div role="heading" aria-level={2} className="mt-1 text-2xl font-bold">{title}</div>
          {subtitle ? <p className="mt-1 text-sm text-on-primary/90">{subtitle}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {chips.map((c) => <span key={c} className="rounded-full bg-white/15 px-2.5 py-1">{c}</span>)}
          </div>
        </div>
        <div className="rounded-xl bg-white/95 px-3 py-2 shadow-sm"><Chip code={status} /></div>
      </div>
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-on-surface-variant">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr>{head.map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="px-3 py-2 align-top">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const link = "font-semibold text-primary hover:underline";
/** The register keeps the technical source of an entry; the page shows it in plain words. */
const sourceLabel = (s: string) => (/seed|demo/i.test(s) ? "BEE register (demonstration data)" : s);
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "-");

/** The manufacturer behind an organisation code, when the Manufacturer 360 directory knows it. */
function ownerOf(list: readonly ManufacturerProfile[], code: string) {
  return list.find((m) => m.code === code);
}

function OwnerFact({ code, list }: { code: string; list: readonly ManufacturerProfile[] }) {
  const m = ownerOf(list, code);
  return (
    <Link href={manufacturerProfileHref(code)} className={link}>
      {m ? m.name : code}
    </Link>
  );
}

function Timeline({ items }: { items: { date: string; title: string; detail: string }[] }) {
  if (items.length === 0) return <p className="text-sm text-on-surface-variant">No change has been recorded against this entry.</p>;
  return (
    <ol className="space-y-4">
      {items.map((t, i) => (
        <li key={`${t.date}-${t.title}-${i}`} className="relative flex gap-3">
          {i < items.length - 1 ? <span className="absolute left-[7px] top-5 bottom-[-16px] w-px bg-outline-variant" aria-hidden="true" /> : null}
          <span className="relative z-10 mt-1.5 h-4 w-4 shrink-0 rounded-full bg-primary/15 ring-4 ring-white"><span className="absolute inset-1 rounded-full bg-primary" /></span>
          <div>
            <div className="text-sm font-semibold text-on-surface">{t.title}</div>
            <div className="text-sm text-on-surface-variant">{t.detail}</div>
            <div className="text-xs text-on-surface-variant">{t.date}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function proposalEvents(ps: RegisterRevocationProposal[]) {
  return ps
    .flatMap((p) => [
      { at: p.proposedAt, date: istStamp(p.proposedAt), title: `${p.action === "close" ? "Closure" : "Revocation"} proposed`, detail: `${p.proposedBy}: ${p.reason}` },
      ...(p.decidedAt ? [{ at: p.decidedAt, date: istStamp(p.decidedAt), title: `Proposal ${LABEL[p.state]?.toLowerCase() ?? p.state}`, detail: `${p.decidedBy ?? "-"}${p.decisionNote ? `: ${p.decisionNote}` : ""}` }] : []),
    ])
    .sort((a, b) => b.at.localeCompare(a.at));
}

function ProposalsTable({ ps }: { ps: RegisterRevocationProposal[] }) {
  return (
    <Table
      head={["Action", "Reason", "Proposed", "Outcome", ""]}
      rows={ps.map((p) => [
        p.action === "close" ? "Close" : "Revoke",
        <span key="r" className="line-clamp-2">{p.reason}</span>,
        istStamp(p.proposedAt),
        <Chip key="s" code={p.state} />,
        <Link key="l" href={registerDetailHref("proposal", p.id)} className={link}>Open</Link>,
      ])}
      empty="No closure or revocation has been proposed for this entry."
    />
  );
}

function Back() {
  return (
    <Link href="/app/registrations/register" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline" data-testid="rvk-detail-back">
      <Icon name="arrow_back" size={16} /> Back to the register
    </Link>
  );
}

function NotFound() {
  return (
    <div className="space-y-space-md" data-testid="rvk-detail-missing">
      <Back />
      <p className="text-sm text-on-surface-variant">This register entry was not found. It may have been removed, or you may not be allowed to see it.</p>
    </div>
  );
}

function BrandDetail({ b, r, list }: { b: RegisterBrandEntry; r: RegisterRevocations; list: readonly ManufacturerProfile[] }) {
  const owner = ownerOf(list, b.owner);
  const entry = owner?.brands.find((x) => x.id === b.id);
  const held = b.status === "suspended" || b.status === "revoked";
  const auths = r.authorisations.filter((a) => a.brandId === b.id);
  const ps = [...r.pending, ...r.decided].filter((p) => p.targetKind === "brand" && p.targetId === b.id);
  const models = owner ? owner.models.slice(0, 12) : [];
  return (
    <div className="space-y-space-md" data-testid="rvk-detail-brand">
      <Back />
      <Hero kicker="Registered brand" title={b.name} subtitle={owner ? `Owned by ${owner.name}` : `Owner ${b.owner}`} chips={[`Owner code ${b.owner}`, ...(owner ? owner.categories : [])]} status={b.status} />
      {held ? (
        <div className="rounded-2xl border border-[#f5c2c0] bg-[#fdecea] p-space-md" data-testid="rvk-status-reason">
          <div className="flex items-center gap-2 text-[#93000a]">
            <Icon name="report" size={20} />
            <div role="heading" aria-level={3} className="font-semibold">{b.status === "suspended" ? "Why this brand is suspended" : "Why this brand was revoked"}</div>
          </div>
          <p className="mt-2 text-sm text-on-surface">{entry?.reason ?? "No reason was recorded for this status."}</p>
          {entry?.changedOn ? <p className="mt-1 text-xs text-on-surface-variant">Recorded {entry.changedOn}</p> : null}
        </div>
      ) : null}
      <div className="grid gap-space-md lg:grid-cols-2">
        <Card title="Brand record" icon="sell">
          <div className="grid gap-space-md sm:grid-cols-2">
            <Fact label="Brand name">{b.name}</Fact>
            <Fact label="Register status"><Chip code={b.status} /></Fact>
            <Fact label="Owner"><OwnerFact code={b.owner} list={list} /></Fact>
            <Fact label="Permittee number">{owner?.permitteeNumber ?? "-"}</Fact>
            <Fact label="Entered on the register by">{sourceLabel(b.source)}</Fact>
            <Fact label="Agency authorisations">{auths.length}</Fact>
          </div>
        </Card>
        <Card title="Owner at a glance" icon="corporate_fare">
          {owner ? (
            <div className="grid gap-space-md sm:grid-cols-2">
              <Fact label="Manufacturer">{owner.name}</Fact>
              <Fact label="Location">{[owner.city, owner.state].filter(Boolean).join(", ") || "-"}</Fact>
              <Fact label="Compliance status">{owner.status}</Fact>
              <Fact label="Registered since">{owner.since ?? "-"}</Fact>
              <div className="sm:col-span-2"><Link href={manufacturerProfileHref(b.owner)} className={link}>Open the Manufacturer 360 profile</Link></div>
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant">No manufacturer profile is held for owner code {b.owner}.</p>
          )}
        </Card>
      </div>
      <Card title="Models of the owner" icon="workspace_premium">
        <Table
          head={["Reference", "Model", "Category", "Status", "Certificate"]}
          rows={models.map((m) => [<span key="r" className="font-mono">{m.reference}</span>, m.model, m.category, m.status, m.certificate])}
          empty="No model is on record for the owner of this brand."
        />
      </Card>
      <Card title="Agency authorisations for this brand" icon="handshake">
        <Table
          head={["Agency", "Valid from", "Valid to", "Status", ""]}
          rows={auths.map((a) => [a.agency, day(a.validFrom), day(a.validTo), <Chip key="s" code={a.status} />, <Link key="l" href={registerDetailHref("authorisation", a.id)} className={link}>Open</Link>])}
          empty="No agency is authorised to act for this brand."
        />
      </Card>
      <Card title="Closure and revocation proposals" icon="gavel"><ProposalsTable ps={ps} /></Card>
      <Card title="History of this entry" icon="history"><Timeline items={proposalEvents(ps)} /></Card>
    </div>
  );
}

function AuthorisationDetail({ a, r, list }: { a: RegisterAuthorisationEntry; r: RegisterRevocations; list: readonly ManufacturerProfile[] }) {
  const brand = r.brands.find((x) => x.id === a.brandId);
  const ps = [...r.pending, ...r.decided].filter((p) => p.targetKind === "authorisation" && p.targetId === a.id);
  const daysLeft = a.validTo ? Math.ceil((Date.parse(a.validTo) - Date.parse(r.today)) / 86_400_000) : null;
  return (
    <div className="space-y-space-md" data-testid="rvk-detail-authorisation">
      <Back />
      <Hero kicker="Agency authorisation" title={`${a.agency} for ${a.brandName}`} subtitle={`Acting for ${a.principal}`} chips={[`Valid from ${day(a.validFrom)}`, a.validTo ? `Valid to ${day(a.validTo)}` : "No end date"]} status={a.status} />
      <div className="grid gap-space-md lg:grid-cols-2">
        <Card title="Authorisation record" icon="handshake">
          <div className="grid gap-space-md sm:grid-cols-2">
            <Fact label="Agency">{a.agency}</Fact>
            <Fact label="Status"><Chip code={a.status} /></Fact>
            <Fact label="Brand">{brand ? <Link href={registerDetailHref("brand", brand.id)} className={link}>{a.brandName}</Link> : a.brandName}</Fact>
            <Fact label="Principal (brand owner)"><OwnerFact code={a.principal} list={list} /></Fact>
            <Fact label="Valid from">{day(a.validFrom)}</Fact>
            <Fact label="Valid to">{a.validTo ? day(a.validTo) : "Open-ended"}</Fact>
            <Fact label="Entered on the register by">{sourceLabel(a.source)}</Fact>
            <Fact label="Time remaining">{a.status === "revoked" ? "Ended (revoked)" : daysLeft === null ? "No end date" : daysLeft >= 0 ? `${daysLeft} days` : "Period has ended"}</Fact>
          </div>
        </Card>
        <Card title="What this authorisation allows" icon="rule">
          <ul className="list-disc space-y-1 pl-5 text-sm text-on-surface">
            <li>The agency may file registrations and applications for the brand on behalf of its owner while the authorisation is active.</li>
            <li>The brand owner remains the responsible party for the brand and its certificates.</li>
            <li>A closure takes effect on its date; a revocation takes effect once the BEE Officer approves it.</li>
          </ul>
          <p className="mt-2 text-xs text-on-surface-variant">Provisional local rules for the demonstration, not BEE rules.</p>
        </Card>
      </div>
      <Card title="Closure and revocation proposals" icon="gavel"><ProposalsTable ps={ps} /></Card>
      <Card title="History of this entry" icon="history"><Timeline items={proposalEvents(ps)} /></Card>
    </div>
  );
}

function ProposalDetail({ p, r }: { p: RegisterRevocationProposal; r: RegisterRevocations }) {
  const targetHref = p.targetKind === "brand" ? registerDetailHref("brand", p.targetId) : registerDetailHref("authorisation", p.targetId);
  const verb = p.action === "close" ? "Closure" : "Revocation";
  return (
    <div className="space-y-space-md" data-testid="rvk-detail-proposal">
      <Back />
      <Hero kicker={`${verb} proposal`} title={p.targetLabel} subtitle={p.reason} chips={[p.targetKind === "brand" ? "Brand" : "Agency authorisation", ...(p.closeOn ? [`Close on ${day(p.closeOn)}`] : [])]} status={p.state} />
      <div className="grid gap-space-md lg:grid-cols-2">
        <Card title="Proposal" icon="gavel">
          <div className="grid gap-space-md sm:grid-cols-2">
            <Fact label="Action">{verb}</Fact>
            <Fact label="Outcome"><Chip code={p.state} /></Fact>
            <Fact label="Register entry"><Link href={targetHref} className={link}>{p.targetLabel}</Link></Fact>
            <Fact label="Proposed by">{p.proposedBy}{p.proposedByYou ? " (you)" : ""}</Fact>
            <Fact label="Proposed on">{istStamp(p.proposedAt)}</Fact>
            <Fact label="Effective date">{p.closeOn ? day(p.closeOn) : "On approval"}</Fact>
            <div className="sm:col-span-2"><Fact label="Reason given">{p.reason}</Fact></div>
          </div>
        </Card>
        <Card title="Decision" icon="how_to_reg">
          {p.state === "pending" ? (
            <div className="space-y-2 text-sm">
              <p>This proposal is waiting for a decision. A different person from the proposer decides{r.canDecide ? "; you may decide it from the register's Waiting for a decision tab." : "."}</p>
              <Link href="/app/registrations/register" className={link}>Go to Waiting for a decision</Link>
            </div>
          ) : (
            <div className="grid gap-space-md sm:grid-cols-2">
              <Fact label="Decided by">{p.decidedBy ?? "-"}</Fact>
              <Fact label="Decided on">{p.decidedAt ? istStamp(p.decidedAt) : "-"}</Fact>
              <div className="sm:col-span-2"><Fact label="Decision note">{p.decisionNote ?? "No note recorded."}</Fact></div>
            </div>
          )}
        </Card>
      </div>
      <Card title="Steps" icon="history"><Timeline items={proposalEvents([p])} /></Card>
    </div>
  );
}

/** The follow-up page for one row of the register: a brand, an agency authorisation or a closure/revocation proposal. */
export function RegisterDetail({ register, view, id }: { register: RegisterRevocations; view: RegisterView; id: string }) {
  const read = useManufacturers();
  const list = read.phase === "ready" ? read.list : [];
  if (view === "brand") {
    const b = register.brands.find((x) => x.id === id);
    return b ? <BrandDetail b={b} r={register} list={list} /> : <NotFound />;
  }
  if (view === "authorisation") {
    const a = register.authorisations.find((x) => x.id === id);
    return a ? <AuthorisationDetail a={a} r={register} list={list} /> : <NotFound />;
  }
  const p = [...register.pending, ...register.decided].find((x) => x.id === id);
  return p ? <ProposalDetail p={p} r={register} /> : <NotFound />;
}
