"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { runtimeNavFor } from "@/lib/runtimeRoutes";
import { useLang } from "@/components/i18n/LangProvider";
import { useSpringIdentity } from "./SessionBadge";

/** Finds the screens the signed-in person's menu offers (the same entries as the sidebar) and opens one. It searches screen names only. */
export function TopbarSearch() {
  const { t, lang } = useLang();
  const router = useRouter();
  const id = useSpringIdentity();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const entries = id.status === "signed-in" ? runtimeNavFor(id.me.effectiveRoles, id.me.capabilities ?? []) : [];
  const term = q.trim().toLowerCase();
  const hits = term ? entries.filter((r) => `${r.en} ${r.hi}`.toLowerCase().includes(term)) : [];
  const go = (href: string) => {
    setQ("");
    setOpen(false);
    router.push(href);
  };
  return (
    <div className="hidden md:block relative flex-1 max-w-md">
      <div className="flex items-center gap-space-sm bg-surface-container-low px-space-md py-space-xs rounded-lg">
        <Icon name="search" className="text-outline" size={20} />
        <input
          className="bg-transparent border-none outline-none font-body-sm text-body-sm text-on-surface w-full placeholder:text-outline"
          placeholder={t("app.search")}
          aria-label={t("app.search")}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0]) go(hits[0].href);
            if (e.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {open && term && (
        <ul role="listbox" aria-label="Matching screens" className="absolute left-0 right-0 top-full mt-1 z-30 bg-surface-container-lowest border border-border-subtle rounded-lg shadow-lg py-1">
          {hits.length ? hits.map((r) => (
            <li key={r.href} role="option" aria-selected={false}>
              <button type="button" className="w-full text-left flex items-center gap-space-sm px-space-md py-1.5 hover:bg-surface-container-low font-body-sm text-body-sm text-on-surface" onMouseDown={(e) => e.preventDefault()} onClick={() => go(r.href)}>
                <Icon name={r.icon} size={18} className="text-on-surface-variant" /> {lang === "hi" ? r.hi : r.en}
              </button>
            </li>
          )) : <li className="px-space-md py-1.5 font-body-sm text-body-sm text-on-surface-variant">No matching screen</li>}
        </ul>
      )}
    </div>
  );
}
