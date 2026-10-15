"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { ROLES, RoleKey } from "@/lib/roles";
import { countForRole } from "@/lib/screens";
import { ROLE_PREVIEW_ENABLED, useRole } from "./RoleContext";
import { NotificationBell } from "./notifications/NotificationBell";
import { TopbarSearch } from "./TopbarSearch";
import { SessionBadge } from "./SessionBadge";
import { useDemoMode } from "@/lib/client/useDemoMode";
import { useLang } from "@/components/i18n/LangProvider";

export function AppTopbar({ onMenu }: { onMenu?: () => void }) {
  const { role, setRole } = useRole();
  const { t, lang, toggle } = useLang();
  const demo = useDemoMode() === "on";

  return (
    <header className="h-[60px] shrink-0 bg-surface-container-lowest border-b border-border-subtle flex items-center gap-space-md px-space-md">
      <button onClick={onMenu} className="lg:hidden text-on-surface-variant" type="button" aria-label="Menu">
        <Icon name="menu" size={24} />
      </button>

      <TopbarSearch />

      <div className="flex-1" />

      <div className="flex items-center gap-space-md">
        {/* Role switcher — development preview only; local display state, never a server session */}
        {ROLE_PREVIEW_ENABLED && (
        <div data-preview-role className={demo ? "flex items-center" : "flex items-center gap-space-sm bg-solar-gold-light border border-dashed border-solar-gold px-space-sm py-1.5 rounded-lg"} title={t("app.previewRoleHint")}>
          {!demo && <Icon name="visibility" size={16} className="text-solar-gold-dark" />}
          {!demo && <span className="font-label-sm text-label-sm text-solar-gold-dark uppercase tracking-wide">{t("app.previewRole")}</span>}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as RoleKey)}
            className={demo ? "bg-surface-container-lowest border border-border-subtle rounded-lg px-space-sm py-1.5 outline-none focus:ring-2 focus:ring-primary font-label-md text-label-md text-on-surface cursor-pointer" : "bg-transparent outline-none font-label-md text-label-md text-forest-dark font-semibold cursor-pointer"}
            aria-label={t("app.previewRole")}
          >
            <optgroup label={t("role.internal")}>
              {ROLES.filter((r) => r.kind === "internal").map((r) => (
                <option key={r.key} value={r.key}>{t(`role.${r.key}`)} ({countForRole(r.key)})</option>
              ))}
            </optgroup>
            <optgroup label={t("role.external")}>
              {ROLES.filter((r) => r.kind === "external").map((r) => (
                <option key={r.key} value={r.key}>{t(`role.${r.key}`)} · scoped</option>
              ))}
            </optgroup>
          </select>
        </div>
        )}

        <NotificationBell />

        {/* Language toggle */}
        <button
          onClick={toggle}
          className={`bg-primary-container text-on-primary font-bold px-2.5 py-1.5 rounded-lg text-label-sm hover:bg-forest-dark transition-colors`}
          type="button"
          aria-label="Toggle language"
        >
          {lang === "en" ? "हिन्दी" : "English"}
        </button>

        {/* The only identity shown here is the signed-in one, as Spring reports it. */}
        <SessionBadge
          signedOut={
            <Link href="/login" className="flex items-center gap-1 font-label-md text-label-md text-primary hover:text-forest-dark">
              <Icon name="login" size={20} /> Sign in
            </Link>
          }
        />
      </div>
    </header>
  );
}
