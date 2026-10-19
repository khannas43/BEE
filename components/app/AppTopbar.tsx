"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { RoleKey, VISIBLE_SELECTOR_ROLES, VISIBLE_SELECTOR_ROLE_KEYS } from "@/lib/roles";
import { countForRole } from "@/lib/screens";
import { ROLE_PREVIEW_ENABLED, useRole } from "./RoleContext";
import { NotificationBell } from "./notifications/NotificationBell";
import { DemoMessageBadge } from "./notifications/DemoMessageBadge";
import { TopbarSearch } from "./TopbarSearch";
import { SessionBadge, useSpringIdentity } from "./SessionBadge";
import { LANGUAGE_SWITCH_ENABLED, useLang } from "@/components/i18n/LangProvider";

export function AppTopbar({ onMenu }: { onMenu?: () => void }) {
  const { role, setRole } = useRole();
  const { t, lang, toggle } = useLang();
  const identity = useSpringIdentity();
  const signedIn = identity.status === "signed-in";
  const previewRole = VISIBLE_SELECTOR_ROLE_KEYS.includes(role) ? role : "admin";

  const changeRole = (key: RoleKey) => {
    if (!VISIBLE_SELECTOR_ROLE_KEYS.includes(key)) return;
    setRole(key);
  };

  return (
    <header className="h-[60px] shrink-0 bg-surface-container-lowest border-b border-border-subtle flex items-center gap-space-md px-space-md">
      <button onClick={onMenu} className="lg:hidden text-on-surface-variant" type="button" aria-label="Menu">
        <Icon name="menu" size={24} />
      </button>

      <TopbarSearch />

      <div className="flex-1" />

      <div className="flex items-center gap-space-md">
        {/* Prototype preview only while signed out — never changes the server session (Brief C3B). */}
        {ROLE_PREVIEW_ENABLED && !signedIn && (
        <div data-preview-role className="flex items-center gap-space-sm bg-solar-gold-light border border-dashed border-solar-gold px-space-sm py-1.5 rounded-lg" title={t("app.previewRoleHint")}>
          <Icon name="visibility" size={16} className="text-solar-gold-dark" />
          <span className="font-label-sm text-label-sm text-solar-gold-dark uppercase tracking-wide">{t("app.previewRole")}</span>
          <select
            value={previewRole}
            onChange={(e) => changeRole(e.target.value as RoleKey)}
            className="bg-transparent outline-none font-label-md text-label-md text-forest-dark font-semibold cursor-pointer"
            aria-label={t("app.previewRole")}
            data-testid="visible-role-selector"
          >
            {VISIBLE_SELECTOR_ROLES.map((r) => (
              <option key={r.key} value={r.key}>
                {`${r.label} (${countForRole(r.key)})`}
              </option>
            ))}
          </select>
        </div>
        )}

        <NotificationBell />
        <DemoMessageBadge />

        {LANGUAGE_SWITCH_ENABLED ? (
          <button
            onClick={toggle}
            className={`bg-primary-container text-on-primary font-bold px-2.5 py-1.5 rounded-lg text-label-sm hover:bg-forest-dark transition-colors`}
            type="button"
            aria-label="Toggle language"
          >
            {lang === "en" ? "हिन्दी" : "English"}
          </button>
        ) : null}

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
