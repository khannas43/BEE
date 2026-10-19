"use client";

import { Icon } from "@/components/ui/Icon";

/** Shown on operational screens when the signed-in identity is the read-only Admin demonstration profile. */
export function AdminDemonstrationBanner() {
  return (
    <div
      role="note"
      data-testid="admin-demonstration-banner"
      className="mx-space-md lg:mx-space-lg mt-space-md flex items-start gap-space-sm rounded-lg border border-solar-gold/50 bg-solar-gold-light/40 px-space-sm py-2 font-body-sm text-body-sm text-on-surface"
    >
      <Icon name="visibility" size={18} className="text-solar-gold-dark shrink-0 mt-0.5" />
      <p>
        Admin demonstration view — read-only. Actions remain available only to the responsible operational role.
      </p>
    </div>
  );
}
