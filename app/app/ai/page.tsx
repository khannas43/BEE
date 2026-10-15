"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { AI_USECASES, HEALTH_META, AIDisclaimer } from "@/components/app/ai/AIScreens";

export default function AIInsightsLanding() {
  return (
    <div className="insights-screen">
    <div className="p-space-md lg:p-space-lg space-y-space-md">
      {/* Header */}
      <div className="flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant">
        <Link href="/app" className="hover:text-primary">Console</Link>
        <Icon name="chevron_right" size={14} />
        <span>Insights and AI</span>
        <Icon name="chevron_right" size={14} />
        <span className="text-on-surface font-semibold">AI Insights</span>
      </div>
      <div className="flex items-start gap-space-sm">
        <span className="w-11 h-11 rounded-lg bg-forest-light text-primary flex items-center justify-center shrink-0"><Icon name="auto_awesome" size={24} fill /></span>
        <div>
          <h1 className="font-headline-md text-headline-md text-on-surface">AI Insights</h1>
          <p className="font-label-sm text-label-sm text-on-surface-variant">Five committed AI use cases — each surfaces exceptions for human review; nothing acts automatically.</p>
        </div>
      </div>

      <AIDisclaimer />

      {/* Use-case cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-space-md">
        {AI_USECASES.map((u) => {
          const h = HEALTH_META[u.status];
          return (
            <Link key={u.id} href={u.href} className="group bg-surface-card rounded-xl shadow-sm p-space-md hover:shadow-md transition-all flex flex-col">
              <div className="flex items-center gap-space-sm mb-space-sm">
                <span className="w-10 h-10 rounded-lg bg-primary-container/50 text-primary flex items-center justify-center shrink-0"><Icon name={u.icon} size={22} fill /></span>
                <div className="min-w-0">
                  <h3 className="font-title-lg text-title-lg text-on-surface truncate">{u.title}</h3>
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-label-sm text-label-sm font-semibold ${h.tone}`}><Icon name={h.icon} size={12} /> {h.label}</span>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-label-sm text-label-sm font-semibold ${u.state === "Shadow" ? "bg-solar-gold-light text-solar-gold-dark" : "bg-success-light text-success"}`}>{u.state === "Shadow" ? "Shadow" : "Live"}</span>
                  </div>
                </div>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mb-space-sm flex-1">{u.purpose}</p>

              <div className="grid grid-cols-3 gap-space-xs mb-space-sm">
                <Metric label="Analysed" value={u.recordsAnalysed.toLocaleString("en-IN")} tone="text-on-surface" />
                <Metric label="Exceptions" value={u.exceptions ? String(u.exceptions) : "—"} tone="text-error" />
                <Metric label="Awaiting review" value={u.awaitingReview ? String(u.awaitingReview) : "—"} tone="text-solar-gold-dark" />
              </div>

              <div className="flex items-center justify-between border-t border-border-subtle pt-space-sm">
                <div className="font-label-sm text-label-sm text-on-surface-variant">
                  <span className="flex items-center gap-1"><Icon name="schedule" size={12} /> {u.lastRun}</span>
                  <span className="flex items-center gap-1"><Icon name="deployed_code" size={12} /> {u.model}</span>
                </div>
                <span className="flex items-center gap-1 font-label-md text-label-md text-primary font-semibold group-hover:gap-2 transition-all">Open <Icon name="arrow_forward" size={16} /></span>
              </div>
            </Link>
          );
        })}

        {/* Governance card — restricted */}
        <Link href="/app/mis-ai/model-monitoring" className="group bg-navy-subtle rounded-xl shadow-sm p-space-md hover:shadow-md transition-all flex flex-col border border-navy-dark/20">
          <div className="flex items-center gap-space-sm mb-space-sm">
            <span className="w-10 h-10 rounded-lg bg-navy-dark/10 text-navy-dark flex items-center justify-center shrink-0"><Icon name="shield" size={22} fill /></span>
            <div>
              <h3 className="font-title-lg text-title-lg text-on-surface">AI Model Governance</h3>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-label-sm text-label-sm font-semibold bg-navy-dark/15 text-navy-dark"><Icon name="lock" size={12} /> Restricted</span>
            </div>
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant mb-space-sm flex-1">Versions, drift, retraining, override rates, rollback and fairness evidence — separate from business insights.</p>
          <div className="flex items-center justify-between border-t border-navy-dark/15 pt-space-sm">
            <span className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1"><Icon name="deployed_code" size={12} /> 5 models registered</span>
            <span className="flex items-center gap-1 font-label-md text-label-md text-navy-dark font-semibold group-hover:gap-2 transition-all">Open <Icon name="arrow_forward" size={16} /></span>
          </div>
        </Link>
      </div>
    </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="bg-surface-container-low rounded-lg p-space-sm text-center">
      <div className={`font-title-md text-title-md font-bold ${tone}`}>{value}</div>
      <div className="font-label-sm text-label-sm text-on-surface-variant leading-tight">{label}</div>
    </div>
  );
}
