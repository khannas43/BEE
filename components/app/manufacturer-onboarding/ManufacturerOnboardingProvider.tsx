"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createManufacturerOnboardingClient, type ManufacturerOnboardingClient } from "@/lib/manufacturer-onboarding/client";
import { useRole } from "@/components/app/RoleContext";
import { onboardingRoleFromPreview } from "@/lib/manufacturer-onboarding/access";

const ClientContext = createContext<ManufacturerOnboardingClient | null>(null);
/** When set (tests), observation UI uses this instant instead of the live clock. */
const ClockContext = createContext<number | null>(null);

export function ManufacturerOnboardingProvider({
  children,
  client,
  nowMs,
}: {
  children: ReactNode;
  client?: ManufacturerOnboardingClient;
  nowMs?: number;
}) {
  const c = useMemo(() => client ?? createManufacturerOnboardingClient(), [client]);
  const clock = nowMs ?? null;
  return (
    <ClientContext.Provider value={c}>
      <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>
    </ClientContext.Provider>
  );
}

export function useManufacturerOnboardingClient(): ManufacturerOnboardingClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error("ManufacturerOnboardingProvider missing");
  return c;
}

export function useManufacturerOnboardingClock(): number | null {
  return useContext(ClockContext);
}

export function useManufacturerOnboardingPreviewRole() {
  const { role } = useRole();
  return onboardingRoleFromPreview(role);
}
