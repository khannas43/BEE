/**
 * Browser client for the Manufacturer 360 read (demonstration API `/api/demo/manufacturers`): one list of manufacturers, read from the
 * database, shared by the Manufacturer 360 screen and the register so both show the same manufacturers, statuses and reasons.
 */
import { useEffect, useState } from "react";
import { runtimeRead } from "@/lib/client/runtimeHttp";

export type ComplianceStatus = "Compliant" | "Under observation" | "On hold" | "Registration pending" | "Suspended" | "Revoked";
export const STATUS_FILTERS: readonly ComplianceStatus[] = ["Compliant", "Under observation", "On hold", "Registration pending", "Suspended", "Revoked"];

export interface ManufacturerBrand {
  id: string;
  name: string;
  status: "active" | "suspended" | "revoked";
  /** Why a suspended or revoked brand is in that status; null for an active brand or when none was recorded. */
  reason: string | null;
  changedOn: string | null;
  /** When the brand entered the register. */
  registeredOn: string | null;
  authorisations: number;
}

export interface ManufacturerProfile {
  /** The organisation id. */
  id: string;
  /** The organisation code (NOVA, SYNTH-MFG-4, GUEST-00001): the register's owner column and the profile address use it. */
  code: string;
  name: string;
  status: ComplianceStatus;
  state: string | null;
  city: string | null;
  categories: string[];
  since: string | null;
  permitteeNumber: string | null;
  applicationId: string | null;
  applicationReference: string | null;
  cin: string | null;
  gstin: string | null;
  address: string | null;
  signatory: { name: string | null; designation: string | null; email: string | null; phone: string | null };
  facilities: { name: string; location: string; capacity: string }[];
  brands: ManufacturerBrand[];
  models: { reference: string; model: string; category: string; stars: number; status: string; certificate: string; validTo: string | null; brandId: string | null; brandName: string | null }[];
  fees: { paid: number; outstanding: number; payments: { receipt: string; date: string | null; purpose: string; amount: number | null; status: string }[] };
  qr: { issued: number; bound: number; unused: number };
  production: { period: string; declared: number; state: string }[];
  documents: { name: string; status: string; date: string | null }[];
  observation: { start: string; end: string; daysLeft: number } | null;
  anomalies: { date: string | null; raisedBy: string; summary: string; status: "Open" | "Cleared" | "Revoked" }[];
  flags: { level: "Info" | "Watch" | "Attention"; label: string; detail: string }[];
  timeline: { date: string | null; title: string; detail: string }[];
}

export const MANUFACTURERS_PATH = "/api/runtime/demo/manufacturers";
/** Where a manufacturer's 360 profile lives. The code is enough: the screen finds it in the list. */
export const manufacturerProfileHref = (code: string | undefined | null) => (code ? `/app/demo/manufacturer-360?m=${encodeURIComponent(code)}` : "/app/demo/manufacturer-360");

function parse(body: unknown): ManufacturerProfile[] | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { manufacturers?: unknown }).manufacturers)) return null;
  return (body as { manufacturers: ManufacturerProfile[] }).manufacturers;
}

export type ManufacturersState = { phase: "loading" } | { phase: "ready"; list: ManufacturerProfile[] } | { phase: "failed"; message: string };

/** The manufacturer list, read once per mount; `phase` tells a screen whether to wait, show it or fall back. */
export function useManufacturers(enabled = true): ManufacturersState {
  const [state, setState] = useState<ManufacturersState>({ phase: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void runtimeRead(MANUFACTURERS_PATH, parse).then((r) => {
      if (cancelled) return;
      setState(r.ok ? { phase: "ready", list: r.value } : { phase: "failed", message: r.failure.message });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return state;
}

/** The profile for an address value: an organisation code, an organisation id, or a company registration (`live-<application id>`). */
export function findManufacturer(list: readonly ManufacturerProfile[], key: string | null | undefined): ManufacturerProfile | undefined {
  if (!key) return undefined;
  return list.find((m) => m.code === key || m.id === key || (m.applicationId !== null && key === `live-${m.applicationId}`));
}

export const inr = (n: number | null | undefined) => `₹${Number(n ?? 0).toLocaleString("en-IN")}`;

/** The models filed under one brand: by brand id when the model carries it, else by brand name. */
export function modelsOfBrand(owner: ManufacturerProfile | undefined, brand: { id: string; name: string }): ManufacturerProfile["models"] {
  return (owner?.models ?? []).filter((m) => m.brandId === brand.id || (!m.brandId && m.brandName === brand.name));
}

/** The categories a brand is registered under: those of its models, else those of its owner (the programme's own category, RAC). */
export function brandCategories(owner: ManufacturerProfile | undefined, brand: { id: string; name: string }): string[] {
  const own = [...new Set(modelsOfBrand(owner, brand).map((m) => m.category))].sort();
  return own.length ? own : owner?.categories.length ? owner.categories : ["RAC"];
}
