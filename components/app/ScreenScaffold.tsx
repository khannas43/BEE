"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Module, Screen } from "@/lib/screens";
import { ACCESS_CODES, RoleKey, isExternalRole, splitCodes } from "@/lib/roles";
import { canRoleAccessPath } from "@/lib/categories";
import { useRole } from "./RoleContext";
import { useLang } from "@/components/i18n/LangProvider";

/**
 * Effective access codes for a screen. The Annex-A permission tuples cover the
 * 8 internal roles; external partner roles get a scoped VIEW/DOWNLOAD grant on
 * exactly the screens their navigation policy exposes (canRoleAccessPath), so
 * a partner menu link never lands on a "No access" dead-end. Scoping to their
 * own organisation is simulated and flagged by the RouteGuard banner.
 */
export function accessCodesFor(role: RoleKey, module: Module, screen: Screen): string[] {
  const codes = splitCodes(screen.perms[role] ?? "—");
  if (codes.length === 0 && isExternalRole(role) && canRoleAccessPath(role, `/app/${module.id}/${screen.id}`)) {
    return ["V", "D"];
  }
  return codes;
}

/* ------------------------------------------------------------------ *
 * Small shared building blocks
 * ------------------------------------------------------------------ */
function Chip({ code }: { code: string }) {
  const { t } = useLang();
  const tones: Record<string, string> = {
    V: "bg-surface-container text-on-surface-variant",
    C: "bg-success-light text-success",
    E: "bg-success-light text-success",
    S: "bg-secondary-fixed text-on-secondary-fixed",
    R: "bg-secondary-fixed text-on-secondary-fixed",
    A: "bg-primary text-on-primary",
    X: "bg-solar-gold-light text-solar-gold-dark",
    G: "bg-navy-subtle text-navy-dark",
    D: "bg-surface-container text-on-surface-variant",
    P: "bg-success-light text-success",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded font-label-sm text-label-sm font-bold ${tones[code] ?? "bg-surface-container text-on-surface-variant"}`}
      title={ACCESS_CODES[code] ?? code}
    >
      {code} · {t(`access.${code}`)}
    </span>
  );
}

function StatCard({ icon, label, value, tone = "text-primary", sub }: { icon: string; label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-sm p-space-md">
      <div className="flex items-center justify-between">
        <span className="font-label-sm text-label-sm text-on-surface-variant">{label}</span>
        <Icon name={icon} size={18} className={tone} />
      </div>
      <div className={`font-headline-md text-headline-md font-bold ${tone} mt-1`}>{value}</div>
      {sub && <div className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">{sub}</div>}
    </div>
  );
}

function Card({ title, action, children }: { title?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-sm p-space-md">
      {(title || action) && (
        <div className="flex items-center justify-between mb-space-sm">
          {title && <h3 className="font-title-lg text-title-lg text-on-surface">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function FakeTable({ columns, rows }: { columns: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto app-scroll">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-border-subtle">
            {columns.map((c) => (
              <th key={c} className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide py-2 pr-space-md whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border-subtle/60 hover:bg-surface-container-low">
              {r.map((cell, j) => (
                <td key={j} className="py-2.5 pr-space-md font-body-sm text-body-sm text-on-surface whitespace-nowrap">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Status({ label, tone }: { label: string; tone: string }) {
  return <span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm font-semibold ${tone}`}>{label}</span>;
}

const OK = "bg-success-light text-success";
const WARN = "bg-solar-gold-light text-solar-gold-dark";
const BAD = "bg-error-container text-on-error-container";
const INFO = "bg-secondary-fixed text-on-secondary-fixed";

