"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { DataTable, type DataTableColumn } from "@/components/app/kit/DataTable";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { QrCode } from "@/components/app/lifecycle/QrCode";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { verificationUrl } from "@/lib/client/qr";
import { gateRead } from "@/lib/client/runtimeHttp";
import { type ModelApplication, readModelApplication, readModelApplicationList } from "@/lib/client/runtimeModelApplications";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

/**
 * The printable certificate and label for an approved application (WP09.1b; the owner's assumptions D7 to D9, not BEE's decisions).
 * A local demonstration, not issued by BEE and without legal effect, and each document says so. The QR code points to the public
 * verification page for the registration ID. The browser's Print produces the PDF.
 */
const ROUTE = "/app/model-label/label-preview";
const LIST_TARGET = "list";
const loadList = () => readModelApplicationList();
const loadDetail = (id: string) => readModelApplication(id);

export const CERTIFICATE_DOC_COPY = {
  listTitle: "Approved applications",
  loading: "Loading…",
  empty: "No application of yours has been approved yet.",
  demo: "LOCAL DEMONSTRATION: not issued by BEE, no legal effect.",
  scan: "Scan to verify this registration",
  notApproved: "This application has no certificate: only an approved application is issued one.",
} as const;

export function CertificateAndLabel({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const selectedId = useSearchParams().get("id");
  const revalidation = useRevalidation();
  const list = gateRead(identity.status, useRuntimeRead(selectedId ? null : LIST_TARGET, loadList, revalidation));
  const detail = gateRead(identity.status, useRuntimeRead(selectedId, loadDetail, revalidation));

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Printable certificate and label" implemented={runtimeRouteFor(ROUTE)?.implemented}>
      <div className="space-y-space-md" data-testid="certdocs-screen">
        <div className="print-hidden">
          <IdentityStrip identity={identity} testId="certdocs-identity" />
        </div>
        {selectedId ? (
          <ReadPanel
            title="Certificate and label"
            read={detail}
            loadingText={CERTIFICATE_DOC_COPY.loading}
            loadingTestId="certdocs-loading"
            errorTestId="certdocs-error"
            signInReturnTo={ROUTE}
            action={
              <Link href={ROUTE} className="font-label-sm text-label-sm text-primary hover:underline print-hidden" data-testid="certdocs-back">
                All approved applications
              </Link>
            }
          >
            {(r) => <Documents application={r.application} />}
          </ReadPanel>
        ) : (
          <ReadPanel
            title={CERTIFICATE_DOC_COPY.listTitle}
            read={list}
            loadingText={CERTIFICATE_DOC_COPY.loading}
            loadingTestId="certdocs-loading"
            errorTestId="certdocs-error"
            signInReturnTo={ROUTE}
            isEmpty={(r) => r.list.items.filter((a) => a.state === "approved").length === 0}
            emptyText={CERTIFICATE_DOC_COPY.empty}
            emptyTestId="certdocs-empty"
          >
            {(r) => <ApprovedTable items={r.list.items.filter((a) => a.state === "approved")} />}
          </ReadPanel>
        )}
      </div>
    </ScreenChrome>
  );
}

function ApprovedTable({ items }: { items: ModelApplication[] }) {
  const columns: DataTableColumn<ModelApplication>[] = [
    { key: "reference", header: "Reference", sortValue: (a) => a.reference, render: (a) => <span className="font-mono" data-testid={`certdocs-ref-${a.reference}`}>{a.reference}</span> },
    { key: "brand", header: "Brand / Model", sortValue: (a) => `${a.brandName} ${a.modelNumber}`, render: (a) => `${a.brandName} ${a.modelNumber}` },
    {
      key: "open",
      header: "",
      render: (a) => (
        <Link href={`${ROUTE}?id=${encodeURIComponent(a.id)}`} className="font-label-sm text-label-sm text-primary hover:underline" data-testid={`certdocs-open-${a.reference}`}>
          Open certificate and label
        </Link>
      ),
    },
  ];
  return <DataTable columns={columns} rows={items} rowKey={(a) => a.id} pageSize={100} tableTestId="certdocs-table" filterTestId="certdocs-filter" />;
}

