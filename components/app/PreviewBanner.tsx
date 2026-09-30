"use client";

import { Icon } from "@/components/ui/Icon";
import { previewRoleOf, useRole } from "./RoleContext";
import { orgsText, rolesText, useSpringIdentity } from "./SessionBadge";

/**
 * Shown on every /app screen. The console screens are a prototype driven by a
 * local preview role; this banner keeps that role visibly apart from the
 * signed-in identity, which only the BEE service (Spring) reports.
 */
export function PreviewBanner() {
  const { role } = useRole();
  const id = useSpringIdentity();
  return (
    <div role="note" data-testid="preview-banner" className="shrink-0 bg-solar-gold-light border-b border-solar-gold/50 px-space-md py-1.5 flex flex-wrap items-center gap-x-space-md gap-y-1 font-body-sm text-body-sm text-on-surface">
      <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide text-solar-gold-dark">
        <Icon name="science" size={16} /> Development preview
      </span>
      <span>
        Prototype screens with sample data, shown as <span data-preview-role className="font-semibold">{previewRoleOf(role).name}</span>. The preview role is not your identity and grants no access.
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
