"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "../ui/Icon";
import { LANGUAGE_SWITCH_ENABLED, useLang } from "@/components/i18n/LangProvider";
import { useA11y } from "@/components/public/A11yProvider";
import { NAV } from "@/lib/nav";
import type { Lang } from "@/lib/i18n";
import { REGISTRATION_HREF } from "@/lib/registrationFlow";

export function PublicHeader() {
  const pathname = usePathname();
  const active = pathname === "/" ? "/" : "/" + (pathname.split("/")[1] ?? "");
  const { t, lang, toggle } = useLang();
  const a11y = useA11y();
  const [mobileNav, setMobileNav] = useState(false);
  const closeMobile = () => setMobileNav(false);

  return (
    <header className="fixed top-0 w-full z-50 shadow-[0_1px_8px_rgba(0,0,0,0.04)] bg-surface-container-lowest">
      {/* Tricolour accent */}
      <div className="h-1 w-full bg-gradient-to-r from-[#FF9933] via-surface-container-lowest to-primary" />

      {/* Government strip */}
      <div className="bg-secondary text-on-secondary px-gutter py-space-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between font-label-sm text-label-sm">
          <div className="flex items-center gap-space-md">
            <span className="text-secondary-fixed">भारत सरकार | {t("gov.india")}</span>
            <span className="text-secondary-fixed/50 hidden sm:inline">•</span>
            <span className="text-secondary-fixed hidden sm:inline">विद्युत मंत्रालय | {t("gov.mop")}</span>
          </div>
          <div className="flex items-center gap-space-md">
            <div className="hidden md:flex items-center gap-space-xs">
              <a className="text-on-secondary hover:text-secondary-fixed px-1" href="#main">{t("gov.skip")}</a>
              <span className="text-secondary-fixed/50">|</span>
              <a className="text-on-secondary hover:text-secondary-fixed px-1" href="#main">{t("gov.screenReader")}</a>
            </div>
            <div className="flex items-center gap-space-xs bg-navy-dark/40 px-space-xs py-0.5 rounded">
              <button onClick={a11y.smaller} aria-label={t("a11y.smaller")} className="text-on-secondary hover:text-secondary-fixed px-1 font-bold" type="button">A-</button>
              <button onClick={a11y.reset} aria-label={t("a11y.reset")} className="text-on-secondary hover:text-secondary-fixed px-1 font-bold" type="button">A</button>
              <button onClick={a11y.bigger} aria-label={t("a11y.bigger")} className="text-on-secondary hover:text-secondary-fixed px-1 font-bold" type="button">A+</button>
            </div>
            {LANGUAGE_SWITCH_ENABLED ? (
              <button
                onClick={toggle}
                className="bg-primary-container text-on-primary font-bold px-2 py-0.5 rounded text-label-sm hover:bg-forest-dark"
                type="button"
                aria-label="Toggle language"
              >
                {lang === "en" ? "हिन्दी" : "English"}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Masthead */}
      <div className="bg-surface-container-lowest px-gutter py-space-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-space-md">
          <Link href="/" className="flex items-center shrink-0" aria-label={t("brand.en")}>
            <Image src="/images/bee-logo.png" alt="Bureau of Energy Efficiency" width={1260} height={308} priority className="h-11 sm:h-14 w-auto object-contain" />
          </Link>
          <div className="flex items-center gap-space-md shrink-0">
            {/* Government co-branding */}
            <div className="hidden md:flex items-center gap-space-md">
              <Image src="/images/bee-25.jpg" alt="BEE at 25" width={267} height={81} className="h-8 lg:h-9 w-auto object-contain" />
              <Image src="/images/azadi.jpg" alt="Azadi Ka Amrit Mahotsav" width={200} height={81} className="h-8 lg:h-9 w-auto object-contain" />
              <Image src="/images/swachh-bharat.jpg" alt="Swachh Bharat" width={160} height={80} className="h-8 lg:h-9 w-auto object-contain" />
              <Image src="/images/ministry-of-power.png" alt="Ministry of Power, Government of India" width={204} height={100} className="h-9 lg:h-11 w-auto object-contain" />
            </div>
            <Link href="/login" className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0" aria-label={t("cta.login")}>
              <Icon name="person" size={18} className="text-on-primary" />
            </Link>
          </div>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="bg-forest-dark text-on-primary px-gutter relative" aria-label="Primary">
        <div className="max-w-7xl mx-auto flex items-center justify-between h-12">
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileNav((o) => !o)}
            aria-expanded={mobileNav}
            aria-controls="mobile-nav"
            aria-label={t("nav.menu")}
            className="lg:hidden inline-flex items-center gap-1.5 text-on-primary font-label-lg text-label-lg py-2"
          >
            <Icon name={mobileNav ? "close" : "menu"} size={24} /> {t("nav.menu")}
          </button>

          {/* Desktop nav */}
          <div className="hidden lg:flex items-center gap-space-md">
            {NAV.map((item) => {
              const isActive = item.href === active;
              const base = isActive
                ? "bg-primary-container text-on-primary font-title-lg text-title-lg rounded-lg"
                : "font-label-lg text-label-lg text-forest-light hover:text-on-primary";
              if (!item.groups) {
                return (
                  <Link key={item.href} href={item.href} aria-current={isActive ? "page" : undefined} className={`transition-colors py-2 px-space-xs whitespace-nowrap ${base}`}>
                    {t(item.key)}
                  </Link>
                );
              }
              return (
                <div key={item.href} className="relative group h-full flex items-center">
                  <Link href={item.href} aria-current={isActive ? "page" : undefined} className={`transition-colors py-2 px-space-xs whitespace-nowrap inline-flex items-center gap-0.5 ${base}`}>
                    {t(item.key)} <Icon name="expand_more" size={16} />
                  </Link>
                  {/* Dropdown panel */}
                  <div className="invisible opacity-0 translate-y-1 group-hover:visible group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:visible group-focus-within:opacity-100 group-focus-within:translate-y-0 transition-all duration-150 absolute left-0 top-full z-50 pt-1">
                    <div className="bg-surface-card rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.18)] border border-border-subtle p-space-md grid grid-cols-2 gap-space-lg min-w-[520px]">
                      {item.groups.map((grp) => (
                        <div key={grp.groupEn}>
                          <div className="font-label-sm text-label-sm text-primary uppercase font-bold tracking-wider mb-space-xs">
                            {lang === "hi" ? grp.groupHi : grp.groupEn}
                          </div>
                          <ul className="space-y-0.5">
                            {grp.items.map((leaf) => (
                              <li key={leaf.en}>
                                <Link href={leaf.href} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg font-body-sm text-body-sm text-on-surface hover:bg-forest-light hover:text-forest-dark transition-colors">
                                  <Icon name="chevron_right" size={15} className="text-primary" />
                                  {(lang as Lang) === "hi" ? leaf.hi : leaf.en}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Desktop actions */}
          <div className="hidden lg:flex items-center gap-space-sm shrink-0">
            <Link
              href="/verify"
              className="bg-solar-gold text-navy-dark font-title-lg text-title-lg px-space-md py-1.5 rounded-lg flex items-center gap-1 hover:bg-solar-gold-dark hover:text-on-primary transition-all shadow-sm whitespace-nowrap"
            >
              <Icon name="stars" size={18} /> {t("cta.checkLabel")}
            </Link>
            <Link
              href={REGISTRATION_HREF}
              className="bg-primary text-on-primary font-title-lg text-title-lg px-space-md py-1.5 rounded-lg hover:bg-primary-container transition-all inline-flex items-center gap-1.5"
              data-testid="public-register"
            >
              <Icon name="app_registration" size={18} /> {t("cta.register")}
            </Link>
            <Link
              href="/login"
              className="bg-surface-container-lowest text-primary font-title-lg text-title-lg px-space-md py-1.5 rounded-lg hover:bg-forest-light transition-all"
            >
              {t("cta.login")}
            </Link>
          </div>

          {/* Mobile quick action */}
          <Link
            href="/verify"
            onClick={closeMobile}
            className="lg:hidden bg-solar-gold text-navy-dark font-title-lg text-title-lg px-space-sm py-1.5 rounded-lg flex items-center gap-1 shadow-sm shrink-0"
          >
            <Icon name="stars" size={18} /> <span className="hidden sm:inline">{t("cta.checkLabel")}</span>
          </Link>
        </div>

        {/* Mobile menu panel */}
        {mobileNav && (
          <div id="mobile-nav" className="lg:hidden absolute left-0 right-0 top-full z-50 bg-forest-dark border-t border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.35)] max-h-[75vh] overflow-y-auto app-scroll">
            <div className="px-gutter py-space-sm">
              {NAV.map((item) => (
                <div key={item.href} className="border-b border-white/5 last:border-0">
                  <Link
                    href={item.href}
                    onClick={closeMobile}
                    aria-current={item.href === active ? "page" : undefined}
                    className={`block py-2.5 font-title-lg text-title-lg ${item.href === active ? "text-solar-gold" : "text-on-primary"}`}
                  >
                    {t(item.key)}
                  </Link>
                  {item.groups && (
                    <div className="pl-space-md pb-space-sm grid grid-cols-1 sm:grid-cols-2 gap-x-space-md">
                      {item.groups.flatMap((g) => g.items).map((leaf) => (
                        <Link
                          key={leaf.en}
                          href={leaf.href}
                          onClick={closeMobile}
                          className="flex items-center gap-1.5 py-1.5 font-body-sm text-body-sm text-forest-light/85 hover:text-on-primary"
                        >
                          <Icon name="chevron_right" size={14} className="text-solar-gold" />
                          {(lang as Lang) === "hi" ? leaf.hi : leaf.en}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-space-sm pt-space-sm">
                <Link href={REGISTRATION_HREF} onClick={closeMobile} className="flex-1 text-center bg-primary-container text-on-primary font-title-lg text-title-lg px-space-md py-2 rounded-lg inline-flex items-center justify-center gap-1.5" data-testid="mobile-public-register">
                  <Icon name="app_registration" size={18} /> {t("cta.register")}
                </Link>
                <Link href="/login" onClick={closeMobile} className="flex-1 text-center bg-surface-container-lowest text-primary font-title-lg text-title-lg px-space-md py-2 rounded-lg">
                  {t("cta.login")}
                </Link>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Announcements ticker */}
      <div className="bg-solar-gold-light text-solar-gold-dark px-gutter py-1.5 flex items-center gap-space-md text-label-md font-label-md">
        <div className="max-w-7xl mx-auto w-full flex items-center gap-space-sm">
          <span className="bg-error text-on-error px-2 py-0.5 rounded font-label-sm uppercase font-bold tracking-wide">{t("ann.live")}</span>
          <span className="font-bold text-navy-dark hidden sm:inline">{t("ann.label")}</span>
          <div className="overflow-hidden flex-1">
            <p className="truncate text-on-surface">{t("ann.body")}</p>
          </div>
          <Link href="/notifications" className="text-primary hover:underline font-bold whitespace-nowrap">{t("ann.viewAll")}</Link>
        </div>
      </div>
    </header>
  );
}
