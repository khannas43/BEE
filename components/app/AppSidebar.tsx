"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import { useSpringIdentity } from "./SessionBadge";
import { activeEntry, navigationFor, navProfileFor, type NavEntry, type NavGroup } from "@/lib/navigation";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { useLang } from "@/components/i18n/LangProvider";

const PROFILE_TITLE = { admin: "Admin", manufacturer: "Manufacturer", officer: "Officer", director: "Director", finance: "Finance" } as const;

/** The console menu: the signed-in person's role hierarchy from lib/navigation, used by the desktop sidebar and the mobile drawer alike. */
export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLang();
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const identity = useSpringIdentity();
  const signedIn = identity.status === "signed-in";
  const roles = signedIn ? identity.me.effectiveRoles : null;
  const groups = navigationFor(roles, signedIn ? identity.me.capabilities ?? [] : []);
  const profile = navProfileFor((roles ?? []).map((g) => g.role));
  const active = activeEntry(groups, pathname, search);

  return (
    <nav className="flex flex-col h-full bg-forest-dark text-forest-light" aria-label="Console menu">
      <Link href="/app" className="flex flex-row items-center justify-start gap-space-sm px-space-md h-[60px] shrink-0 border-b border-white/10" onClick={onNavigate} aria-label={t("app.portal")}>
        <span className="flex items-center justify-center bg-white rounded-md px-3 h-[36px] shrink-0">
          <Image src="/images/bee-logo.png" alt="Bureau of Energy Efficiency" width={1260} height={308} priority className="h-[28px] w-auto object-contain" />
        </span>
        <span className="font-label-sm text-label-sm uppercase tracking-[0.14em] text-forest-light/90 leading-[14px] text-left">{t("app.portal")}</span>
      </Link>

      <div className="flex-1 overflow-y-auto app-scroll py-space-sm">
        {identity.status === "loading" ? (
          <div className="px-space-md space-y-2" aria-busy="true" data-testid="nav-loading">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-8 rounded bg-white/5" />)}
          </div>
        ) : groups.length === 0 ? (
          <div className="px-space-md py-space-sm font-body-sm text-body-sm text-forest-light/80" data-testid="nav-signed-out">
            {signedIn ? "Your sign-in has no console menu." : "Sign in to see your menu."}
            {!signedIn && (
              <a href={`/api/auth/login?returnTo=${encodeURIComponent(pathname)}`} className="mt-space-xs flex items-center gap-1.5 font-label-md text-label-md text-on-primary hover:underline">
                <Icon name="login" size={16} /> Sign in
              </a>
            )}
          </div>
        ) : (
          <>
            {profile && (
              <p className="px-space-md pb-1 font-label-sm text-label-sm uppercase tracking-[0.12em] text-forest-light/60" data-testid="nav-profile">
                {PROFILE_TITLE[profile]}
              </p>
            )}
            <MenuGroups key={active?.group.id ?? "none"} groups={groups} activeGroup={active?.group.id ?? null} activeId={active?.entry.id ?? null} onNavigate={onNavigate} />
          </>
        )}
      </div>

      <Link href="/" className="flex items-center gap-space-sm px-space-md py-space-sm border-t border-white/10 text-forest-light/80 hover:text-on-primary font-label-md text-label-md shrink-0" onClick={onNavigate}>
        <Icon name="public" size={18} /> {t("app.publicPortal")}
      </Link>
    </nav>
  );
}

