"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Emblem } from "@/components/chrome/Emblem";
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
  const open = toggle?.cat === activeCat ? toggle.open : activeCat;
  const setOpen = (next: string | null) => setToggle({ cat: activeCat, open: next });

  return (
    <nav className="flex flex-col h-full bg-forest-dark text-forest-light">
      <Link href="/app" className="flex items-center gap-space-sm px-space-md h-[60px] shrink-0 border-b border-white/10" onClick={onNavigate}>
        <Emblem size={34} invert />
        <div className="leading-tight">
          <div className="font-title-lg text-title-lg text-on-primary">BEE S&L</div>
          <div className="font-label-sm text-label-sm text-forest-light/70">{t("app.officerConsole")}</div>
        </div>
      </Link>

      <div className="flex-1 overflow-y-auto app-scroll py-space-sm">
        {runtimeNav.length > 0 && (
          <div className="pb-space-sm mb-space-sm border-b border-white/10" data-testid="runtime-nav">
            <div className="px-space-md py-1 font-label-sm text-label-sm uppercase tracking-wide text-forest-light/60">Your BEE records</div>
            {runtimeNav.map((r) => (
              <SidebarLink key={r.href} href={r.href} icon={r.icon} label={lang === "hi" ? r.hi : r.en} active={pathname === r.href} onNavigate={onNavigate} testId={`runtime-nav-${r.href.split("/").pop()}`} />
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
  href, icon, label, active, onNavigate, testId,
}: {
  href: string; icon: string; label: string; active: boolean; onNavigate?: () => void; testId?: string;
}) {
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