function Documents({ application }: { application: ModelApplication }) {
  const cert = application.certificate;
  if (application.state !== "approved" || !cert) {
    return <p className="font-body-sm text-body-sm text-on-surface-variant" data-testid="certdocs-none">{CERTIFICATE_DOC_COPY.notApproved}</p>;
  }
  const url = verificationUrl(typeof window === "undefined" ? "" : window.location.origin, cert.registrationId);
  const stars = `${"★".repeat(cert.stars)}${"☆".repeat(5 - cert.stars)}`;
  return (
    <div className="space-y-space-md">
      <div className="print-hidden">
        <button type="button" onClick={() => window.print()} className="px-space-md py-2 rounded-lg bg-primary text-on-primary font-label-md" data-testid="certdocs-print">
          Print or save as PDF
        </button>
      </div>
      <div className="print-document space-y-space-lg">
        <article className="border-2 border-on-surface rounded-xl p-space-lg bg-white text-black" data-testid="certificate-document" data-status={cert.status}>
          <p className="font-label-sm text-label-sm tracking-wide text-center" data-testid="certificate-demo">{CERTIFICATE_DOC_COPY.demo}</p>
          <h2 className="font-headline-md text-headline-md text-center mt-space-sm">Certificate of registration</h2>
          <p className="text-center font-title-md text-title-md font-mono mt-space-sm" data-testid="certificate-registration">{cert.registrationId}</p>
          <dl className="grid grid-cols-2 gap-x-space-lg gap-y-space-xs mt-space-md font-body-md text-body-md">
            <dt className="text-on-surface-variant">Manufacturer</dt>
            <dd data-testid="certificate-organisation">{application.organisation}</dd>
            <dt className="text-on-surface-variant">Brand and model</dt>
            <dd data-testid="certificate-model">{application.brandName} {application.modelNumber}</dd>
            <dt className="text-on-surface-variant">Category</dt>
            <dd data-testid="certificate-category">{application.category}</dd>
            <dt className="text-on-surface-variant">Star rating</dt>
            <dd data-testid="certificate-rating">{stars} ({cert.stars}) · efficiency {cert.verifiedIseer}</dd>
            <dt className="text-on-surface-variant">Valid</dt>
            <dd data-testid="certificate-validity">{cert.validFrom} to {cert.validTo} ({cert.status.replaceAll("_", " ")})</dd>
          </dl>
          <div className="flex items-end justify-between mt-space-lg">
            <p className="font-label-sm text-label-sm text-on-surface-variant max-w-xs">Rating scheme {cert.schemeKey}, a local demonstration scheme.</p>
            <div className="text-center">
              <QrCode text={url} title={`Verification code for ${cert.registrationId}`} testId="certificate-qr" />
              <p className="font-label-sm text-label-sm mt-1">{CERTIFICATE_DOC_COPY.scan}</p>
            </div>
          </div>
        </article>
        <article className="border-4 border-on-surface rounded-xl p-space-lg bg-white text-black max-w-sm mx-auto print-break-before" data-testid="label-document">
          <p className="font-label-sm text-label-sm text-center" data-testid="label-demo">{CERTIFICATE_DOC_COPY.demo}</p>
          <h2 className="font-title-lg text-title-lg text-center mt-space-xs">Star label</h2>
          <p className="text-center text-4xl mt-space-sm" aria-label={`${cert.stars} stars`} data-testid="label-stars">{stars}</p>
          <p className="text-center font-title-md text-title-md mt-space-xs" data-testid="label-iseer">ISEER {cert.verifiedIseer}</p>
          <p className="text-center font-body-md text-body-md mt-space-sm" data-testid="label-model">{application.brandName} {application.modelNumber}</p>
          <p className="text-center font-mono font-label-md text-label-md mt-space-xs" data-testid="label-registration">{cert.registrationId}</p>
          <div className="flex justify-center mt-space-md">
            <QrCode text={url} size={120} title={`Verification code for ${cert.registrationId}`} testId="label-qr" />
          </div>
          <p className="text-center font-label-sm text-label-sm mt-1" data-testid="label-validity">Valid until {cert.validTo}</p>
        </article>
      </div>
    </div>
  );
}
