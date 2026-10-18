"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  createManufacturerOnboardingClient,
  type ManufacturerOnboardingClient,
  type ManufacturerOnboardingClientOptions,
} from "@/lib/manufacturer-onboarding/client";
import type { ManufacturerOnboardingRole } from "@/lib/manufacturer-onboarding/types";
import type { SpringIdentityLike } from "@/lib/manufacturer-onboarding/identity";
import { effectiveOnboardingRoles } from "@/lib/manufacturer-onboarding/identity";

const ClientContext = createContext<ManufacturerOnboardingClient | null>(null);
const ClockContext = createContext<number | null>(null);
const RolesContext = createContext<readonly ManufacturerOnboardingRole[]>([]);

export function ManufacturerOnboardingProvider({
  children,
  client,
  clientOptions,
  nowMs,
  identity,
}: {
  children: ReactNode;
  client?: ManufacturerOnboardingClient;
  clientOptions?: ManufacturerOnboardingClientOptions;
  nowMs?: number;
  identity?: SpringIdentityLike | null;
}) {
  const fixture = useMemo(
    () =>
      identity
        ? {
            actor: () => ({
              username: "onboarding.applicant",
              effectiveRoles: identity.effectiveRoles,
            }),
          }
        : undefined,
    [identity],
  );
  const c = useMemo(
    () => client ?? createManufacturerOnboardingClient({ ...clientOptions, fixture: clientOptions?.fixture ?? fixture }),
    [client, clientOptions, fixture],
  );
  const roles = useMemo(() => (identity ? effectiveOnboardingRoles(identity) : []), [identity]);
  return (
    <ClientContext.Provider value={c}>
      <RolesContext.Provider value={roles}>
        <ClockContext.Provider value={nowMs ?? null}>{children}</ClockContext.Provider>
      </RolesContext.Provider>
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

export function useManufacturerOnboardingRoles(): readonly ManufacturerOnboardingRole[] {
  return useContext(RolesContext);
}
