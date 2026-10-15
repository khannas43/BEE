"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { categoriesForRole, categoryForPath } from "@/lib/categories";
import { useRole } from "./RoleContext";
import { useSpringIdentity } from "./SessionBadge";
import { runtimeNavFor } from "@/lib/runtimeRoutes";
import { useLang } from "@/components/i18n/LangProvider";

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { role } = useRole();
  const { t, lang } = useLang();
  const pathname = usePathname();
  const categories = categoriesForRole(role);
  const identity = useSpringIdentity();
  const runtimeNav = runtimeNavFor(identity.status === "signed-in" ? identity.me.effectiveRoles : null, identity.status === "signed-in" ? identity.me.capabilities ?? [] : []);

  // Which category the current route belongs to (for auto-open + highlight)
  const activeCat = categoryForPath(pathname)?.id ?? categories[0]?.id ?? null;
  // The category the current route belongs to opens by itself; a manual toggle is kept until the route moves to another category.
  const [toggle, setToggle] = useState<{ cat: string | null; open: string | null } | null>(null);
  const [recordsOpen, setRecordsOpen] = useState(true);
  const open = toggle?.cat === activeCat ? toggle.open : activeCat;
  const setOpen = (next: string | null) => setToggle({ cat: activeCat, open: next });

  return (
    <nav className="flex flex-col h-full bg-forest-dark text-forest-light">
      <Link href="/app" className="flex flex-col items-center justify-center gap-0.5 px-space-md h-[60px] shrink-0 border-b border-white/10" onClick={onNavigate} aria-label={`BEE S&L ${t("app.officerConsole")}`}>
        <span className="flex items-center justify-center bg-white rounded-md px-3 h-[36px]">
          <Image src="/images/bee-logo.png" alt="Bureau of Energy Efficiency" width={1260} height={308} priority className="h-[28px] w-auto object-contain" />
        </span>
        <span className="font-label-sm text-label-sm uppercase tracking-[0.18em] text-forest-light/80 leading-[12px]">{t("app.officerConsole")}</span>
      </Link>

      <div className="flex-1 overflow-y-auto app-scroll py-space-sm">
        {runtimeNav.length > 0 && (
          <div className="pb-space-sm mb-space-sm border-b border-white/10" data-testid="runtime-nav">
            <button
              type="button"
              onClick={() => setRecordsOpen((v) => !v)}
              aria-expanded={recordsOpen}
              className="w-full flex items-center gap-space-sm px-space-md py-2 text-left text-forest-light hover:text-on-primary transition-colors"
            >
              <Icon name="folder_open" size={20} />
              <span className="flex-1 font-label-lg text-label-lg">Your BEE records</span>
              <Icon name={recordsOpen ? "expand_less" : "expand_more"} size={18} />
            </button>
            {recordsOpen && runtimeNav.map((r) => (
              <SidebarLink key={r.href} href={r.href} icon={r.icon} label={lang === "hi" ? r.hi : r.en} active={pathname === r.href} onNavigate={onNavigate} testId={`runtime-nav-${r.href.split("/").pop()}`} compact />
            ))}
          </div>
        )}
        <div>
          {categories.map((c) => {
            const isOpen = open === c.id;
            const inCat = activeCat === c.id;
            return (
              <div key={c.id}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : c.id)}
                  className={`w-full flex items-center gap-space-sm px-space-md py-2 text-left transition-colors ${
                    inCat ? "text-on-primary" : "text-forest-light hover:text-on-primary"
                  }`}
                >
                  <Icon name={c.icon} size={20} fill={inCat} />
                  <span className="flex-1 font-label-lg text-label-lg">{lang === "hi" ? c.hi : c.en}</span>
                  <Icon name={isOpen ? "expand_less" : "expand_more"} size={18} />
                </button>
                {isOpen && (
                  <div className="pb-space-xs">
                    {c.items.map((it) => {
                      const active = pathname === it.href;
                      return (
                        <Link
                          key={it.href + it.en}
                          href={it.href}
                          onClick={onNavigate}
                          className={`flex items-center gap-space-sm pl-[30px] pr-space-md py-1.5 font-body-sm text-body-sm transition-colors ${
                            active
                              ? "bg-primary-container text-on-primary font-semibold"
                              : "text-forest-light/80 hover:text-on-primary hover:bg-white/5"
                          }`}
                        >
                          <Icon name={it.icon} size={16} className={active ? "text-solar-gold" : "text-forest-light/40"} fill={active} />
                          <span className="flex-1">{lang === "hi" ? it.hi : it.en}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {process.env.NODE_ENV !== "production" && (
          <div className="mt-space-sm pt-space-sm border-t border-white/10">
            <SidebarLink href="/app/screens" icon="apps" label={`${t("app.allScreens")} · dev`} active={pathname === "/app/screens"} onNavigate={onNavigate} />
          </div>
        )}
      </div>

      <Link href="/" className="flex items-center gap-space-sm px-space-md py-space-sm border-t border-white/10 text-forest-light/80 hover:text-on-primary font-label-md text-label-md shrink-0" onClick={onNavigate}>
        <Icon name="public" size={18} /> {t("app.publicPortal")}
      </Link>
    </nav>
  );
}

function SidebarLink({
  href, icon, label, active, onNavigate, testId, compact,
}: {
  href: string; icon: string; label: string; active: boolean; onNavigate?: () => void; testId?: string; compact?: boolean;
}) {
  if (compact) {
    return (
      <Link
        href={href}
        onClick={onNavigate}
        data-testid={testId}
        className={`flex items-center gap-space-sm pl-[30px] pr-space-md py-1.5 font-body-sm text-body-sm transition-colors ${
          active ? "bg-primary-container text-on-primary font-semibold" : "text-forest-light/80 hover:text-on-primary hover:bg-white/5"
        }`}
      >
        <Icon name={icon} size={16} className={active ? "text-solar-gold" : "text-forest-light/40"} fill={active} />
        <span className="flex-1">{label}</span>
      </Link>
    );
  }
  return (
    <Link
      href={href}
      onClick={onNavigate}
      data-testid={testId}
      className={`flex items-center gap-space-sm px-space-md py-2 font-label-lg text-label-lg transition-colors ${
        active ? "bg-primary-container text-on-primary" : "text-forest-light hover:text-on-primary hover:bg-white/5"
      }`}
    >
      <Icon name={icon} size={20} fill={active} /> {label}
    </Link>
  );
}
