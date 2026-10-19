"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { DescriptionList } from "@/components/app/kit/StatePanels";
import { ApplicationDocuments } from "@/components/app/lifecycle/ApplicationDocuments";
import { ApplicationHistory } from "@/components/app/lifecycle/ApplicationHistory";
import { type ModelApplication, stateLabel } from "@/lib/client/runtimeModelApplications";

type Rows = Parameters<typeof DescriptionList>[0]["rows"];

function Card({ title, icon, children, testId, className = "" }: { title: string; icon: string; children: ReactNode; testId?: string; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border-subtle bg-white shadow-sm overflow-hidden ${className}`} data-testid={testId}>
      <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-container-lowest/70 px-space-md py-2.5">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon name={icon} size={16} />
        </span>
        <div role="heading" aria-level={3} className="font-label-md font-semibold text-on-surface">{title}</div>
      </div>
      <div className="p-space-md">{children}</div>
    </div>
  );
}

/**
 * A single case laid out as a review page: summary header, evidence and rating cards, the recorded history, and the decision
 * panel. The commands themselves (recommend, return, reject) are passed in, so Spring still decides every action.
 */
export function CaseView({
  application,
  backHref,
  testIdPrefix,
  detailFieldsTestId,
  historyTestIdPrefix,
  rows,
  rating,
  provisional,
  decision,
}: {
  application: ModelApplication;
  backHref: string;
  testIdPrefix: string;
  detailFieldsTestId: string;
  historyTestIdPrefix: string;
  rows: Rows;
  rating?: ReactNode;
  provisional: string;
  decision: ReactNode;
}) {
  return (
    <div className="space-y-space-md">
      <div className="rounded-2xl bg-gradient-to-r from-forest-dark to-primary text-on-primary shadow-md p-space-md lg:p-space-lg">
        <div className="flex flex-wrap items-start justify-between gap-space-md">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.14em] text-on-primary/70">Model application</p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-wide">{application.reference}</p>
            <p className="mt-2 text-base font-medium">{application.brandName} · {application.modelNumber}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-white/15 px-2.5 py-1">{application.organisation}</span>
              <span className="rounded-full bg-white/15 px-2.5 py-1">Category {application.category}</span>
              <span className="rounded-full bg-white/15 px-2.5 py-1">Version {application.version}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full bg-white/95 px-3 py-1.5 text-sm font-semibold capitalize text-on-surface shadow-sm" data-testid={`${testIdPrefix}-stage-chip`}>
              {application.state === "director_review" ? "Awaiting BEE Officer recommendation" : application.state === "secretary_approval" ? "Awaiting Director approval" : stateLabel(application.state)}
            </span>
            <Link href={backHref} className="inline-flex items-center gap-1 text-xs font-semibold text-on-primary/90 hover:underline" data-testid={`${testIdPrefix}-detail-close`}>
              <Icon name="arrow_back" size={14} /> Back to the queue
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-space-md lg:grid-cols-2">
        <Card title="Application and evidence" icon="fact_check">
          <DescriptionList testId={detailFieldsTestId} rows={rows} />
        </Card>
        <div className="space-y-space-md">
          <Card title="Rating" icon="star">{rating}</Card>
          <Card title="Test reports" icon="science">
            <ApplicationDocuments key={application.id} applicationId={application.id} />
          </Card>
        </div>
      </div>

      <Card title="History" icon="history">
        <ApplicationHistory key={application.id} applicationId={application.id} testIdPrefix={historyTestIdPrefix} />
      </Card>

      <Card title="Your decision" icon="gavel">
        <div className="space-y-space-sm">
          <p className="text-xs text-on-surface-variant">{provisional}</p>
          {decision}
        </div>
      </Card>
    </div>
  );
}
