import type { ManufacturerDraft, ManufacturerFacility } from "./types";

export function createEmptyFacility(): ManufacturerFacility {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `fac-${crypto.randomUUID()}`
      : `fac-${Date.now()}`;
  return { id, name: "", addressLine: "", city: "", state: "", pincode: "", sameAsBusiness: false, addressLine2: "", district: "", phone: "", mobile: "", fax: "", email: "", website: "", qmsValidTill: "" };
}

/** Real API drafts often omit facilities until the applicant fills step 3. */
export function normalizeDraftFacilities(draft: ManufacturerDraft): ManufacturerDraft {
  if (draft.facilities.length > 0) return draft;
  return { ...draft, facilities: [createEmptyFacility()] };
}