function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-space-sm h-40">
      {data.map((d) => (
        <div key={d.label} className="flex-1 h-full flex flex-col justify-end items-center gap-1">
          <span className="font-label-sm text-label-sm text-on-surface-variant">{d.value}</span>
          <div className="w-full bg-primary/80 rounded-t min-h-[4px]" style={{ height: `${(d.value / max) * 100}%` }} title={`${d.value}`} />
          <span className="font-label-sm text-label-sm text-on-surface-variant">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function Donut({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const stops = segments
    .reduce<{ parts: string[]; acc: number }>(
      (state, s) => {
        const start = (state.acc / total) * 100;
        const acc = state.acc + s.value;
        const end = (acc / total) * 100;
        return { parts: [...state.parts, `${s.color} ${start}% ${end}%`], acc };
      },
      { parts: [], acc: 0 },
    )
    .parts.join(", ");
  return (
    <div className="flex items-center gap-space-lg">
      <div className="w-32 h-32 rounded-full shrink-0" style={{ background: `conic-gradient(${stops})` }}>
        <div className="w-full h-full rounded-full flex items-center justify-center" style={{ background: "radial-gradient(closest-side, #fff 62%, transparent 63%)" }}>
          <span className="font-headline-sm text-headline-sm font-bold text-on-surface">{total}</span>
        </div>
      </div>
      <div className="space-y-1">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-space-sm font-body-sm text-body-sm">
            <span className="w-3 h-3 rounded-sm" style={{ background: s.color }} />
            <span className="text-on-surface-variant">{s.label}</span>
            <span className="font-semibold text-on-surface ml-auto">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Action bar derived from the current role's permission codes
 * ------------------------------------------------------------------ */
function ActionBar({ codes }: { codes: string[] }) {
  const { t } = useLang();
  const buttons: { code: string; label: string; icon: string; primary?: boolean; danger?: boolean }[] = [];
  if (codes.includes("C")) buttons.push({ code: "C", label: t("action.new"), icon: "add", primary: true });
  if (codes.includes("E")) buttons.push({ code: "E", label: t("action.edit"), icon: "edit" });
  if (codes.includes("G")) buttons.push({ code: "G", label: t("action.configure"), icon: "tune" });
  if (codes.includes("X")) buttons.push({ code: "X", label: t("action.run"), icon: "play_arrow", primary: true });
  if (codes.includes("R")) buttons.push({ code: "R", label: t("action.return"), icon: "undo" });
  if (codes.includes("S")) buttons.push({ code: "S", label: t("action.submit"), icon: "send", primary: true });
  if (codes.includes("A")) {
    buttons.push({ code: "A", label: t("action.approve"), icon: "check_circle", primary: true });
    buttons.push({ code: "A", label: t("action.reject"), icon: "cancel", danger: true });
  }
  if (codes.includes("D")) buttons.push({ code: "D", label: t("action.export"), icon: "download" });

  if (buttons.length === 0) buttons.push({ code: "V", label: t("action.viewOnly"), icon: "visibility" });

  return (
    <div className="flex flex-wrap items-center gap-space-sm">
      {buttons.map((b, i) => (
        <button
          key={i}
          type="button"
          className={`px-space-md py-2 rounded-lg font-label-md text-label-md flex items-center gap-1.5 transition-all ${
            b.primary
              ? "bg-primary text-on-primary hover:bg-forest-dark shadow-sm"
              : b.danger
                ? "bg-error-container text-on-error-container hover:bg-error hover:text-on-error"
                : "bg-surface-container text-on-surface hover:bg-surface-container-high"
          }`}
        >
          <Icon name={b.icon} size={18} /> {b.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Archetype bodies
 * ------------------------------------------------------------------ */
function DashboardBody() {
  return (
    <div className="space-y-space-md">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md">
        <StatCard icon="inbox" label="Open items" value="1,284" sub="+8.2% vs last month" />
        <StatCard icon="schedule" label="Due this week" value="176" tone="text-solar-gold-dark" />
        <StatCard icon="warning" label="Overdue / SLA breach" value="23" tone="text-error" />
        <StatCard icon="task_alt" label="Cleared (30d)" value="4,910" tone="text-success" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-md">
        <div className="lg:col-span-2">
          <Card title="Volume trend (last 6 months)">
            <BarChart data={[
              { label: "Apr", value: 620 }, { label: "May", value: 810 }, { label: "Jun", value: 760 },
              { label: "Jul", value: 980 }, { label: "Aug", value: 1120 }, { label: "Sep", value: 1284 },
            ]} />
          </Card>
        </div>
        <Card title="Status split">
          <Donut segments={[
            { label: "Approved", value: 62, color: "#254e9e" },
            { label: "In review", value: 24, color: "#455f88" },
            { label: "Returned", value: 9, color: "#F59E0B" },
            { label: "Rejected", value: 5, color: "#ba1a1a" },
          ]} />
        </Card>
      </div>
      <Card title="Recent activity" action={<Link href="#" className="font-label-sm text-label-sm text-primary hover:underline">View all</Link>}>
        <FakeTable
          columns={["Reference", "Subject", "Owner", "Status", "Updated"]}
          rows={[
            ["APP-2026-04821", "1.5T Split AC — Daikin", "R. Menon", <Status key="1" label="In review" tone={INFO} />, "2h ago"],
            ["APP-2026-04820", "Frost-free 260L — Voltas", "S. Iyer", <Status key="2" label="Approved" tone={OK} />, "5h ago"],
            ["APP-2026-04817", "BLDC Fan — Havells", "A. Khan", <Status key="3" label="Returned" tone={WARN} />, "23 Sep 2026"],
            ["APP-2026-04811", "LED Panel — Wipro", "P. Rao", <Status key="4" label="Overdue" tone={BAD} />, "2d ago"],
          ]}
        />
      </Card>
    </div>
  );
}

function TableBody({ screen }: { screen: Screen }) {
  return (
    <Card>
      <div className="flex flex-col sm:flex-row gap-space-sm items-stretch sm:items-center justify-between mb-space-md">
        <div className="flex-1 relative max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-outline"><Icon name="search" size={18} /></div>
          <input placeholder={`Search ${screen.name.toLowerCase()}…`} className="w-full pl-10 pr-3 py-2 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none" />
        </div>
        <div className="flex items-center gap-space-sm">
          <button className="px-space-md py-2 rounded-lg bg-surface-container text-on-surface font-label-md text-label-md flex items-center gap-1"><Icon name="filter_list" size={18} /> Filter</button>
          <button className="px-space-md py-2 rounded-lg bg-surface-container text-on-surface font-label-md text-label-md flex items-center gap-1"><Icon name="download" size={18} /> Export</button>
        </div>
      </div>
      <FakeTable
        columns={["ID", "Name / Subject", "Organisation", "Category", "Status", "Updated"]}
        rows={Array.from({ length: 8 }).map((_, i) => [
          `${screen.module.slice(0, 3).toUpperCase()}-2026-${(1000 + i).toString()}`,
          ["Split AC 1.5T", "Frost-free 260L", "BLDC Ceiling Fan", "LED Panel 40W", "Storage Geyser 25L", "Submersible Pump 5HP", "Distribution Transformer", "Induction Cooktop"][i],
          ["Daikin", "Voltas", "Havells", "Wipro", "Bajaj", "Kirloskar", "ABB", "Prestige"][i],
          ["Room ACs", "Refrigerators", "Ceiling Fans", "LED", "Water Heaters", "Agri Pumps", "Transformers", "Cooktops"][i],
          [<Status key={i} label={["Active", "In review", "Approved", "Returned", "Active", "Draft", "Approved", "Active"][i]} tone={[OK, INFO, OK, WARN, OK, INFO, OK, OK][i]} />],
          `${i + 1}d ago`,
        ])}
      />
      <Pagination />
    </Card>
  );
}

function FormBody({ screen }: { screen: Screen }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-md">
      <div className="lg:col-span-2 space-y-space-md">
        <Card title="Applicant / organisation details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
            <FormField label="Organisation name" placeholder="Registered legal entity" />
            <FormField label="PAN" placeholder="ABCDE1234F" />
            <FormField label="GSTIN" placeholder="22ABCDE1234F1Z5" />
            <FormField label="Primary contact email" placeholder="name@company.com" />
            <FormField label="Mobile" placeholder="+91 ••••• •••••" />
            <FormField label="State" placeholder="Select state" select />
          </div>
        </Card>
        <Card title={`${screen.name} — specifics`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
            <FormField label="Appliance category" placeholder="Room Air Conditioner" select />
            <FormField label="Reference standard" placeholder="IS 1391 / ISO 5151" select />
            <FormField label="Test laboratory (NABL)" placeholder="Select accredited lab" select />
            <FormField label="Test report date" placeholder="dd / mm / yyyy" />
          </div>
          <div className="mt-space-md">
            <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">Declarations & remarks</label>
            <textarea rows={3} className="w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm text-body-sm outline-none" placeholder="Enter any declarations required for submission…" />
          </div>
        </Card>
        <Card title="Supporting documents">
          <div className="border-2 border-dashed border-border-strong rounded-xl p-space-lg text-center text-on-surface-variant">
            <Icon name="upload_file" size={32} className="text-outline" />
            <p className="font-body-sm text-body-sm mt-1">Drag & drop PDF/JPG up to 10 MB, or click to browse. Files are malware-scanned before acceptance.</p>
          </div>
        </Card>
      </div>
      <div className="space-y-space-md">
        <Card title="Progress">
          <ol className="space-y-space-sm">
            {["Details", "Documents", "Fee", "Declarations", "Submit"].map((s, i) => (
              <li key={s} className="flex items-center gap-space-sm">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center font-label-sm text-label-sm font-bold ${i === 0 ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"}`}>{i + 1}</span>
                <span className={`font-body-sm text-body-sm ${i === 0 ? "text-on-surface font-semibold" : "text-on-surface-variant"}`}>{s}</span>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Draft">
          <p className="font-body-sm text-body-sm text-on-surface-variant">Draft auto-saved. Mandatory fields are validated on submit.</p>
          <button className="mt-space-sm w-full bg-surface-container text-on-surface py-2 rounded-lg font-label-md text-label-md flex items-center justify-center gap-1"><Icon name="save" size={18} /> Save draft</button>
        </Card>
      </div>
    </div>
  );
}

function DetailBody() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-md">
      <div className="lg:col-span-2 space-y-space-md">
        <Card title="Summary">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-space-md">
            {[
              ["Reference", "APP-2026-04821"], ["Applicant", "Daikin India Ltd."], ["Category", "Room ACs"],
              ["Model", "FTKM50U 1.5T"], ["Submitted", "12 Sep 2026"], ["Current stage", "IAME scrutiny"],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="font-label-sm text-label-sm text-on-surface-variant">{k}</div>
                <div className="font-title-lg text-title-lg text-on-surface">{v}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Checklist & findings">
          <ul className="space-y-space-sm">
            {[
              ["Test report matches declared model", true],
              ["Lab accreditation valid on test date", true],
              ["Performance within formula range", true],
              ["Label artwork bilingual & correct", false],
            ].map(([t, ok], i) => (
              <li key={i} className="flex items-center gap-space-sm font-body-sm text-body-sm">
                <Icon name={ok ? "check_circle" : "error"} size={18} className={ok ? "text-primary" : "text-solar-gold-dark"} fill />
                <span className="text-on-surface">{t as string}</span>
                {!ok && <span className="ml-auto"><Status label="Needs clarification" tone={WARN} /></span>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Documents">
          <FakeTable
            columns={["Document", "Version", "Malware scan", "Uploaded"]}
            rows={[
              ["Test report.pdf", "v2", <Status key="1" label="Clean" tone={OK} />, "12 Sep"],
              ["Lab accreditation.pdf", "v1", <Status key="2" label="Clean" tone={OK} />, "12 Sep"],
              ["Label artwork.pdf", "v3", <Status key="3" label="Scanning" tone={WARN} />, "13 Sep"],
            ]}
          />
        </Card>
      </div>
      <div className="space-y-space-md">
        <Card title="Timeline">
          <ol className="relative border-l border-border-strong ml-2 space-y-space-md">
            {[
              ["Submitted", "12 Sep, 10:24"], ["Fee confirmed", "12 Sep, 10:41"],
              ["Assigned to IAME", "12 Sep, 14:02"], ["Under scrutiny", "13 Sep, 09:10"],
            ].map(([t, d], i) => (
              <li key={i} className="ml-space-md">
                <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-primary" />
                <div className="font-body-sm text-body-sm text-on-surface font-semibold">{t}</div>
                <div className="font-label-sm text-label-sm text-on-surface-variant">{d}</div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

function ApprovalBody() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-md">
      <div className="lg:col-span-2">
        <DetailBody />
      </div>
      <div className="space-y-space-md">
        <Card title="Decision">
          <p className="font-body-sm text-body-sm text-on-surface-variant mb-space-sm">
            Maker-checker enforced — you cannot approve your own controlled action. A reason and signature are captured.
          </p>
          <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">Decision reason</label>
          <textarea rows={3} className="w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm text-body-sm outline-none mb-space-sm" placeholder="Record the basis for your decision…" />
          <div className="flex items-center gap-space-sm mb-space-sm font-body-sm text-body-sm text-on-surface">
            <Icon name="draw" size={18} className="text-primary" /> eSign / DSC required on approve
          </div>
        </Card>
      </div>
    </div>
  );
}

function ConfigBody({ screen }: { screen: Screen }) {
  return (
    <div className="space-y-space-md">
      <div className="bg-navy-subtle text-navy-dark rounded-xl p-space-md flex items-center gap-space-sm">
        <Icon name="info" size={20} className="text-secondary" />
        <span className="font-body-sm text-body-sm">Configuration over code — this reference/rule set is versioned and published through a maker-checker workflow.</span>
      </div>
      <Card
        title={`${screen.name} — versioned entries`}
        action={<button className="px-space-md py-1.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md flex items-center gap-1"><Icon name="add" size={18} /> Add entry</button>}
      >
        <FakeTable
          columns={["Code", "Description", "Version", "Effective from", "Status"]}
          rows={[
            ["RAC", "Room Air Conditioner", "v4", "01 Jan 2026", <Status key="1" label="Published" tone={OK} />],
            ["REF", "Frost-free Refrigerator", "v3", "01 Jan 2026", <Status key="2" label="Published" tone={OK} />],
            ["FAN", "BLDC Ceiling Fan", "v2", "01 Apr 2026", <Status key="3" label="Draft" tone={INFO} />],
            ["LED", "LED Luminaire", "v5", "01 Jul 2026", <Status key="4" label="Pending approval" tone={WARN} />],
          ]}
        />
      </Card>
    </div>
  );
}

function WizardBody() {
  return (
    <div className="space-y-space-md">
      <Card>
        <div className="flex items-center gap-space-sm overflow-x-auto app-scroll">
          {["Inputs", "Formula version", "Compute", "Review", "Publish"].map((s, i) => (
            <div key={s} className="flex items-center gap-space-sm shrink-0">
              <span className={`w-7 h-7 rounded-full flex items-center justify-center font-label-sm text-label-sm font-bold ${i <= 2 ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"}`}>{i + 1}</span>
              <span className={`font-label-md text-label-md ${i <= 2 ? "text-on-surface font-semibold" : "text-on-surface-variant"}`}>{s}</span>
              {i < 4 && <span className="w-8 h-px bg-border-strong" />}
            </div>
          ))}
        </div>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
        <Card title="Inputs & formula">
          <div className="grid grid-cols-2 gap-space-md">
            <FormField label="Cooling capacity (W)" placeholder="5000" />
            <FormField label="Power input (W)" placeholder="1450" />
            <FormField label="ISEER" placeholder="5.25" />
            <FormField label="Formula version" placeholder="RAC-2026-v4" select />
          </div>
        </Card>
        <Card title="Computed result">
          <div className="text-center py-space-md">
            <div className="font-label-sm text-label-sm text-on-surface-variant uppercase">Star rating</div>
            <div className="font-display-lg text-display-lg font-bold text-primary">5★</div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">All inputs and intermediate results are retained as calculation evidence.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function LedgerBody({ screen }: { screen: Screen }) {
  return (
    <div className="space-y-space-md">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md">
        <StatCard icon="account_balance_wallet" label="Confirmed (30d)" value="₹2.41 Cr" tone="text-primary" />
        <StatCard icon="pending" label="Pending settlement" value="₹18.6 L" tone="text-solar-gold-dark" />
        <StatCard icon="undo" label="Refunds processed" value="₹4.2 L" tone="text-secondary" />
        <StatCard icon="error" label="Exceptions" value="12" tone="text-error" />
      </div>
      <Card title={`${screen.name} — entries`} action={<button className="px-space-md py-1.5 rounded-lg bg-surface-container text-on-surface font-label-md text-label-md flex items-center gap-1"><Icon name="download" size={18} /> Export</button>}>
        <FakeTable
          columns={["Txn / Order", "Party", "Type", "Amount", "Status", "Date"]}
          rows={Array.from({ length: 6 }).map((_, i) => [
            `ORD-2026-${5000 + i}`,
            ["Daikin", "Voltas", "LG", "Blue Star", "Godrej", "Havells"][i],
            ["Model fee", "Security deposit", "Label fee", "Refund", "Model fee", "Penalty"][i],
            <span key={i} className="font-mono">₹{["24,000", "1,00,000", "8,500", "-12,000", "24,000", "50,000"][i]}</span>,
            [<Status key={i} label={["Confirmed", "Confirmed", "Pending", "Refunded", "Confirmed", "Confirmed"][i]} tone={[OK, OK, WARN, INFO, OK, OK][i]} />],
            `${10 + i} Sep`,
          ])}
        />
      </Card>
    </div>
  );
}

function InboxBody() {
  return (
    <div className="space-y-space-md">
      <div className="flex items-center gap-space-sm">
        {["Due (42)", "Overdue (7)", "Returned (5)", "Delegated (3)"].map((t, i) => (
          <button key={t} className={`px-space-md py-1.5 rounded-lg font-label-md text-label-md ${i === 0 ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface"}`}>{t}</button>
        ))}
      </div>
      <Card>
        <FakeTable
          columns={["Task", "Reference", "Priority", "SLA due", "From"]}
          rows={Array.from({ length: 7 }).map((_, i) => [
            ["Scrutinise model application", "Verify test report", "Approve label", "Return clarification", "Check production data", "Assign lab", "Resolve grievance"][i],
            `TSK-${2300 + i}`,
            [<Status key={i} label={["High", "Medium", "High", "Low", "Medium", "High", "Low"][i]} tone={[BAD, WARN, BAD, INFO, WARN, BAD, INFO][i]} />],
            `${["2h", "1d", "4h", "3d", "6h", "1d", "2d"][i]}`,
            ["System", "R. Menon", "S. Iyer", "A. Khan", "System", "P. Rao", "Helpdesk"][i],
          ])}
        />
      </Card>
    </div>
  );
}

function UploadBody() {
  return (
    <div className="space-y-space-md">
      <Card title="Upload data file">
        <div className="border-2 border-dashed border-border-strong rounded-xl p-space-xl text-center text-on-surface-variant">
          <Icon name="cloud_upload" size={40} className="text-primary" />
          <p className="font-body-md text-body-md mt-2 text-on-surface">Drop the template (.xlsx / .csv) here, or click to browse</p>
          <p className="font-label-sm text-label-sm mt-1">The file is validated for period, model, quantities and duplicate serials before acceptance.</p>
          <button className="mt-space-md px-space-md py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md inline-flex items-center gap-1"><Icon name="download" size={18} /> Download template</button>
        </div>
      </Card>
      <Card title="Validation results">
        <div className="grid grid-cols-3 gap-space-md mb-space-md">
          <StatCard icon="check_circle" label="Accepted rows" value="1,842" tone="text-primary" />
          <StatCard icon="error" label="Rejected rows" value="16" tone="text-error" />
          <StatCard icon="content_copy" label="Duplicates" value="4" tone="text-solar-gold-dark" />
        </div>
        <FakeTable
          columns={["Row", "Model", "Issue", "Severity"]}
          rows={[
            ["118", "FTKM50U", "Serial already bound in batch QB-2231", <Status key="1" label="Reject" tone={BAD} />],
            ["204", "TS-Q19YNZE", "Quantity exceeds approved permission", <Status key="2" label="Reject" tone={BAD} />],
            ["356", "IC518YBTU", "Production period outside quarter", <Status key="3" label="Warning" tone={WARN} />],
          ]}
        />
      </Card>
    </div>
  );
}

function VerifyBody() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
      <Card title="Lookup">
        <div className="flex gap-space-sm">
          <input placeholder="QR value or certificate ID" className="flex-1 py-2.5 px-3 rounded-lg bg-surface-ground font-body-sm text-body-sm outline-none" />
          <button className="px-space-md py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md flex items-center gap-1"><Icon name="search" size={18} /> Verify</button>
        </div>
        <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-sm">Returns model, brand, rating, status and effective dates — internal data is suppressed for public channels.</p>
      </Card>
      <Card title="Result">
        <div className="flex items-center gap-space-sm mb-space-sm">
          <Icon name="verified" size={24} fill className="text-primary" />
          <div>
            <div className="font-title-lg text-title-lg text-on-surface">Daikin FTKM50U 1.5T — 5★</div>
            <div className="font-label-sm text-label-sm text-on-surface-variant">BEE/RAC/2024/09841 • Active till Dec 2026</div>
          </div>
        </div>
        <div className="bg-success-light text-success rounded-lg p-space-sm font-body-sm text-body-sm">Certificate hash anchored on the permissioned ledger. Authenticity confirmed.</div>
      </Card>
    </div>
  );
}

function SearchBody({ screen }: { screen: Screen }) {
  return (
    <div className="space-y-space-md">
      <Card>
        <div className="flex flex-col md:flex-row gap-space-sm">
          <input placeholder={`Search ${screen.name.toLowerCase()}…`} className="flex-1 py-2.5 px-3 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none" />
          <select className="py-2.5 px-3 rounded-lg bg-surface-ground font-body-sm text-body-sm outline-none"><option>All types</option><option>Payment</option><option>Application</option><option>Audit</option></select>
          <input type="date" className="py-2.5 px-3 rounded-lg bg-surface-ground font-body-sm text-body-sm outline-none" />
          <button className="px-space-md py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md flex items-center gap-1"><Icon name="search" size={18} /> Search</button>
        </div>
      </Card>
      <Card title="Results">
        <FakeTable
          columns={["Reference", "Type", "Actor", "Object", "Timestamp"]}
          rows={Array.from({ length: 6 }).map((_, i) => [
            `REF-${9000 + i}`,
            ["Payment", "Application", "Config change", "Login", "Approval", "Export"][i],
            ["S. Iyer", "R. Menon", "BEE Admin", "A. Khan", "Director", "Auditor"][i],
            ["ORD-5001", "APP-4821", "Fee rules v4", "session", "APP-4820", "MIS report"][i],
            `13 Sep 2026, ${9 + i}:0${i}`,
          ])}
        />
      </Card>
    </div>
  );
}

function Pagination() {
  return (
    <div className="flex items-center justify-between mt-space-md pt-space-sm">
      <span className="font-label-sm text-label-sm text-on-surface-variant">Showing 1–8 of 4,821</span>
      <div className="flex items-center gap-space-xs">
        <button className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface font-label-sm text-label-sm disabled:opacity-50" disabled>Previous</button>
        <button className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm font-bold">1</button>
        <button className="px-3 py-1.5 rounded-lg bg-surface-ground text-on-surface font-label-sm text-label-sm">2</button>
        <button className="px-3 py-1.5 rounded-lg bg-surface-ground text-on-surface font-label-sm text-label-sm">3</button>
        <button className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface font-label-sm text-label-sm">Next</button>
      </div>
    </div>
  );
}

function FormField({ label, placeholder, select }: { label: string; placeholder: string; select?: boolean }) {
  return (
    <div>
      <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">{label}</label>
      {select ? (
        <select className="w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm text-body-sm outline-none text-on-surface-variant">
          <option>{placeholder}</option>
        </select>
      ) : (
        <input placeholder={placeholder} className="w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm text-body-sm outline-none" />
      )}
    </div>
  );
}

const BODIES: Record<string, (p: { screen: Screen }) => React.ReactNode> = {
  dashboard: DashboardBody,
  table: TableBody,
  form: FormBody,
  detail: DetailBody,
  approval: ApprovalBody,
  config: ConfigBody,
  wizard: WizardBody,
  ledger: LedgerBody,
  inbox: InboxBody,
  upload: UploadBody,
  verify: VerifyBody,
  search: SearchBody,
};

/* ------------------------------------------------------------------ *
 * Reusable screen chrome (header + permission chips + access gate).
 * Deep screens reuse this so every screen shares one header treatment.
 * ------------------------------------------------------------------ */
export function ScreenChrome({
  module,
  screen,
  actions,
  subtitle,
  implemented,
  children,
}: {
  module: Module;
  screen: Screen;
  /** Header action controls. Deep screens provide their own; omit for none. */
  actions?: React.ReactNode;
  subtitle?: string;
  /** Capabilities the screen really implements; replaces the preview-derived access chips and the preview lock. */
  implemented?: readonly string[];
  children: React.ReactNode;
}) {
  const { role } = useRole();
  const { t } = useLang();
  const codes = accessCodesFor(role, module, screen);

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md">
      <div className="flex flex-col gap-space-md">
        <div className="flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant">
          <Link href="/app" className="hover:text-primary">{t("app.console")}</Link>
          <Icon name="chevron_right" size={14} />
          <span>{t(`module.${module.id}`)}</span>
          <Icon name="chevron_right" size={14} />
          <span className="text-on-surface font-semibold">{screen.name}</span>
        </div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md">
          <div className="flex items-start gap-space-sm">
            <span className="w-11 h-11 rounded-lg bg-forest-light text-primary flex items-center justify-center shrink-0">
              <Icon name={module.icon} size={24} fill />
            </span>
            <div>
              <h1 className="font-headline-md text-headline-md text-on-surface">{screen.name}</h1>
              <div className="flex items-center gap-space-sm mt-1 flex-wrap">
                <span className="font-label-sm text-label-sm text-on-surface-variant">{subtitle ?? `${screen.archetype} ${t("app.screenSuffix")}`}</span>
                <span className="text-on-surface-variant/40">•</span>
                {implemented ? (
                  <span className="font-label-sm text-label-sm text-on-surface-variant" data-testid="implemented-capabilities">
                    Implemented here: {implemented.join(" · ")}
                  </span>
                ) : (
                  <>
                    <span className="font-label-sm text-label-sm text-on-surface-variant">{t("app.yourAccess")}</span>
                    {codes.length ? codes.map((c) => <Chip key={c} code={c} />) : <span className="font-label-sm text-label-sm text-error">{t("app.noAccess")}</span>}
                  </>
                )}
              </div>
            </div>
          </div>
          {actions}
        </div>
      </div>

      {codes.length === 0 && !implemented ? (
        <div className="bg-surface-card rounded-xl shadow-sm p-space-2xl text-center">
          <Icon name="lock" size={40} className="text-outline" />
          <p className="font-body-md text-body-md text-on-surface mt-2">{t("app.notAvailable")}</p>
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t("app.switchRole")}</p>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The generic scaffold (archetype-driven) for screens without a deep impl.
 * ------------------------------------------------------------------ */
export function ScreenScaffold({ module, screen }: { module: Module; screen: Screen }) {
  const { role } = useRole();
  const codes = accessCodesFor(role, module, screen);
  const Body = BODIES[screen.archetype] ?? TableBody;
  return (
    <ScreenChrome module={module} screen={screen} actions={<ActionBar codes={codes} />}>
      <Body screen={screen} />
    </ScreenChrome>
  );
}

/* Shared primitives re-exported for deep screens. */
export { Card, StatCard, FakeTable, Status, OK, WARN, BAD, INFO };
