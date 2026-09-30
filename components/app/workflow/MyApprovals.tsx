"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Card, Status, OK, WARN, BAD } from "@/components/app/ScreenScaffold";
import { previewRoleOf, useRole } from "@/components/app/RoleContext";
import { PRIMARY_CERT } from "@/lib/mock/certificate";

/* ================================================================== *
 * My Approvals (audit gap fill). One approval inbox that collects the
 * per-module approval actions into role-appropriate work items, with
 * certificate context drawn from the record — so Director/Secretary
 * don't need every operational screen in their sidebar.
 * ================================================================== */

type Who = "director" | "secretary" | "reviewer";
interface Item {
  id: string; kind: string; subject: string; requestedBy: string; date: string; sla: string;
  who: Who[]; cert?: boolean; href: string;
}
const ITEMS: Item[] = [
  { id: "APP-2026-05016", kind: "Model — Director approval", subject: "Nova Cool · FrostMax 1.5T (5★)", requestedBy: "A. Kapoor (Programme)", date: "24 Sep 2026, 08:40", sla: "6h left", who: ["director"], cert: true, href: "/app/model-label/label-preview" },
  { id: "APP-2026-05016", kind: "Model — Secretary approval", subject: "Nova Cool · FrostMax 1.5T (5★)", requestedBy: "Director (BEE)", date: "24 Sep 2026, 09:05", sla: "1d left", who: ["secretary"], cert: true, href: "/app/model-label/label-preview" },
  { id: "WDR-2026-0221", kind: "Withdrawal approval", subject: "AquaBreeze 2T — voluntary withdrawal", requestedBy: "R. Menon (Reviewer)", date: "23 Sep 2026, 16:20", sla: "2d left", who: ["director", "reviewer"], href: "/app/registrations/record" },
  { id: "SP-Q2-118", kind: "Sample-plan approval", subject: "Q2 enforcement sampling plan", requestedBy: "S. Rao (SDA)", date: "22 Sep 10:00", sla: "SLA breached", who: ["reviewer", "director"], href: "/app/enforcement/case" },
  { id: "BRD-2026-0455", kind: "Brand approval", subject: "PolarPro brand registration", requestedBy: "Programme Officer", date: "21 Sep 14:30", sla: "3d left", who: ["reviewer"], href: "/app/agency-brand/brand-registration" },
  { id: "ENF-2026-0417", kind: "Enforcement closure", subject: "FrostMax — revocation decision", requestedBy: "R. Menon (SDA)", date: "18 Oct 11:00", sla: "1d left", who: ["director", "secretary"], href: "/app/enforcement/case" },
];

export function MyApprovals() {
  const { role } = useRole();
  const officer = previewRoleOf(role);
  const [done, setDone] = useState<Record<string, string>>({});
  const mine = ITEMS.filter((i) => (i.who as string[]).includes(role));

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md">
      <div className="flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant">
        <Link href="/app" className="hover:text-primary">Console</Link>
        <Icon name="chevron_right" size={14} />
        <span>My Work</span>
        <Icon name="chevron_right" size={14} />
        <span className="text-on-surface font-semibold">My Approvals</span>
      </div>
      <div className="flex items-start gap-space-sm">
        <span className="w-11 h-11 rounded-lg bg-forest-light text-primary flex items-center justify-center shrink-0"><Icon name="task_alt" size={24} fill /></span>
        <div>
          <h1 className="font-headline-md text-headline-md text-on-surface">My Approvals</h1>
          <p className="font-label-sm text-label-sm text-on-surface-variant">Approval work items for {officer.name} — {mine.length} pending. Actions carry maker-checker and an audit entry.</p>
        </div>
      </div>

      {mine.length === 0 ? (
        <Card>
          <div className="flex items-center gap-space-sm text-on-surface-variant py-space-md"><Icon name="inbox" size={20} /> <span className="font-body-md text-body-md">No approvals are pending for the {officer.name} role. Switch role from the top bar to preview another approver's queue.</span></div>
        </Card>
      ) : (
        <div className="space-y-space-sm">
          {mine.map((i, idx) => {
            const acted = done[i.id + idx];
            return (
              <Card key={i.id + idx}>
                <div className="flex flex-col md:flex-row md:items-center gap-space-md">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-space-sm flex-wrap">
                      <span className="font-title-md text-title-md text-on-surface">{i.subject}</span>
                      <Status label={i.sla} tone={i.sla.includes("breach") ? BAD : "bg-surface-container text-on-surface-variant"} />
                    </div>
                    <div className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">{i.kind} · {i.id} · from {i.requestedBy} · {i.date}</div>
                    {i.cert && (
                      <div className="flex items-center gap-space-sm mt-space-sm bg-surface-container-low rounded-lg p-space-sm">
                        <Icon name="verified_user" size={16} className="text-primary" />
                        <span className="font-label-sm text-label-sm text-on-surface">Certificate context: {PRIMARY_CERT.certId} · v{PRIMARY_CERT.currentVersion} · <Link href={i.href} className="text-primary hover:underline">open ledger record</Link></span>
                      </div>
                    )}
                  </div>
                  {acted ? (
                    <Status label={acted} tone={acted === "Approved" ? OK : acted === "Rejected" ? BAD : WARN} />
                  ) : (
                    <div className="flex gap-space-sm shrink-0">
                      <button type="button" onClick={() => setDone((d) => ({ ...d, [i.id + idx]: "Approved" }))} className="flex items-center gap-1.5 bg-primary text-on-primary font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg hover:bg-forest-dark"><Icon name="check" size={16} /> Approve</button>
                      <button type="button" onClick={() => setDone((d) => ({ ...d, [i.id + idx]: "Returned" }))} className="flex items-center gap-1.5 bg-surface-container text-on-surface font-label-md text-label-md py-2 px-space-sm rounded-lg hover:bg-solar-gold-light"><Icon name="undo" size={16} /> Return</button>
                      <button type="button" onClick={() => setDone((d) => ({ ...d, [i.id + idx]: "Rejected" }))} className="flex items-center gap-1.5 bg-error-container text-on-error-container font-label-md text-label-md py-2 px-space-sm rounded-lg hover:bg-error hover:text-on-error"><Icon name="close" size={16} /> Reject</button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
