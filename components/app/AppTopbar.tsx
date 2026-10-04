"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { ROLES, RoleKey } from "@/lib/roles";
import { countForRole } from "@/lib/screens";
import { ROLE_PREVIEW_ENABLED, useRole } from "./RoleContext";
import { SessionBadge } from "./SessionBadge";
import { useLang } from "@/components/i18n/LangProvider";

export function AppTopbar({ onMenu }: { onMenu?: () => void }) {
  const { role, setRole } = useRole();
  const { t, lang, toggle } = useLang();

  return (
    <header className="h-[60px] shrink-0 bg-surface-container-lowest border-b border-border-subtle flex items-center gap-space-md px-space-md">
      <button onClick={onMenu} className="lg:hidden text-on-surface-variant" type="button" aria-label="Menu">
        <Icon name="menu" size={24} />
      </button>

      <div className="hidden md:flex items-center gap-space-sm bg-surface-container-low px-space-md py-space-xs rounded-lg flex-1 max-w-md">
        <Icon name="search" className="text-outline" size={20} />
        <input
          className="bg-transparent border-none outline-none font-body-sm text-body-sm text-on-surface w-full placeholder:text-outline"
          placeholder={t("app.search")}
          aria-label={t("app.search")}
        />
      </div>

      <div className="flex-1 md:hidden" />

      <div className="flex items-center gap-space-md">
        {/* Language toggle */}
        <button
          onClick={toggle}
          className="bg-primary-container text-on-primary font-bold px-2.5 py-1.5 rounded-lg text-label-sm hover:bg-forest-dark transition-colors"
          type="button"
          aria-label="Toggle language"
        >
          {lang === "en" ? "हिन्दी" : "English"}
        </button>

        {/* Role switcher — development preview only; local display state, never a server session */}
        {ROLE_PREVIEW_ENABLED && (
        <div data-preview-role className="flex items-center gap-space-sm bg-solar-gold-light border border-dashed border-solar-gold px-space-sm py-1.5 rounded-lg" title={t("app.previewRoleHint")}>
          <Icon name="visibility" size={16} className="text-solar-gold-dark" />
          <span className="font-label-sm text-label-sm text-solar-gold-dark uppercase tracking-wide">{t("app.previewRole")}</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as RoleKey)}
            className="bg-transparent outline-none font-label-md text-label-md text-forest-dark font-semibold cursor-pointer"
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

        <button className="relative text-on-surface-variant hover:text-on-surface" type="button" aria-label="Notifications">
          <Icon name="notifications" size={22} />
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-error text-on-error rounded-full text-[10px] font-bold flex items-center justify-center">7</span>
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
