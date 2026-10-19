"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Pill } from "./DemoShell";
import {
  DEMO_DISCLOSURE,
  MANUFACTURER_360_DISCREPANCY,
  MANUFACTURER_360_EXTRA_LINKS,
  MANUFACTURER_360_FINANCE,
  MANUFACTURER_360_HEADER,
  MANUFACTURER_360_STAGES,
  MANUFACTURER_360_TIMELINE,
  MANUFACTURER_360_WP9_CARDS,
  WP9_PREVIEW_LABEL,
} from "@/lib/demo/manufacturer360Fixture";

const card = "rounded-2xl bg-white shadow p-space-md border border-[#e6eaf0]";
const sectionTitle = "font-title-sm text-on-surface mb-space-sm";

function HeaderKpis() {
  const h = MANUFACTURER_360_HEADER;
  const items: { key: string; label: string; value: string | number }[] = [
    { key: "brands", label: "Active brands", value: h.activeBrands },
    { key: "categories", label: "Registered categories", value: h.registeredCategories },
    { key: "models", label: "Approved models", value: h.approvedModels },
    { key: "qr-issued", label: "QR issued", value: h.qrIssued },
    { key: "qr-used", label: "QR used", value: h.qrUsed },
    { key: "production", label: "Production units", value: h.productionUnits },
    { key: "fees-paid", label: "Fees paid", value: h.feesPaidInr },
    { key: "fees-out", label: "Fees outstanding", value: h.feesOutstandingInr },
    { key: "renewals", label: "Renewals due", value: h.renewalsDue },
    { key: "discrepancies", label: "Open discrepancies", value: h.openDiscrepancies },
  ];
  return (
    <header className={card} data-testid="m360-header">
      <div className="flex flex-wrap items-start justify-between gap-space-md">
        <div>
          <p className="font-label-md uppercase tracking-wide text-on-surface-variant">Manufacturer 360</p>
          <h1 className="font-headline-md text-headline-md text-on-surface mt-1">{h.manufacturerName}</h1>
          <p className="font-body-sm text-on-surface-variant mt-1">{h.organisationId}</p>
        </div>
        <Pill>{h.complianceStatus}</Pill>
      </div>
      <dl className="mt-space-md grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-space-sm">
        {items.map((i) => (
          <div key={i.key} data-testid={`m360-kpi-${i.key}`}>
            <dt className="font-label-sm text-on-surface-variant">{i.label}</dt>
            <dd className="font-title-sm tabular-nums text-on-surface">{i.value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

function LifecycleRail() {
  return (
    <section className={card} aria-labelledby="m360-rail-heading">
      <h2 id="m360-rail-heading" className={sectionTitle}>
        WP3–WP9 lifecycle rail
      </h2>
      <ol className="space-y-space-md">
        {MANUFACTURER_360_STAGES.map((stage) => (
          <li
            key={stage.wp}
            className="rounded-xl border border-[#e6eaf0] p-space-md"
            data-testid={`m360-stage-${stage.wp}`}
          >
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary-container text-on-primary-container font-bold text-sm">
                {stage.wp}
              </span>
              <span className="font-title-sm text-on-surface">{stage.title}</span>
              {stage.status ? <Pill>{stage.status}</Pill> : null}
            </div>
            <dl className="grid sm:grid-cols-2 gap-x-space-md gap-y-1 font-body-sm break-words">
              <div>
                <dt className="text-on-surface-variant">Record</dt>
                <dd>{stage.recordReference}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant">Persona</dt>
                <dd>{stage.responsiblePersona}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant">Last action</dt>
                <dd>{stage.lastAction}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant">Next action</dt>
                <dd>{stage.nextAction}</dd>
              </div>
            </dl>
            <Link
              href={stage.screenHref}
              className="inline-flex items-center gap-1 mt-space-sm text-primary font-label-md hover:underline"
              data-testid={`m360-stage-link-${stage.wp}`}
            >
              Open working screen — {stage.screenLabel}
              <Icon name="open_in_new" size={16} />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Timeline() {
  return (
    <section className={card} data-testid="m360-timeline">
      <h2 className={sectionTitle}>Registration-to-production story</h2>
      <ol className="relative border-s border-[#d8e0ea] ms-3 ps-space-md space-y-3">
        {MANUFACTURER_360_TIMELINE.map((step, i) => (
          <li key={step.label} className="font-body-sm">
            <span className="absolute -start-[7px] mt-1.5 h-3 w-3 rounded-full bg-primary" aria-hidden />
            <span className="font-semibold text-on-surface">{step.label}</span>
            <span className="text-on-surface-variant"> — {step.stateOrEvent}</span>
            {i === 0 ? null : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function DiscrepancyPanel() {
  const d = MANUFACTURER_360_DISCREPANCY;
  return (
    <section className={card} data-testid="m360-discrepancy">
      <h2 className={sectionTitle}>Discrepancy panel (return → response → disposition)</h2>
      <p className="font-label-sm text-on-surface-variant mb-space-sm">{DEMO_DISCLOSURE}</p>
      <ul className="space-y-2 font-body-sm">
        <li>
          <strong>Issue:</strong> {d.issue}
        </li>
        <li>
          <strong>BEE return:</strong> {d.returnAction}
        </li>
        <li>
          <strong>Applicant response:</strong> {d.applicantResponse}
        </li>
        <li>
          <strong>Reviewer disposition:</strong> {d.disposition}
        </li>
        <li>
          <strong>SLA:</strong> {d.slaNote}
        </li>
        <li>
          <strong>Registration continued:</strong> {d.continuation}
        </li>
      </ul>
    </section>
  );
}

function FinanceQrPanel() {
  const f = MANUFACTURER_360_FINANCE;
  return (
    <section className={card} data-testid="m360-finance">
      <h2 className={sectionTitle}>Financial and QR reconciliation</h2>
      <p className="font-label-sm text-on-surface-variant mb-space-sm">{DEMO_DISCLOSURE}</p>
      <dl className="grid sm:grid-cols-2 gap-space-sm font-body-sm">
        <div>
          <dt className="text-on-surface-variant">Application fees paid</dt>
          <dd>{f.applicationFeesPaidInr}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-on-surface-variant">QR / label units paid</dt>
          <dd>{f.qrLabelUnitsPaidInr}</dd>
          <dd className="text-on-surface-variant mt-1">{f.qrPrepaymentAssumption}</dd>
        </div>
        <div>
          <dt className="text-on-surface-variant">Serials issued / bound / unused</dt>
          <dd>
            {f.serialsIssued} / {f.serialsBound} / {f.serialsUnused}
          </dd>
        </div>
        <div>
          <dt className="text-on-surface-variant">Production declared vs variance</dt>
          <dd>
            {f.productionDeclaredUnits} units ({f.varianceUnits} variance vs bound QR)
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-on-surface-variant">Annual label-fee reconciliation balance (due / settled)</dt>
          <dd>
            {f.labelFeeReconciliationDue} / {f.labelFeeReconciliationSettled}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Wp9Preview() {
  return (
    <section className={card} data-testid="m360-wp9">
      <h2 className={sectionTitle}>WP9 lifecycle preview</h2>
      <div className="grid sm:grid-cols-2 gap-space-md">
        {MANUFACTURER_360_WP9_CARDS.map((c) => (
          <article key={c.key} className="rounded-xl border border-[#e6eaf0] p-space-md" data-testid={`m360-wp9-${c.key}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-title-sm text-on-surface">{c.title}</h3>
              <Pill>{c.status}</Pill>
            </div>
            <p className="font-body-sm text-on-surface-variant mt-2">{c.detail}</p>
            {c.previewOnly ? (
              <p className="font-label-sm text-[#8a4b00] mt-2" data-testid={`m360-wp9-preview-label-${c.key}`}>
                {c.key === "revocation-active" ? null : WP9_PREVIEW_LABEL}
              </p>
            ) : null}
            {c.href && c.linkLabel ? (
              <Link href={c.href} className="inline-flex items-center gap-1 mt-space-sm text-primary font-label-md hover:underline">
                {c.linkLabel}
                <Icon name="open_in_new" size={16} />
              </Link>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function ExtraLinks() {
  return (
    <section className={card} data-testid="m360-extra-links">
      <h2 className={sectionTitle}>Related working screens</h2>
      <ul className="flex flex-wrap gap-x-space-md gap-y-2">
        {MANUFACTURER_360_EXTRA_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-primary font-label-md hover:underline" data-testid={`m360-link-${l.href.replace(/\//g, "-")}`}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Guided Manufacturer 360 demo across WP3–WP9 (synthetic fixture). */
export function Manufacturer360Demo() {
  return (
    <div className="space-y-space-lg max-w-6xl">
      <HeaderKpis />
      <LifecycleRail />
      <div className="grid lg:grid-cols-2 gap-space-lg">
        <Timeline />
        <DiscrepancyPanel />
      </div>
      <FinanceQrPanel />
      <Wp9Preview />
      <ExtraLinks />
    </div>
  );
}
