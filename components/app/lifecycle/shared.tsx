"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Stars } from "@/components/ui/Stars";
import { previewRoleOf, useRole } from "@/components/app/RoleContext";
import {
  ModelApplication,
  STAGE_META,
  STAGE_ORDER,
  Stage,
  stageIndex,
} from "@/lib/mock/lifecycle";

/** The display name used as the "actor" when the current role acts. */
export function useActor(): string {
  const { role } = useRole();
  return previewRoleOf(role).name;
}

export function StageBadge({ app }: { app: ModelApplication }) {
  const meta = STAGE_META[app.stage];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-sm text-label-sm font-semibold ${meta.tone}`}>
      {app.returned && <Icon name="undo" size={13} />}
      {app.returned ? "Returned" : meta.label}
    </span>
  );
}

export function StageStepper({ app }: { app: ModelApplication }) {
  const activeIdx = stageIndex(app.stage);
  const rejected = app.stage === "rejected";
  return (
    <div className="flex items-center gap-1 overflow-x-auto app-scroll py-1">
      {STAGE_ORDER.map((s, i) => {
        const done = !rejected && i < activeIdx;
        const active = !rejected && i === activeIdx;
        return (
          <div key={s} className="flex items-center gap-1 shrink-0">
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-label-sm text-label-sm ${
                active
                  ? "bg-primary text-on-primary font-semibold"
                  : done
                    ? "bg-success-light text-success font-medium"
                    : "bg-surface-container text-on-surface-variant"
              }`}
            >
              <Icon name={done ? "check_circle" : active ? "radio_button_checked" : "radio_button_unchecked"} size={14} fill={done} />
              {STAGE_META[s].short}
            </div>
            {i < STAGE_ORDER.length - 1 && <span className={`w-4 h-px ${done ? "bg-success" : "bg-border-strong"}`} />}
          </div>
        );
      })}
    </div>
  );
}

export function PipelineBar({ apps }: { apps: ModelApplication[] }) {
  const counts: Record<Stage, number> = {
    fee_due: 0, iame_scrutiny: 0, bee_scrutiny: 0, approval: 0, rating: 0, label: 0, active: 0, rejected: 0,
  };
  apps.forEach((a) => (counts[a.stage] += 1));
  const cells: { stage: Stage; label: string }[] = STAGE_ORDER.map((s) => ({ stage: s, label: STAGE_META[s].short }));
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-space-sm">
      {cells.map((c) => (
        <div key={c.stage} className="bg-surface-card rounded-xl shadow-sm p-space-sm text-center">
          <div className="font-headline-md text-headline-md font-bold text-primary">{counts[c.stage]}</div>
          <div className="font-label-sm text-label-sm text-on-surface-variant">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

export function ApplicationSummary({ app }: { app: ModelApplication }) {
  const rows: [string, React.ReactNode][] = [
    ["Reference", app.id],
    ["Applicant", app.brand],
    ["Model", app.model],
    ["Category", app.category],
    ["Declared ISEER", app.declaredIseer.toFixed(2)],
    ["Test lab", app.lab],
    ["Test date", app.testDate],
    ["Fee", `₹${app.fee.toLocaleString("en-IN")} ${app.feePaid ? "· paid" : "· due"}`],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-space-md">
      {rows.map(([k, v]) => (
        <div key={k}>
          <div className="font-label-sm text-label-sm text-on-surface-variant">{k}</div>
          <div className="font-title-lg text-title-lg text-on-surface">{v}</div>
        </div>
      ))}
      {app.rating && (
        <div>
          <div className="font-label-sm text-label-sm text-on-surface-variant">Rating</div>
          <Stars value={app.rating} size={18} />
        </div>
      )}
    </div>
  );
}

export function Timeline({ app }: { app: ModelApplication }) {
  return (
    <ol className="relative border-l border-border-strong ml-2 space-y-space-md">
      {app.timeline.map((t, i) => (
        <li key={i} className="ml-space-md">
          <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-primary" />
          <div className="font-body-sm text-body-sm text-on-surface font-semibold">{t.label}</div>
          <div className="font-label-sm text-label-sm text-on-surface-variant">{t.at} · {t.actor}</div>
        </li>
      ))}
    </ol>
  );
}

export function AppLink({ app, screen }: { app: ModelApplication; screen: string }) {
  return (
    <Link href={`/app/model-label/${screen}?id=${app.id}`} className="text-primary hover:underline font-label-sm text-label-sm inline-flex items-center gap-1">
      Open <Icon name="arrow_forward" size={14} />
    </Link>
  );
}
