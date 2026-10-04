"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { PREVIEW_SUFFIX, useRole } from "@/components/app/RoleContext";
import { useLang } from "@/components/i18n/LangProvider";
import { countForRole, SCREEN_COUNT } from "@/lib/screens";
import { categoriesForRole } from "@/lib/categories";
import { isExternalRole, RoleKey } from "@/lib/roles";
import { useLifecycle } from "@/components/app/LifecycleStore";

export default function AppOverview() {
  const { role } = useRole();
  const { t, lang } = useLang();
  const { tasks } = useLifecycle();
  const categories = categoriesForRole(role);
  const external = isExternalRole(role);
  const visible = countForRole(role);

  // Officer KPIs are computed from the SAME task set the personal inbox filters
  // to, so the dashboard cards and the inbox never disagree.
  const mine = tasks.filter((tk) => tk.ownerRoles.includes(role));
  const myQueue = mine.length;
  const myApprovals = mine.filter((tk) => tk.stage === "approval").length;
  const myOverdue = mine.filter((tk) => tk.overdue).length;

  // Partner summaries + KPIs are role-specific: an assessor, a state agency and
  // a lab do different work, so their wording and counts differ.
  const partner = PARTNER_DASH[role];
  const summary = external && partner
    ? t(partner.summaryKey).replace("{modules}", String(categories.length))
    : external
    ? t("app.partnerSummary").replace("{modules}", String(categories.length))
    : t("app.accessSummary")
        .replace("{visible}", String(visible))
        .replace("{total}", String(SCREEN_COUNT))
        .replace("{modules}", String(categories.length));

  const kpis = external
    ? (partner ?? PARTNER_DASH.manufacturer!).cards.map((c) => ({ icon: c.icon, label: t(c.labelKey), value: c.value, tone: c.tone }))
    : [
        { icon: "inbox", label: t("app.kpi.queue"), value: String(myQueue), tone: "text-primary" },
        { icon: "hourglass_top", label: t("app.kpi.approval"), value: String(myApprovals), tone: "text-solar-gold-dark" },
        { icon: "warning", label: t("app.kpi.sla"), value: String(myOverdue), tone: myOverdue ? "text-error" : "text-tertiary" },
        { icon: "task_alt", label: t("app.kpi.cleared"), value: "218", tone: "text-tertiary" },
      ];

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-lg">
      {/* Welcome */}
      <div className="bg-forest-dark text-on-primary rounded-xl p-space-lg flex flex-col md:flex-row md:items-center justify-between gap-space-md">
        <div>
          <div className="font-label-sm text-label-sm text-primary-fixed uppercase tracking-wider">{external ? t("app.partnerConsole") : t("app.officerConsole")}</div>
          <h1 className="font-headline-lg text-headline-lg font-bold" data-preview-role>{t("app.welcome").replace("{name}", t(`role.${role}`) + PREVIEW_SUFFIX)}</h1>
          <p className="font-body-md text-body-md text-forest-light/85 mt-1">{summary}</p>
        </div>
        <div className="flex items-center gap-space-md">
          <div className="text-center">
            <div className="font-display-lg text-display-lg font-bold text-solar-gold leading-none">{categories.length}</div>
            <div className="font-label-sm text-label-sm text-forest-light/80">{t("app.workAreas")}</div>
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md">
        {kpis.map((k) => (
          <div key={k.label} className="bg-surface-card rounded-xl shadow-sm p-space-md">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-on-surface-variant">{k.label}</span>
              <Icon name={k.icon} size={18} className={k.tone} />
            </div>
            <div className={`font-headline-md text-headline-md font-bold ${k.tone} mt-1`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Category grid */}
      <div>
        <h2 className="font-headline-sm text-headline-sm text-on-surface mb-space-md">{t("app.workAreasTitle")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-md">
          {categories.map((c) => (
            <div key={c.id} className="bg-surface-card rounded-xl shadow-sm p-space-md hover:shadow-md transition-all">
              <div className="flex items-center gap-space-sm mb-space-sm">
                <span className="w-10 h-10 rounded-lg bg-forest-light text-primary flex items-center justify-center">
                  <Icon name={c.icon} size={22} fill />
                </span>
                <div>
                  <h3 className="font-title-lg text-title-lg text-on-surface">{lang === "hi" ? c.hi : c.en}</h3>
                  <span className="font-label-sm text-label-sm text-on-surface-variant">{c.items.length} {t("app.areasWord")}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {c.items.map((it) => (
                  <Link key={it.href + it.en} href={it.href} className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface font-label-sm text-label-sm hover:bg-forest-light hover:text-forest-dark">
                    {lang === "hi" ? it.hi : it.en}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Per-role partner dashboards — distinct wording and counts by function. */
type PartnerCard = { icon: string; labelKey: string; value: string; tone: string };
const PARTNER_DASH: Partial<Record<RoleKey, { summaryKey: string; cards: PartnerCard[] }>> = {
  manufacturer: {
    summaryKey: "app.partnerSummary",
    cards: [
      { icon: "verified", labelKey: "app.kpi.pModels", value: "6", tone: "text-primary" },
      { icon: "note_add", labelKey: "app.kpi.pApplications", value: "2", tone: "text-solar-gold-dark" },
      { icon: "qr_code_2", labelKey: "app.kpi.pQr", value: "3", tone: "text-tertiary" },
      { icon: "confirmation_number", labelKey: "app.kpi.pTickets", value: "1", tone: "text-on-surface-variant" },
    ],
  },
  agency: {
    summaryKey: "app.partnerSummary",
    cards: [
      { icon: "verified", labelKey: "app.kpi.pModels", value: "14", tone: "text-primary" },
      { icon: "note_add", labelKey: "app.kpi.pApplications", value: "5", tone: "text-solar-gold-dark" },
      { icon: "qr_code_2", labelKey: "app.kpi.pQr", value: "8", tone: "text-tertiary" },
      { icon: "confirmation_number", labelKey: "app.kpi.pTickets", value: "2", tone: "text-on-surface-variant" },
    ],
  },
  iame: {
    summaryKey: "app.iameSummary",
    cards: [
      { icon: "assignment_ind", labelKey: "app.kpi.iAssigned", value: "9", tone: "text-primary" },
      { icon: "fact_check", labelKey: "app.kpi.iScrutiny", value: "3", tone: "text-solar-gold-dark" },
      { icon: "task_alt", labelKey: "app.kpi.iReports", value: "6", tone: "text-tertiary" },
      { icon: "confirmation_number", labelKey: "app.kpi.pTickets", value: "1", tone: "text-on-surface-variant" },
    ],
  },
  sda: {
    summaryKey: "app.sdaSummary",
    cards: [
      { icon: "folder_special", labelKey: "app.kpi.sCases", value: "4", tone: "text-primary" },
      { icon: "science", labelKey: "app.kpi.sSamples", value: "11", tone: "text-solar-gold-dark" },
      { icon: "storefront", labelKey: "app.kpi.sChecks", value: "2", tone: "text-error" },
      { icon: "confirmation_number", labelKey: "app.kpi.pTickets", value: "1", tone: "text-on-surface-variant" },
    ],
  },
  laboratory: {
    summaryKey: "app.labSummary",
    cards: [
      { icon: "biotech", labelKey: "app.kpi.lAssignments", value: "7", tone: "text-primary" },
      { icon: "hourglass_top", labelKey: "app.kpi.lTests", value: "3", tone: "text-solar-gold-dark" },
      { icon: "task_alt", labelKey: "app.kpi.lReports", value: "5", tone: "text-tertiary" },
      { icon: "confirmation_number", labelKey: "app.kpi.pTickets", value: "0", tone: "text-on-surface-variant" },
    ],
  },
};
