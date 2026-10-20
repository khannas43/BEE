/**
 * Manufacturer onboarding document kinds (Spring authority). The registration asks for the documents of section 1.1 of the SOP for the BEE S&L
 * portal (REGISTRATION_DOCUMENT_KINDS); the eight kinds of the earlier wizard stay known so records submitted before still read correctly.
 */
export const REGISTRATION_DOCUMENT_KINDS = [
  "retailers_list",
  "trademark_company_registration",
  "qms_iso9001",
  "signatory_authority_letter",
  "signatory_id_proof",
  "ssi_certificate",
] as const;

export const EARLIER_DOCUMENT_KINDS = [
  "trade_licence",
  "certificate_of_incorporation",
  "gst_certificate",
  "pan_card",
  "signatory_photo_id",
  "facility_address_proof",
  "signed_declaration",
  "signed_agreement",
] as const;

export const MANUFACTURER_ONBOARDING_DOCUMENT_KINDS = [...REGISTRATION_DOCUMENT_KINDS, ...EARLIER_DOCUMENT_KINDS] as const;

export type ManufacturerOnboardingDocumentKind = (typeof MANUFACTURER_ONBOARDING_DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<ManufacturerOnboardingDocumentKind, string> = {
  retailers_list: "List of authorised retailers / dealers",
  trademark_company_registration: "Trade mark and company registration certificate",
  qms_iso9001: "Quality management system certificate (ISO 9001)",
  signatory_authority_letter: "Authorised letter for the signatory",
  signatory_id_proof: "ID proof of the authorised signatory",
  ssi_certificate: "Small-scale industry (SSI) certificate",
  trade_licence: "Trade licence",
  certificate_of_incorporation: "Certificate of incorporation",
  gst_certificate: "GST certificate",
  pan_card: "PAN card",
  signatory_photo_id: "Signatory photo ID",
  facility_address_proof: "Facility address proof",
  signed_declaration: "Signed declaration",
  signed_agreement: "Signed agreement",
};

/** What each document is for, shown under its name (from the SOP). */
export const DOCUMENT_KIND_HINTS: Partial<Record<ManufacturerOnboardingDocumentKind, string>> = {
  retailers_list: "In the format provided by BEE (download the authorised retailers / dealers format).",
  trademark_company_registration: "Certificate of the trade mark and of the company registration. Enter the date it is valid till.",
  qms_iso9001: "ISO 9001 certificate of the manufacturing facility. Enter the date it is valid till.",
  signatory_authority_letter: "Letter authorising the signatory, on the company letter head.",
  signatory_id_proof: "ID proof of the signatory (Aadhaar, passport, driving licence and so on).",
  ssi_certificate: "Needed only when the company is a small-scale industry.",
};

/** Kinds that carry a "valid till" date (the SOP asks for it on these). */
export const DOCUMENT_KINDS_WITH_VALIDITY: readonly string[] = ["trademark_company_registration", "qms_iso9001"];

export function annexureDocumentsFromHeads(
  documents: { documentKind: string; status: string; latestVersion: number; expiresOn?: string }[] | undefined,
  scale: string = "",
): import("./types").AnnexureDocument[] {
  const byKind = new Map((documents ?? []).map((d) => [d.documentKind, d]));
  const asked = REGISTRATION_DOCUMENT_KINDS.filter((k) => k !== "ssi_certificate" || scale === "small");
  const earlier = EARLIER_DOCUMENT_KINDS.filter((k) => byKind.get(k)?.status === "uploaded");
  return [...asked, ...earlier].map((kind) => {
    const head = byKind.get(kind);
    const uploaded = head?.status === "uploaded";
    return {
      id: kind,
      kind: DOCUMENT_KIND_LABELS[kind],
      fileName: uploaded ? `${kind}-v${head!.latestVersion}.pdf` : `${kind}.pdf`,
      uploadedAt: uploaded ? new Date().toISOString() : null,
      expiresOn: head?.expiresOn,
    };
  });
}