/** Accordion: the group holding the current page stays open, and one other group can be opened beside it. Remounted when the page moves to another group. */
function MenuGroups({ groups, activeGroup, activeId, onNavigate }: { groups: readonly NavGroup[]; activeGroup: string | null; activeId: string | null; onNavigate?: () => void }) {
  const [opened, setOpened] = useState<string | null>(activeGroup ? null : groups[0]?.id ?? null);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const buttons = [...(e.currentTarget.closest("[data-testid=runtime-nav]")?.querySelectorAll<HTMLButtonElement>("[data-nav-group-button]") ?? [])];
    const i = buttons.indexOf(e.currentTarget);
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    e.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <div data-testid="runtime-nav">
      {groups.map((g) => {
        const isActive = g.id === activeGroup;
        const isOpen = isActive || g.id === opened;
        const panelId = `nav-panel-${g.id}`;
        return (
          <div key={g.id}>
            <button
              type="button"
              data-nav-group-button
              data-nav-id={g.id}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => { if (!isActive) setOpened(g.id === opened ? null : g.id); }}
              onKeyDown={onKeyDown}
              className={`w-full flex items-center gap-space-sm px-space-md py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-gold ${
                isActive ? "text-on-primary" : "text-forest-light hover:text-on-primary"
              }`}
            >
              <Icon name={g.icon} size={20} fill={isActive} />
              <span className="flex-1 font-label-lg text-label-lg">{g.title}</span>
              <Icon name={isOpen ? "expand_less" : "expand_more"} size={18} />
            </button>
            <div id={panelId} role="group" aria-label={g.title} className="pb-space-xs" hidden={!isOpen}>
              {g.children.map((e) => <MenuEntry key={e.id} entry={e} depth={0} activeId={activeId} onNavigate={onNavigate} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function contains(e: NavEntry, id: string | null): boolean {
  return !!id && (e.id === id || (e.children ?? []).some((c) => contains(c, id)));
}

function MenuEntry({ entry, depth, activeId, onNavigate }: { entry: NavEntry; depth: number; activeId: string | null; onNavigate?: () => void }) {
  const holdsActive = contains(entry, activeId);
  const [open, setOpen] = useState(holdsActive);
  const pad = depth === 0 ? "pl-[30px]" : "pl-[50px]";

  if (entry.children) {
    const panelId = `nav-panel-${entry.id}`;
    const isOpen = open || holdsActive;
    return (
      <div>
        <button
          type="button"
          data-nav-id={entry.id}
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
          className={`w-full flex items-center gap-space-sm ${pad} pr-space-md py-1.5 text-left font-body-sm text-body-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-gold ${
            holdsActive ? "text-on-primary" : "text-forest-light/80 hover:text-on-primary hover:bg-white/5"
          }`}
        >
          <Icon name={entry.icon} size={16} className={holdsActive ? "text-solar-gold" : "text-forest-light/40"} />
          <span className="flex-1">{entry.title}</span>
          <Icon name={isOpen ? "expand_less" : "expand_more"} size={16} />
        </button>
        <div id={panelId} role="group" aria-label={entry.title} hidden={!isOpen}>
          {entry.children.map((c) => <MenuEntry key={c.id} entry={c} depth={depth + 1} activeId={activeId} onNavigate={onNavigate} />)}
        </div>
      </div>
    );
  }

  const chips = (
    <>
                  {entry.state === "planned" && <Chip text="Planned" />}
    </>
  );

  if (entry.state === "planned" || !entry.route) {
    return (
      <span
        data-nav-id={entry.id}
        data-nav-state="planned"
        aria-disabled="true"
        className={`flex items-center gap-space-sm ${pad} pr-space-md py-1.5 font-body-sm text-body-sm text-forest-light/45 cursor-default`}
      >
        <Icon name={entry.icon} size={16} className="text-forest-light/25" />
        <span className="flex-1">{entry.title}</span>
        {chips}
      </span>
    );
  }

  const active = entry.id === activeId;
  const runtime = entry.state === "available" && runtimeRouteFor(entry.route)?.href === entry.route;
  return (
    <Link
      href={entry.query ? `${entry.route}?${entry.query}` : entry.route}
      onClick={onNavigate}
      data-nav-id={entry.id}
      data-nav-state={entry.state}
      data-testid={runtime ? `runtime-nav-${entry.route.split("/").pop()}${entry.query ? `-${entry.query.split("=")[1]}` : ""}` : undefined}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-space-sm ${pad} pr-space-md py-1.5 font-body-sm text-body-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-gold ${
        active ? "bg-primary-container text-on-primary font-semibold" : "text-forest-light/80 hover:text-on-primary hover:bg-white/5"
      }`}
    >
      <Icon name={entry.icon} size={16} className={active ? "text-solar-gold" : "text-forest-light/40"} fill={active} />
      <span className="flex-1">{entry.title}</span>
      {chips}
    </Link>
  );
}

function Chip({ text }: { text: string }) {
  return <span className="shrink-0 rounded-full border border-white/20 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-forest-light/70">{text}</span>;
}
