/** Required manufacturer onboarding document kinds (Spring authority). */
export const MANUFACTURER_ONBOARDING_DOCUMENT_KINDS = [
  "trade_licence",
  "certificate_of_incorporation",
  "gst_certificate",
  "pan_card",
  "signatory_photo_id",
  "facility_address_proof",
  "signed_declaration",
  "signed_agreement",
] as const;

export type ManufacturerOnboardingDocumentKind = (typeof MANUFACTURER_ONBOARDING_DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<ManufacturerOnboardingDocumentKind, string> = {
  trade_licence: "Trade licence",
  certificate_of_incorporation: "Certificate of incorporation",
  gst_certificate: "GST certificate",
  pan_card: "PAN card",
  signatory_photo_id: "Signatory photo ID",
  facility_address_proof: "Facility address proof",
  signed_declaration: "Signed declaration",
  signed_agreement: "Signed agreement",
};

export function annexureDocumentsFromHeads(
  documents: { documentKind: string; status: string; latestVersion: number }[] | undefined,
): import("./types").AnnexureDocument[] {
  const byKind = new Map((documents ?? []).map((d) => [d.documentKind, d]));
  return MANUFACTURER_ONBOARDING_DOCUMENT_KINDS.map((kind) => {
    const head = byKind.get(kind);
    const uploaded = head?.status === "uploaded";
    return {
      id: kind,
      kind: DOCUMENT_KIND_LABELS[kind],
      fileName: uploaded ? `${kind}-v${head!.latestVersion}.pdf` : `${kind}.pdf`,
      uploadedAt: uploaded ? new Date().toISOString() : null,
    };
  });
}
