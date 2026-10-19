"use client";

import { useSpringIdentity } from "@/components/app/SessionBadge";
import type { SpringIdentity } from "@/components/app/SessionBadge";

/** True when Spring reports the read-only Admin demonstration profile (Brief C3A). */
export function adminDemonstrationReadOnly(me: SpringIdentity | null | undefined): boolean {
  return me?.adminDemonstrationReadOnly === true;
}

/** Hook for runtime screens that expose actions outside ScreenChrome. */
export function useAdminDemonstrationReadOnly(): boolean {
  const identity = useSpringIdentity();
  return identity.status === "signed-in" && adminDemonstrationReadOnly(identity.me);
}
