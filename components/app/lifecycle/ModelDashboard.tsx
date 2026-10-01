"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Card, FakeTable, ScreenChrome } from "@/components/app/ScreenScaffold";
import { orgsText, refreshIdentity, rolesText, useSpringIdentity } from "@/components/app/SessionBadge";
import { modelDraftFormHref } from "@/lib/client/runtimeModelDrafts";
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
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

/**
 * WP05.1a read-only list/detail on the existing model-dashboard route.
 * Rows come only from the authenticated BFF; lifecycle localStorage is not used here.
 * Create/edit/submit/fee/rating/approval controls are not offered as operational actions.
 *
 * Records are shown only while the Spring identity is signed in. The identity, list and
 * selected detail are read again when the tab regains focus or becomes visible, when the
 * page is restored from the back-forward cache, and every 30 s; a failed read (sign-out,
 * expiry, revoked role, outage) replaces the records instead of leaving them on screen.
 */
const REVALIDATE_MS = 30_000;
const SIGNED_OUT = { ok: false, failure: { kind: "session", code: "no_session", message: READ_UI_MESSAGES.no_session } } as const;

export function ModelDashboard({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const params = useSearchParams();
  const selectedId = params.get("id");

  const [listRead, setListRead] = useState<ListRead | null>(null);
  const [detail, setDetail] = useState<{ id: string; read: DetailRead } | null>(null);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState !== "visible") return;
      refreshIdentity();
      setEpoch((e) => e + 1);
    };
    const restored = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setListRead(null);
      setDetail(null);
      revalidate();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("pageshow", restored);
    const timer = window.setInterval(revalidate, REVALIDATE_MS);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("pageshow", restored);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let live = true;
    readModelApplicationList().then((r) => {
      if (live) setListRead(r);
    });
    return () => {
      live = false;
    };
  }, [epoch]);

  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    readModelApplication(selectedId).then((r) => {
      if (live) setDetail({ id: selectedId, read: r });
    });
    return () => {
      live = false;
    };
  }, [selectedId, epoch]);

  const detailRead = selectedId && detail?.id === selectedId ? detail.read : null;
  const shownList = gate(identity, listRead);
  const shownDetail = gate(identity, detailRead);

  return (
    <ScreenChrome
      module={module}
      screen={screen}
      subtitle="Server-persisted applications you may read"
      implemented={runtimeRouteFor(modelDashboardHref())?.implemented}
      actions={
        identity.status === "signed-in" ? (
          <Link href={modelDraftFormHref()} className="inline-flex items-center gap-1 px-space-md py-2 rounded-lg bg-primary text-on-primary font-label-md" data-testid="model-app-new-draft">
            New application <Icon name="note_add" size={18} />
          </Link>
        ) : null
      }
    >
      <div className="space-y-space-md" data-testid="model-applications-read">
        <IdentityStrip identity={identity} />

        <div className={`grid grid-cols-1 gap-space-md ${selectedId ? "lg:grid-cols-5" : ""}`}>
          <div className={selectedId ? "lg:col-span-3" : ""}>
            <ListPanel listRead={shownList} selectedId={selectedId} />
          </div>
          {selectedId ? (
            <div className="lg:col-span-2">
              <DetailPanel selectedId={selectedId} detailRead={shownDetail} />
            </div>
          ) : null}
        </div>
      </div>
    </ScreenChrome>
  );
}

/** Nothing while the identity is loading; never records unless Spring reports a signed-in identity. */
function gate<T extends ListRead | DetailRead>(identity: ReturnType<typeof useSpringIdentity>, read: T | null): T | null {
  if (identity.status === "loading") return null;
  if (identity.status === "signed-out") return (read && !read.ok ? read : SIGNED_OUT) as T;
  return read;
}

function IdentityStrip({ identity }: { identity: ReturnType<typeof useSpringIdentity> }) {
  return (
    <Card>
      <div className="flex items-start gap-space-sm" data-testid="model-applications-identity">
        <Icon name="badge" size={20} className="text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">Signed-in identity (BEE records)</div>
          {identity.status === "loading" ? (
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-1" data-testid="model-applications-identity-loading">Checking your sign-in…</p>
          ) : identity.status === "signed-out" ? (
            <p className="font-body-sm text-body-sm text-on-surface mt-1">No signed-in BEE identity with an active role.</p>
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
          <span key="acts" className="inline-flex flex-col gap-1 items-start">
            <Link
              href={modelDashboardHref(a.id)}
              className={`font-label-sm text-label-sm inline-flex items-center gap-1 ${a.id === selectedId ? "text-on-surface font-semibold" : "text-primary hover:underline"}`}
              data-testid={`model-app-open-${a.reference}`}
            >
              {a.id === selectedId ? "Selected" : "View"} <Icon name="arrow_forward" size={14} />
            </Link>
            {a.state === "draft" ? (
              <Link
                href={modelDraftFormHref(a.id)}
                className="font-label-sm text-label-sm text-primary hover:underline inline-flex items-center gap-1"
                data-testid={`model-app-edit-${a.reference}`}
              >
                Edit <Icon name="edit" size={14} />
              </Link>
            ) : null}
          </span>,
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
          <>
            <DetailFields application={detailRead.application} />
            {detailRead.application.state === "draft" ? (
              <Link
                href={modelDraftFormHref(detailRead.application.id)}
                className="inline-flex items-center gap-1 mt-space-md px-space-md py-2 rounded-lg bg-primary text-on-primary font-label-md"
                data-testid="model-app-detail-edit"
              >
                Edit draft <Icon name="edit" size={18} />
              </Link>
            ) : null}
          </>
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
