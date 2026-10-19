import type { ManufacturerOnboardingDocumentKind } from "./documentKinds";
import { DOCUMENT_KIND_LABELS, MANUFACTURER_ONBOARDING_DOCUMENT_KINDS } from "./documentKinds";

export const DOCUMENT_KIND_ICONS: Record<ManufacturerOnboardingDocumentKind, string> = {
  trade_licence: "description",
  certificate_of_incorporation: "account_balance",
  gst_certificate: "receipt",
  pan_card: "badge",
  signatory_photo_id: "verified_user",
  facility_address_proof: "location_on",
  signed_declaration: "draw",
  signed_agreement: "contract",
};

export function emptyAnnexureNotes(): Record<ManufacturerOnboardingDocumentKind, string> {
  return Object.fromEntries(MANUFACTURER_ONBOARDING_DOCUMENT_KINDS.map((k) => [k, ""])) as Record<
    ManufacturerOnboardingDocumentKind,
    string
  >;
}

export function readAnnexureNotes(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function annexureDisplayTitle(documentKind: string, notes: Record<string, string>): string {
  const custom = notes[documentKind]?.trim();
  if (custom) return custom;
  return DOCUMENT_KIND_LABELS[documentKind as ManufacturerOnboardingDocumentKind] ?? documentKind.replace(/_/g, " ");
}
