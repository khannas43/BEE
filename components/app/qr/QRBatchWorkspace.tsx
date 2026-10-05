"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { PseudoQR } from "@/components/ui/PseudoQR";
import { Card, Status, OK, WARN } from "@/components/app/ScreenScaffold";

/* ================================================================== *
 * QR Batch Workspace (Phase 3) — combines QR generation, status, file
 * download, serial upload, duplicate handling and QR download into one
 * batch-centric workspace (DDD IA revision).
 * ================================================================== */

type BStatus = "Requested" | "Allocated" | "Binding" | "Complete";

interface Dup { serial: string; reason: string; }
interface Batch {
  id: string; model: string; regId: string; requested: number; range: string;
  status: BStatus; allocated: number; bound: number; printed: number;
  requestedOn: string; allocatedOn: string; dupList: Dup[];
}

const BATCHES: Batch[] = [
  {
    id: "QRB-2026-0731", model: "FrostMax 1.5T (5★)", regId: "BEE/RAC/2026/10016", requested: 5000,
    range: "10016-000001 → 10016-005000", status: "Binding", allocated: 5000, bound: 3820, printed: 3560,
    requestedOn: "02 Sep 2026", allocatedOn: "03 Sep 2026",
    dupList: [
      { serial: "10016-002214", reason: "Serial already bound in QRB-2026-0688" },
      { serial: "10016-003901", reason: "Duplicate row in uploaded file" },
      { serial: "10016-004770", reason: "Serial format mismatch" },
    ],
  },
  {
    id: "QRB-2026-0729", model: "CoolWave 1T (4★)", regId: "BEE/RAC/2026/10011", requested: 2000,
    range: "10011-000001 → 10011-002000", status: "Complete", allocated: 2000, bound: 2000, printed: 2000,
    requestedOn: "28 Aug 2026", allocatedOn: "29 Aug 2026", dupList: [],
  },
  {
    id: "QRB-2026-0740", model: "PolarPro 2T (5★)", regId: "BEE/RAC/2026/10022", requested: 8000,
    range: "Pending allocation", status: "Requested", allocated: 0, bound: 0, printed: 0,
    requestedOn: "12 Sep 2026", allocatedOn: "—", dupList: [],
  },
];

const STATUS_TONE: Record<BStatus, string> = {
  Requested: "bg-navy-subtle text-navy-dark", Allocated: WARN, Binding: WARN, Complete: OK,
};

const TABS = [
  { id: "overview", label: "Overview", icon: "summarize" },
  { id: "upload", label: "Serial upload", icon: "upload_file" },
  { id: "duplicates", label: "Duplicates", icon: "content_copy" },
  { id: "downloads", label: "Downloads", icon: "download" },
];

