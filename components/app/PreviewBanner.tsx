"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { previewRoleOf, useRole } from "./RoleContext";
import { orgsText, rolesText, useSpringIdentity } from "./SessionBadge";

/**
 * Shown on every /app screen. The console screens are a prototype driven by a
 * local preview role; this banner keeps that role visibly apart from the
 * signed-in identity, which only the BEE service (Spring) reports.
 */
export function PreviewBanner() {
  // Demo sign-in mode (BEE_DEMO_LOGIN=1) hides the bar for the client demo; the "Preview as" selector stays in the top bar. Unknown or failed lookups keep the bar.
  const [demo, setDemo] = useState<"unknown" | "on" | "off">("unknown");
  useEffect(() => {
    let live = true;
    fetch("/api/runtime/demo/login", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => live && setDemo(b && b.enabled === true ? "on" : "off"))
      .catch(() => live && setDemo("off"));
    return () => { live = false; };
  }, []);
  const { role } = useRole();
  const id = useSpringIdentity();
  const runtime = !!runtimeRouteFor(usePathname());
  if (demo === "on") return null;
  return (
    <div role="note" data-testid="preview-banner" className={`${demo === "unknown" ? "invisible " : ""}shrink-0 bg-solar-gold-light border-b border-solar-gold/50 px-space-md py-1.5 flex flex-wrap items-center gap-x-space-md gap-y-1 font-body-sm text-body-sm text-on-surface`}>
      <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide text-solar-gold-dark">
        <Icon name="science" size={16} /> Development preview
      </span>
      <span>
        {runtime ? "This screen shows records from the BEE service, scoped to your sign-in. Other screens are prototypes with sample data, shown as" : "Prototype screens with sample data, shown as"} <span data-preview-role className="font-semibold">{previewRoleOf(role).name}</span>. The preview role is not your identity and grants no access.
      </span>
      <span data-testid="signed-in-identity" className="ml-auto">
        {id.status === "signed-in" ? (
          <>
            Your sign-in: <span className="font-semibold">{id.me.displayName}</span> · {rolesText(id.me)}
            {orgsText(id.me) ? ` · ${orgsText(id.me)}` : ""} (from BEE records)
          </>
        ) : id.status === "signed-out" ? (
          "Not signed in."
        ) : null}
      </span>
    </div>
  );
}
