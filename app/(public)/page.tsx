"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Stars } from "@/components/ui/Stars";
import { ApplianceCard } from "@/components/public/ApplianceCard";
import { HeroCarousel } from "@/components/public/HeroCarousel";
import { ProgrammeTiles, StatsDashboard, PhotoGallery, PortalsRow } from "@/components/public/GovSections";
import { LeadershipBlock, GovLinksStrip, QuickLinksMap } from "@/components/public/HomeExtras";
import { WhatsNew } from "@/components/public/WhatsNew";
import { SectionHeader } from "@/components/public/SectionHeader";
import { Reveal } from "@/components/public/Reveal";
import { useLang } from "@/components/i18n/LangProvider";
import { APPLIANCES, CATEGORIES } from "@/lib/mock/appliances";
import { REGISTRATION_HREF } from "@/lib/registrationFlow";

const TIERS = [
  { title: "5-Star Inverter AC", desc: "Variable speed BLDC compressor, ISEER > 5.20", stars: 5, kwh: "571", bill: "₹4,568", five: "₹22,840", co2: "2.34 Tonnes", note: "Baseline Efficiency Reference (Tier 1)", accent: "bg-primary-container", box: "bg-forest-light", kwhColor: "text-forest-dark", noteColor: "text-primary", extra: "" },
  { title: "3-Star Inverter AC", desc: "Standard Dual Inverter, ISEER ~3.85 - 4.10", stars: 3, kwh: "840", bill: "₹6,720", five: "₹33,600", co2: "3.44 Tonnes", note: "Cost penalty: +₹10,760 over 5 yrs", accent: "bg-secondary", box: "bg-surface-container", kwhColor: "text-secondary", noteColor: "text-on-surface-variant", extra: "+269 units / yr extra power" },
  { title: "1-Star Standard AC", desc: "Non-inverter rotary motor, ISEER ~3.30", stars: 1, kwh: "1,150", bill: "₹9,200", five: "₹46,000", co2: "4.71 Tonnes", note: "Excess Bill Cost: +₹23,160 in 5 Yrs", accent: "bg-outline", box: "bg-surface-container-high", kwhColor: "text-on-surface", noteColor: "text-error", extra: "+579 units / yr excess drain" },
];