export default function QRBatchWorkspace() {
  const [batchId, setBatchId] = useState(BATCHES[0].id);
  const [tab, setTab] = useState("overview");
  const b = BATCHES.find((x) => x.id === batchId)!;
  const pct = b.requested ? Math.round((b.bound / b.requested) * 100) : 0;

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md">
      <div className="flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant">
        <Link href="/app" className="hover:text-primary">Console</Link>
        <Icon name="chevron_right" size={14} />
        <span>Labels &amp; Production</span>
        <Icon name="chevron_right" size={14} />
        <span className="text-on-surface font-semibold">QR Batch</span>
      </div>

      {/* Header + picker */}
      <div className="bg-surface-card rounded-xl shadow-sm p-space-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md">
          <div className="flex items-start gap-space-sm">
            <span className="w-11 h-11 rounded-lg bg-forest-light text-primary flex items-center justify-center shrink-0"><Icon name="qr_code_2" size={24} fill /></span>
            <div>
              <div className="flex items-center gap-space-sm flex-wrap">
                <h1 className="font-headline-md text-headline-md text-on-surface">{b.id}</h1>
                <Status label={b.status} tone={STATUS_TONE[b.status]} />
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">{b.model} · {b.regId}</p>
              <p className="font-label-sm text-label-sm text-on-surface-variant">Requested {b.requestedOn} · {b.requested.toLocaleString("en-IN")} codes</p>
            </div>
          </div>
          <div className="flex items-center gap-space-sm">
            <button className="flex items-center gap-1.5 bg-primary text-on-primary font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg hover:bg-forest-dark"><Icon name="add" size={16} /> Request batch</button>
            <select value={batchId} onChange={(e) => { setBatchId(e.target.value); setTab("overview"); }} className="px-space-sm py-2 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none">
              {BATCHES.map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}
            </select>
          </div>
        </div>

        {/* Progress */}
        <div className="mt-space-md pt-space-md border-t border-border-subtle">
          <div className="flex items-center justify-between font-label-sm text-label-sm text-on-surface-variant mb-1">
            <span>Binding progress</span><span className="font-semibold text-on-surface">{b.bound.toLocaleString("en-IN")} / {b.requested.toLocaleString("en-IN")} ({pct}%)</span>
          </div>
          <div className="h-2.5 rounded-full bg-surface-container overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, pct)}%` }} /></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto app-scroll border-b border-border-subtle">
        {TABS.map((tb) => {
          const active = tab === tb.id;
          const badge = tb.id === "duplicates" && b.dupList.length ? b.dupList.length : null;
          return (
            <button key={tb.id} type="button" onClick={() => setTab(tb.id)}
              className={`flex items-center gap-1.5 px-space-sm py-2.5 font-label-md text-label-md whitespace-nowrap border-b-2 transition-colors ${active ? "border-primary text-primary font-semibold" : "border-transparent text-on-surface-variant hover:text-on-surface"}`}>
              <Icon name={tb.icon} size={16} fill={active} /> {tb.label}
              {badge && <span className="ml-1 px-1.5 rounded-full bg-error-container text-on-error-container font-label-sm text-label-sm">{badge}</span>}
            </button>
          );
        })}
      </div>

      {/* Panels */}
      {tab === "overview" && (
        <div className="space-y-space-md">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md">
            <Stat label="Allocated" value={b.allocated} icon="confirmation_number" tone="text-primary" />
            <Stat label="Bound to serials" value={b.bound} icon="link" tone="text-success" />
            <Stat label="Printed" value={b.printed} icon="print" tone="text-on-surface" />
            <Stat label="Duplicates" value={b.dupList.length} icon="content_copy" tone={b.dupList.length ? "text-error" : "text-on-surface-variant"} />
          </div>
          <Card title="Allocation">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
              <Field label="Model" value={b.model} />
              <Field label="Registration ID" value={b.regId} />
              <Field label="Serial range" value={b.range} />
              <Field label="Requested on" value={b.requestedOn} />
              <Field label="Allocated on" value={b.allocatedOn} />
              <Field label="Status" value={b.status} />
            </div>
          </Card>
        </div>
      )}

      {tab === "upload" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
          <Card title="Upload serials">
            <div className="border-2 border-dashed border-border-strong rounded-xl p-space-lg flex flex-col items-center text-center">
              <Icon name="upload_file" size={36} className="text-outline" />
              <p className="font-body-md text-body-md text-on-surface mt-2">Drop a serial CSV here, or browse</p>
              <p className="font-label-sm text-label-sm text-on-surface-variant">Columns: serial_no, manufacture_date</p>
              <button className="mt-space-sm flex items-center gap-1.5 bg-primary text-on-primary font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg hover:bg-forest-dark"><Icon name="folder_open" size={16} /> Browse file</button>
            </div>
          </Card>
          <Card title="Last upload — validation">
            <div className="space-y-space-sm">
              <ValRow icon="check_circle" tone="text-success" label="Accepted &amp; bound" value="1,820 rows" />
              <ValRow icon="content_copy" tone="text-error" label="Duplicates (skipped)" value="3 rows" />
              <ValRow icon="rule" tone="text-solar-gold-dark" label="Format warnings" value="12 rows" />
            </div>
            <div className="flex items-start gap-space-sm bg-surface-container-low rounded-lg p-space-sm mt-space-md">
              <Icon name="info" size={16} className="text-on-surface-variant shrink-0 mt-0.5" />
              <p className="font-body-sm text-body-sm text-on-surface">Duplicates are quarantined automatically — resolve them in the Duplicates tab before final QR download.</p>
            </div>
          </Card>
        </div>
      )}

      {tab === "duplicates" && (
        <Card title={`Duplicate / exception handling · ${b.dupList.length}`}>
          {b.dupList.length === 0 ? (
            <div className="flex items-center gap-space-sm text-on-surface-variant"><Icon name="check_circle" size={18} className="text-success" /> <span className="font-body-sm text-body-sm">No duplicates — this batch is clean.</span></div>
          ) : (
            <div className="space-y-1.5">
              {b.dupList.map((d) => (
                <div key={d.serial} className="flex items-center gap-space-sm bg-error-container/40 rounded-lg p-space-sm">
                  <Icon name="content_copy" size={18} className="text-error shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-body-sm text-body-sm text-on-surface font-semibold">{d.serial}</div>
                    <div className="font-label-sm text-label-sm text-on-surface-variant">{d.reason}</div>
                  </div>
                  <div className="flex gap-1.5">
                    <button className="font-label-sm text-label-sm bg-primary text-on-primary px-2 py-1 rounded hover:bg-forest-dark">Reassign serial</button>
                    <button className="font-label-sm text-label-sm bg-surface-container text-on-surface px-2 py-1 rounded hover:bg-forest-light">Ignore</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "downloads" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-md">
          <div className="lg:col-span-2">
            <Card title="Download files">
              <div className="space-y-space-sm">
                <DlRow icon="table_view" name="Allocation file (CSV)" meta={`${b.allocated.toLocaleString("en-IN")} codes · ${b.range}`} />
                <DlRow icon="qr_code_2" name="QR images (ZIP, PNG)" meta={`${b.bound.toLocaleString("en-IN")} bound codes`} />
                <DlRow icon="picture_as_pdf" name="Print sheet (PDF)" meta="A4 · 24 labels/page" />
                <DlRow icon="summarize" name="Batch reconciliation report" meta="Allocated vs bound vs printed" />
              </div>
            </Card>
          </div>
          <Card title="Sample QR">
            <div className="flex flex-col items-center gap-space-sm">
              <div className="p-space-sm bg-white rounded-lg shadow-sm"><PseudoQR value={b.regId} size={120} /></div>
              <div className="font-label-sm text-label-sm text-on-surface-variant text-center">{b.regId}<br />Decorative preview — scannable codes are in the ZIP.</div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><div className="font-label-sm text-label-sm text-on-surface-variant">{label}</div><div className="font-body-md text-body-md text-on-surface font-medium">{value}</div></div>;
}
function Stat({ label, value, icon, tone }: { label: string; value: number; icon: string; tone: string }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-sm p-space-md">
      <div className="flex items-center justify-between"><span className="font-label-sm text-label-sm text-on-surface-variant">{label}</span><Icon name={icon} size={18} className={tone} /></div>
      <div className={`font-headline-md text-headline-md font-bold ${tone} mt-1`}>{value.toLocaleString("en-IN")}</div>
    </div>
  );
}
function ValRow({ icon, tone, label, value }: { icon: string; tone: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-space-sm bg-surface-container-low rounded-lg p-space-sm">
      <Icon name={icon} size={18} className={tone} />
      <span className="flex-1 font-body-sm text-body-sm text-on-surface">{label}</span>
      <span className="font-label-md text-label-md text-on-surface font-semibold">{value}</span>
    </div>
  );
}
function DlRow({ icon, name, meta }: { icon: string; name: string; meta: string }) {
  return (
    <div className="flex items-center gap-space-sm bg-surface-container-low rounded-lg p-space-sm">
      <span className="w-9 h-9 rounded-lg bg-forest-light text-primary flex items-center justify-center shrink-0"><Icon name={icon} size={18} /></span>
      <div className="flex-1 min-w-0"><div className="font-body-sm text-body-sm text-on-surface font-medium">{name}</div><div className="font-label-sm text-label-sm text-on-surface-variant">{meta}</div></div>
      <button className="flex items-center gap-1.5 bg-surface-container text-on-surface font-label-md text-label-md py-1.5 px-space-sm rounded-lg hover:bg-primary hover:text-on-primary"><Icon name="download" size={16} /> Download</button>
    </div>
  );
}
