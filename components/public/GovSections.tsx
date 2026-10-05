"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/components/public/usePrefersReducedMotion";
import Link from "next/link";
import Image from "next/image";
import { Icon } from "@/components/ui/Icon";
import { useLang } from "@/components/i18n/LangProvider";
import { SectionHeader } from "./SectionHeader";

/* Animated count-up that runs once when scrolled into view. */
function CountUp({ to, decimals = 0, prefix = "", suffix = "" }: { to: number; decimals?: number; prefix?: string; suffix?: string }) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(false);
  const displayVal = prefersReducedMotion ? to : val;

  useEffect(() => {
    if (prefersReducedMotion) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !done.current) {
        done.current = true;
        const start = performance.now();
        const dur = 1400;
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          setVal(to * eased);
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.4 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [to, prefersReducedMotion]);

  return (
    <span ref={ref}>
      {prefix}
      {displayVal.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

export function ProgrammeTiles() {
  const { t } = useLang();
  const tiles = [
    { k: "prog.sl", icon: "sell", href: "/programmes" },
    { k: "prog.pat", icon: "factory", href: "/programmes" },
    { k: "prog.ecbc", icon: "apartment", href: "/programmes" },
    { k: "prog.ujala", icon: "lightbulb", href: "/programmes" },
    { k: "prog.carbon", icon: "co2", href: "/programmes" },
    { k: "prog.neca", icon: "workspace_premium", href: "/programmes" },
  ];
  return (
    <section className="w-full bg-surface-container-lowest py-space-xl">
      <div className="max-w-7xl mx-auto px-gutter">
        <SectionHeader title={t("prog.title")} viewAllHref="/programmes" viewAllLabel={t("ann.viewAll")} />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-space-md">
          {tiles.map((tile) => (
            <Link key={tile.k} href={tile.href} className="group flex flex-col items-start gap-space-sm p-space-md rounded-lg bg-surface-card border border-border-subtle/60 shadow-card hover:shadow-elevated hover:-translate-y-0.5 transition-all duration-200">
              <span className="w-11 h-11 rounded-lg bg-forest-light text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-on-primary transition-colors">
                <Icon name={tile.icon} size={24} fill />
              </span>
              <span className="font-title-lg text-title-lg leading-tight text-on-surface">{t(tile.k)}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export function StatsDashboard() {
  const { t } = useLang();
  const stats = [
    { icon: "inventory_2", to: 14280, suffix: "+", label: "stats.models", tone: "text-primary" },
    { icon: "savings", to: 11450, prefix: "₹", suffix: " Cr", label: "stats.savings", tone: "text-solar-gold-dark" },
    { icon: "co2", to: 54.2, decimals: 1, suffix: " Mt", label: "stats.emissions", tone: "text-tertiary" },
    { icon: "science", to: 142, label: "stats.labs", tone: "text-secondary" },
  ];
  return (
    <section className="w-full py-space-xl bg-gradient-to-br from-forest-dark via-primary to-primary-container relative overflow-hidden">
      <div className="absolute -right-20 -top-24 w-96 h-96 rounded-full bg-white/5" aria-hidden />
      <div className="absolute -left-16 -bottom-24 w-80 h-80 rounded-full bg-white/5" aria-hidden />
      <div className="max-w-7xl mx-auto px-gutter relative">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md">
          {stats.map((s) => (
            <div key={s.label} className="bg-surface-card/95 backdrop-blur rounded-xl shadow-elevated p-space-md flex items-center gap-space-md">
              <span className="w-12 h-12 rounded-lg bg-forest-light text-primary flex items-center justify-center shrink-0">
                <Icon name={s.icon} size={26} fill />
              </span>
              <div className="min-w-0">
                <div className="font-headline-lg text-headline-lg font-bold text-primary leading-none">
                  <CountUp to={s.to} decimals={s.decimals} prefix={s.prefix} suffix={s.suffix} />
                </div>
                <div className="font-label-md text-label-md text-on-surface-variant mt-1 truncate">{t(s.label)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function MissionBlock() {
  const { t } = useLang();
  return (
    <section className="w-full bg-surface-ground py-space-2xl">
      <div className="max-w-4xl mx-auto px-gutter text-center">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-forest-light text-forest-dark font-label-sm text-label-sm uppercase tracking-wider">
          <Icon name="flag" size={15} fill /> {t("mission.tag")}
        </span>
        <blockquote className="font-headline-lg text-headline-lg sm:text-headline-xl text-on-surface mt-space-md leading-snug">
          <Icon name="format_quote" size={40} className="text-primary/30" /> {t("mission.quote")}
        </blockquote>
        <div className="mt-space-md font-body-md text-body-md text-on-surface-variant">— {t("mission.by")}</div>
      </div>
    </section>
  );
}

export function PortalsRow() {
  const { t } = useLang();
  const portals = ["Beestarlabel", "SAATHEE", "Indian Carbon Market", "ADEETIE", "RCO", "NECA", "Escerts", "PAT"];
  return (
    <section className="w-full bg-surface-container-lowest py-space-xl">
      <div className="max-w-7xl mx-auto px-gutter">
        <SectionHeader title={t("portals.title")} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-space-sm">
          {portals.map((p) => (
            <Link key={p} href="/directory" className="flex items-center justify-between gap-2 p-space-md rounded-lg bg-surface-card border border-border-subtle/60 shadow-card hover:shadow-elevated hover:-translate-y-0.5 transition-all duration-200">
              <span className="font-title-lg text-title-lg text-on-surface">{p}</span>
              <Icon name="open_in_new" size={16} className="text-primary" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* Photo gallery — real event/campaign photos plus a scheme tile. */
export function PhotoGallery() {
  const { t } = useLang();
  const tiles: { titleKey: string; src?: string; alt?: string; icon?: string; from?: string; to?: string }[] = [
    { titleKey: "gallery.foundation", src: "/images/foundation-day.jpg", alt: "25th Foundation Day of the Bureau of Energy Efficiency" },
    { titleKey: "gallery.tiranga", src: "/images/har-ghar-tiranga.jpg", alt: "Har Ghar Tiranga national campaign" },
    { titleKey: "gallery.mann", src: "/images/mann-ki-baat.jpg", alt: "Mann Ki Baat outreach" },
    { titleKey: "gallery.neca", icon: "emoji_events", from: "#14315E", to: "#2952A3" },
  ];
  return (
    <section className="w-full bg-surface py-space-xl">
      <div className="max-w-7xl mx-auto px-gutter">
        <SectionHeader title={t("gallery.title")} viewAllHref="/notifications" viewAllLabel={t("ann.viewAll")} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md">
          {tiles.map((tile) => (
            <div key={tile.titleKey} className="rounded-xl border border-border-subtle/60 shadow-card hover:shadow-elevated overflow-hidden group cursor-pointer transition-shadow">
              <div className="h-40 relative flex items-end p-space-sm overflow-hidden" style={tile.src ? undefined : { background: `linear-gradient(135deg, ${tile.from}, ${tile.to})` }}>
                {tile.src ? (
                  <Image src={tile.src} alt={tile.alt ?? ""} fill sizes="(max-width:1024px) 50vw, 25vw" className="object-cover object-center transition-transform duration-500 group-hover:scale-105" />
                ) : (
                  <Icon name={tile.icon!} size={120} fill className="absolute right-2 top-2 text-white/10" />
                )}
                <Icon name="zoom_in" size={22} className="absolute right-2 bottom-2 text-white/80 z-10 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="bg-surface-card p-space-sm">
                <div className="font-title-lg text-title-lg text-on-surface leading-tight">{t(tile.titleKey)}</div>
                <div className="font-label-sm text-label-sm text-on-surface-variant">BEE • 2026</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
