"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Card, FakeTable, ScreenChrome } from "@/components/app/ScreenScaffold";
import { orgsText, rolesText, useSpringIdentity } from "@/components/app/SessionBadge";
import {
  type DetailRead,
  type ListRead,
  type ModelApplication,
  modelDashboardHref,
  READ_UI_MESSAGES,
  readModelApplication,
  readModelApplicationList,
  stateLabel,
} from "@/lib/client/runtimeModelApplications";
import { Module, Screen } from "@/lib/screens";

/**
 * WP05.1a read-only list/detail on the existing model-dashboard route.
 * Rows come only from the authenticated BFF; lifecycle localStorage is not used here.
 * Create/edit/submit/fee/rating/approval controls are not offered as operational actions.
 */
export function ModelDashboard({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const params = useSearchParams();
  const selectedId = params.get("id");

  const [listRead, setListRead] = useState<ListRead | null>(null);
  const [detail, setDetail] = useState<{ id: string; read: DetailRead } | null>(null);

  useEffect(() => {
    let live = true;
    readModelApplicationList().then((r) => {
      if (live) setListRead(r);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    readModelApplication(selectedId).then((r) => {
      if (live) setDetail({ id: selectedId, read: r });
    });
    return () => {
      live = false;
    };
  }, [selectedId]);

  const detailRead = selectedId && detail?.id === selectedId ? detail.read : null;

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Server-persisted applications you may read">
      <div className="space-y-space-md" data-testid="model-applications-read">
        <IdentityStrip identity={identity} />

        <div className={`grid grid-cols-1 gap-space-md ${selectedId ? "lg:grid-cols-5" : ""}`}>
          <div className={selectedId ? "lg:col-span-3" : ""}>
            <ListPanel listRead={listRead} selectedId={selectedId} />
          </div>
          {selectedId ? (
            <div className="lg:col-span-2">
              <DetailPanel selectedId={selectedId} detailRead={detailRead} />
            </div>
          ) : null}
        </div>
      </div>
    </ScreenChrome>
  );
}

function IdentityStrip({ identity }: { identity: ReturnType<typeof useSpringIdentity> }) {
  return (
    <Card>
      <div className="flex items-start gap-space-sm" data-testid="model-applications-identity">
        <Icon name="badge" size={20} className="text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">Signed-in identity (BEE records)</div>
          {identity.status === "loading" ? (
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">Loading identity…</p>
          ) : identity.status === "signed-out" ? (
            <p className="font-body-sm text-body-sm text-on-surface mt-1">{READ_UI_MESSAGES.no_session}</p>
          ) : (
            <p className="font-body-sm text-body-sm text-on-surface mt-1">
              <span className="font-semibold">{identity.me.displayName}</span>
              {" · "}
              {rolesText(identity.me)}
              {orgsText(identity.me) ? ` · ${orgsText(identity.me)}` : ""}
            </p>
          )}
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
            The development preview role above is not your identity and does not grant access to these records.
          </p>
        </div>
      </div>
    </Card>
  );
}

function ListPanel({ listRead, selectedId }: { listRead: ListRead | null; selectedId: string | null }) {
  if (!listRead) {
    return (
      <Card title="My model applications">
        <p className="font-body-md text-body-md text-on-surface-variant" data-testid="model-applications-loading">{READ_UI_MESSAGES.loading}</p>
      </Card>
    );
  }

  if (!listRead.ok) {
    return (
      <Card title="My model applications">
        <FailureBanner failure={listRead.failure} testId="model-applications-list-error" />
      </Card>
    );
  }

  const { list } = listRead;
  if (list.count === 0) {
    return (
      <Card title="My model applications" action={<span className="font-label-sm text-label-sm text-on-surface-variant">0 records</span>}>
        <p className="font-body-md text-body-md text-on-surface-variant" data-testid="model-applications-empty">{READ_UI_MESSAGES.empty_list}</p>
      </Card>
    );
  }

  return (
    <Card title="My model applications" action={<span className="font-label-sm text-label-sm text-on-surface-variant">{list.count} records</span>}>
      <FakeTable
        columns={["Reference", "Organisation", "Brand / Model", "Category", "State", ""]}
        rows={list.items.map((a) => [
          <span key="ref" className="font-mono" data-testid={`model-app-ref-${a.reference}`}>{a.reference}</span>,
          a.organisation,
          <div key="m">
            <div className="font-semibold text-on-surface">{a.brandName}</div>
            <div className="font-label-sm text-label-sm text-on-surface-variant">{a.modelNumber}</div>
          </div>,
          a.category,
          <span key="s" className="capitalize">{stateLabel(a.state)}</span>,
          <Link
            key="open"
            href={modelDashboardHref(a.id)}
            className={`font-label-sm text-label-sm inline-flex items-center gap-1 ${a.id === selectedId ? "text-on-surface font-semibold" : "text-primary hover:underline"}`}
            data-testid={`model-app-open-${a.reference}`}
          >
            {a.id === selectedId ? "Selected" : "View"} <Icon name="arrow_forward" size={14} />
          </Link>,
        ])}
      />
    </Card>
  );
}

function DetailPanel({ selectedId, detailRead }: { selectedId: string; detailRead: DetailRead | null }) {
  return (
    <Card
      title="Application detail"
      action={
        <Link href={modelDashboardHref()} className="font-label-sm text-label-sm text-primary hover:underline inline-flex items-center gap-1" data-testid="model-app-detail-close">
          Close <Icon name="close" size={14} />
        </Link>
      }
    >
      <div data-testid="model-applications-detail" data-selected-id={selectedId}>
        {!detailRead ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{READ_UI_MESSAGES.loading_detail}</p>
        ) : !detailRead.ok ? (
          <FailureBanner failure={detailRead.failure} testId="model-applications-detail-error" />
        ) : (
          <DetailFields application={detailRead.application} />
        )}
      </div>
    </Card>
  );
}

function DetailFields({ application }: { application: ModelApplication }) {
  const rows: { label: string; value: string; mono?: boolean; capitalize?: boolean }[] = [
    { label: "Reference", value: application.reference, mono: true },
    { label: "Organisation", value: application.organisation },
    { label: "Brand", value: application.brandName },
    { label: "Model number", value: application.modelNumber },
    { label: "Category", value: application.category },
    { label: "State", value: stateLabel(application.state), capitalize: true },
    { label: "Version", value: String(application.version) },
    { label: "Read basis", value: application.readBasis.join(", ") },
    { label: "Record id", value: application.id, mono: true },
  ];
  return (
    <dl className="space-y-space-sm" data-testid="model-applications-detail-fields">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">{row.label}</dt>
          <dd className={`font-body-sm text-body-sm text-on-surface mt-0.5 ${row.mono ? "font-mono break-all" : ""} ${row.capitalize ? "capitalize" : ""}`}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FailureBanner({ failure, testId }: { failure: Extract<ListRead, { ok: false }>["failure"]; testId: string }) {
  const icon = failure.kind === "session" ? "login" : failure.kind === "forbidden" ? "lock" : failure.kind === "not_found" ? "search_off" : "error";
  return (
    <div className="flex items-start gap-space-sm" data-testid={testId} data-failure-kind={failure.kind} data-failure-code={"code" in failure ? failure.code : failure.kind}>
      <Icon name={icon} size={20} className="text-error shrink-0 mt-0.5" />
      <div>
        <p className="font-body-md text-body-md text-on-surface">{failure.message}</p>
        {failure.kind === "not_found" ? (
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">The same message is shown whether the identifier is unknown or outside your scope.</p>
        ) : null}
        {failure.kind === "session" ? (
          <Link href="/api/auth/login?returnTo=/app/model-label/model-dashboard" className="inline-flex items-center gap-1 mt-space-sm font-label-md text-label-md text-primary hover:underline">
            Sign in <Icon name="arrow_forward" size={14} />
          </Link>
        ) : null}
      </div>
    </div>
  );
}