export default function HomePage() {
  const { t } = useLang();
  return (
    <div className="flex flex-col w-full">
      {/* Hero slideshow */}
      <HeroCarousel />

      {/* Programme dashboard strip */}
      <StatsDashboard />

      {/* What's New — notices / tenders / events / recruitment */}
      <Reveal><WhatsNew /></Reveal>

      {/* Programme & scheme tiles */}
      <Reveal><ProgrammeTiles /></Reveal>

      {/* Category strip */}
      <Reveal>
      <section className="w-full bg-surface-container-lowest py-space-lg">
        <div className="max-w-7xl mx-auto px-gutter">
          <SectionHeader title={t("cat.title")} viewAllHref="/directory" viewAllLabel={t("cat.all")} />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-space-sm">
            {CATEGORIES.map((c, i) => (
              <Link
                key={c.name}
                href="/directory"
                className={`group flex flex-col items-center text-center p-space-sm rounded-xl transition-all ${
                  i === 0 ? "bg-forest-light text-forest-dark shadow-sm" : "bg-surface-ground text-on-surface"
                } hover:bg-primary hover:text-on-primary`}
              >
                <div className="w-12 h-12 rounded-lg bg-surface-card flex items-center justify-center text-primary group-hover:bg-on-primary/10 group-hover:text-on-primary mb-2 transition-all">
                  <Icon name={c.icon} size={26} />
                </div>
                <span className="font-label-md text-label-md leading-tight font-semibold">{c.name}</span>
                <span className="font-label-sm text-label-sm opacity-70 mt-0.5">{c.sub}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
      </Reveal>

      {/* Savings comparison */}
      <Reveal>
      <section className="w-full bg-gradient-to-b from-surface-ground to-surface py-space-2xl">
        <div className="max-w-7xl mx-auto px-gutter">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-space-md mb-space-xl">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-container text-on-primary font-label-sm text-label-sm uppercase tracking-wider mb-space-xs">
                <Icon name="calculate" size={16} /> Official BEE Calculator
              </div>
              <h2 className="font-headline-lg text-headline-lg text-on-surface">Interactive Energy & Bill Savings Comparison Tool</h2>
              <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl mt-1">
                Calculate your direct household savings by switching between BEE star tiers. Baseline: 1.5-Ton Split AC, 1,600 operating hours/year at standard Indian residential tariff.
              </p>
            </div>
            <div className="bg-surface-card p-space-sm rounded-xl shadow-sm flex items-center gap-space-md">
              <div className="flex flex-col">
                <span className="font-label-sm text-label-sm text-on-surface-variant">Domestic Grid Tariff</span>
                <span className="font-title-lg text-title-lg text-navy-dark font-bold">₹8.00 / kWh (Avg)</span>
              </div>
              <Link href="/calculator" className="px-3 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high font-label-sm text-label-sm text-on-surface">
                Change State Tariff
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-space-lg mb-space-lg">
            {TIERS.map((t, i) => (
              <div key={t.title} className="bg-surface-card rounded-xl p-space-lg shadow-md relative overflow-hidden flex flex-col justify-between">
                <div className={`absolute top-0 inset-x-0 h-1.5 ${t.accent}`} />
                <div>
                  <div className="flex items-center justify-between mb-space-sm">
                    <span className={`px-2.5 py-0.5 rounded-full font-label-sm text-label-sm font-bold uppercase tracking-wider ${i === 0 ? "bg-forest-light text-forest-dark" : "bg-surface-container text-on-surface-variant"}`}>
                      {i === 0 ? "Recommended Choice" : i === 1 ? "Standard Mid-Tier" : "Lowest Permitted Band"}
                    </span>
                    <div className="bg-navy-dark px-2 py-0.5 rounded-full">
                      <Stars value={t.stars} size={14} />
                    </div>
                  </div>
                  <h3 className="font-headline-sm text-headline-sm text-on-surface">{t.title}</h3>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">{t.desc}</p>
                  <div className={`mt-space-md p-space-md ${t.box} rounded-xl`}>
                    <div className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">Annual Power Consumed</div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className={`font-display-lg text-display-lg font-bold ${t.kwhColor} leading-none`}>{t.kwh}</span>
                      <span className={`font-title-lg text-title-lg ${t.kwhColor}`}>kWh / yr</span>
                    </div>
                    {t.extra && <div className="font-label-sm text-label-sm text-error mt-1">{t.extra}</div>}
                  </div>
                  <div className="mt-space-md space-y-space-xs font-body-sm text-body-sm">
                    <Row k="Annual Electricity Bill" v={t.bill} />
                    <Row k="5-Year Electricity Total" v={t.five} />
                    <Row k="CO₂ Footprint (5 Yrs)" v={t.co2} />
                  </div>
                </div>
                <div className="mt-space-md pt-space-md">
                  <div className={`p-space-xs rounded-lg bg-surface-ground text-center font-label-sm text-label-sm font-bold ${t.noteColor}`}>
                    {t.note}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-forest-dark text-on-primary p-space-lg rounded-xl shadow-md flex flex-col md:flex-row items-center justify-between gap-space-lg">
            <div className="flex items-center gap-space-md">
              <div className="w-14 h-14 rounded-full bg-primary-container text-on-primary flex items-center justify-center shrink-0">
                <Icon name="savings" size={32} />
              </div>
              <div>
                <div className="font-label-sm text-label-sm text-primary-fixed uppercase tracking-wider font-semibold">Consumer Financial Payback Proof</div>
                <div className="font-headline-md text-headline-md font-bold text-on-primary">
                  Save over <span className="text-solar-gold">₹23,160</span> in 5 Years with BEE 5-Star Certification
                </div>
                <p className="font-body-sm text-body-sm text-forest-light/80 mt-0.5">
                  The upfront price premium of a 5-Star appliance is recovered within 14 to 18 operating months through reduced discom monthly bills.
                </p>
              </div>
            </div>
            <button className="bg-solar-gold text-navy-dark font-label-lg text-label-lg px-space-md py-2.5 rounded-lg font-bold hover:bg-solar-gold-dark hover:text-on-primary transition-all flex items-center gap-1.5 shadow shrink-0" type="button">
              <Icon name="download" size={18} /> Detailed Savings PDF
            </button>
          </div>
        </div>
      </section>
      </Reveal>

      {/* Directory preview */}
      <Reveal>
      <section className="w-full bg-surface py-space-2xl" id="appliance-directory">
        <div className="max-w-7xl mx-auto px-gutter">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md mb-space-xl">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-primary-container" />
                <span className="font-label-sm text-label-sm text-primary uppercase font-bold tracking-wider">Live Register</span>
              </div>
              <h2 className="font-headline-lg text-headline-lg text-on-surface">Official BEE Verified Appliance Registry</h2>
              <p className="font-body-md text-body-md text-on-surface-variant">
                Displaying validated commercial production models certified under S&L Bureau testing protocols.
              </p>
            </div>
            <Link href="/directory" className="font-label-lg text-label-lg text-primary hover:underline flex items-center gap-1 shrink-0">
              Open full directory <Icon name="arrow_forward" size={18} />
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-lg">
            {APPLIANCES.map((a) => (
              <ApplianceCard key={a.regId} a={a} />
            ))}
          </div>
        </div>
      </section>

      </Reveal>

      {/* Leadership — quote, About BEE & ministers */}
      <Reveal><LeadershipBlock /></Reveal>

      {/* Photo gallery */}
      <Reveal><PhotoGallery /></Reveal>

      {/* Portals */}
      <Reveal><PortalsRow /></Reveal>

      {/* Dual pillar */}
      <Reveal>
      <section className="w-full bg-surface-container-low py-space-2xl">
        <div className="max-w-7xl mx-auto px-gutter">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-xl">
            <div className="bg-surface-card p-space-xl rounded-xl shadow-md flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-space-sm mb-space-sm">
                  <span className="w-10 h-10 rounded-lg bg-secondary-fixed text-on-secondary-fixed flex items-center justify-center">
                    <Icon name="factory" size={24} />
                  </span>
                  <div>
                    <span className="font-label-sm text-label-sm text-secondary font-bold uppercase tracking-wider">Stakeholder Services</span>
                    <h3 className="font-headline-sm text-headline-sm text-on-surface">Manufacturer & Testing Lab Gateway</h3>
                  </div>
                </div>
                <p className="font-body-md text-body-md text-on-surface-variant mt-space-sm">
                  OEMs, authorized importers, and accredited testing laboratories can submit quarterly production reports, file label renewals, and upload NABL verification data.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm mt-space-md">
                  <div className="p-space-sm rounded-lg bg-surface-ground flex flex-col gap-1">
                    <span className="font-title-lg text-title-lg text-on-surface font-semibold flex items-center gap-1.5">
                      <Icon name="verified_user" size={18} className="text-primary" /> OEM Star Portal
                    </span>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">New model registration & label approval workflow</span>
                  </div>
                  <div className="p-space-sm rounded-lg bg-surface-ground flex flex-col gap-1">
                    <span className="font-title-lg text-title-lg text-on-surface font-semibold flex items-center gap-1.5">
                      <Icon name="science" size={18} className="text-secondary" /> NABL Lab Network
                    </span>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">Search 140+ accredited test facilities across India</span>
                  </div>
                </div>
              </div>
              <div className="mt-space-lg flex flex-wrap items-center gap-space-sm pt-space-md">
                <Link href={REGISTRATION_HREF} className="bg-primary text-on-primary font-label-lg text-label-lg px-space-md py-2.5 rounded-lg hover:bg-primary-container transition-all flex items-center gap-2 shadow-sm" data-testid="home-manufacturer-register">
                  <Icon name="app_registration" size={18} /> Register
                </Link>
                <Link href="/login" className="bg-secondary text-on-secondary font-label-lg text-label-lg px-space-md py-2.5 rounded-lg hover:bg-on-secondary-fixed-variant transition-all flex items-center gap-2 shadow-sm">
                  <Icon name="login" size={18} /> Manufacturer S&L Login
                </Link>
                <Link href="/programmes" className="bg-surface-container text-on-surface font-label-lg text-label-lg px-space-md py-2.5 rounded-lg hover:bg-surface-container-high transition-all flex items-center gap-1.5">
                  <Icon name="download" size={18} /> Regulations & Form 1-A
                </Link>
              </div>
            </div>

            <div className="bg-surface-card p-space-xl rounded-xl shadow-md flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-solar-gold-light/40 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
              <div>
                <div className="flex items-center gap-space-sm mb-space-sm">
                  <span className="w-10 h-10 rounded-lg bg-solar-gold-light text-solar-gold-dark flex items-center justify-center">
                    <Icon name="shield" size={24} />
                  </span>
                  <div>
                    <span className="font-label-sm text-label-sm text-solar-gold-dark font-bold uppercase tracking-wider">Citizen Consumer Protection</span>
                    <h3 className="font-headline-sm text-headline-sm text-on-surface">How to Spot Counterfeit Star Labels</h3>
                  </div>
                </div>
                <p className="font-body-md text-body-md text-on-surface-variant mt-space-sm">
                  Section 26 of the Energy Conservation Act, 2001 prohibits affixing unauthorized energy efficiency labels. Inspect these 3 markers before purchase:
                </p>
                <div className="space-y-space-sm mt-space-md">
                  {[
                    { t: "Dynamic QR Code Scan", d: "Must resolve only to the official domain: beestarlabel.gov.in/verify. Beware of fake third-party URLs." },
                    { t: "BEE Logo & Slogan Alignment", d: "Look for the sharp bilingual ring 'ऊर्जा जीवन है, संरक्षण करें' alongside the official Bureau insignia without pixelation." },
                    { t: "Validity Date Stamping", d: "Check validity duration on the label. Expired-validity labels indicate uncertified inventory stock." },
                  ].map((m, i) => (
                    <div key={m.t} className="flex items-start gap-space-sm p-space-sm rounded-lg bg-surface-ground">
                      <span className="w-6 h-6 rounded-full bg-forest-dark text-on-primary flex items-center justify-center font-bold text-label-sm shrink-0 mt-0.5">{i + 1}</span>
                      <div>
                        <strong className="font-title-lg text-title-lg text-on-surface block">{m.t}</strong>
                        <span className="font-body-sm text-body-sm text-on-surface-variant">{m.d}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-space-lg flex flex-wrap items-center gap-space-sm pt-space-md">
                <Link href="/contact" className="bg-error text-on-error font-label-lg text-label-lg px-space-md py-2.5 rounded-lg hover:bg-on-error-container transition-all flex items-center gap-2 shadow-sm">
                  <Icon name="report_problem" size={18} /> Report Fraudulent Star Rating
                </Link>
                <Link href="/contact" className="bg-surface-container text-on-surface font-label-lg text-label-lg px-space-md py-2.5 rounded-lg hover:bg-surface-container-high transition-all flex items-center gap-1.5">
                  <Icon name="support_agent" size={18} /> Consumer Vigilance Cell
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
      </Reveal>

      {/* Government partner links */}
      <Reveal><GovLinksStrip /></Reveal>

      {/* Quick links & location map */}
      <Reveal><QuickLinksMap /></Reveal>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-on-surface-variant">{k}</span>
      <span className="font-bold text-on-surface">{v}</span>
    </div>
  );
}
