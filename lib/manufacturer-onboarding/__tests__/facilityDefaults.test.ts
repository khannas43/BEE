import { emptySop } from "@/lib/manufacturer-onboarding/sopDefaults";
import { describe, expect, it } from "vitest";
import { annexureDocumentsFromHeads } from "../documentKinds";
import { normalizeDraftFacilities } from "../facilityDefaults";
import { emptyAuthorisedSignatory } from "../signatoryDefaults";
import type { ManufacturerDraft } from "../types";

function emptyDraft(): ManufacturerDraft {
  return {
    legalName: "Demo Co",
    cin: "",
    gstin: "",
    registeredAddress: { line1: "", line2: "", city: "", state: "", pincode: "" },
    facilities: [],
    contacts: [],
    authorisedSignatory: emptyAuthorisedSignatory(),
    annexureDocuments: annexureDocumentsFromHeads([]),
    annexureNotes: {},
    applicantAccount: null,
    declarationAccepted: false,
    agreementAccepted: false, sop: emptySop(),
  };
}

describe("normalizeDraftFacilities", () => {
  it("adds one blank facility when the API draft has none", () => {
    const normalized = normalizeDraftFacilities(emptyDraft());
    expect(normalized.facilities).toHaveLength(1);
    expect(normalized.facilities[0]?.name).toBe("");
  });

  it("leaves existing facilities unchanged", () => {
    const draft = {
      ...emptyDraft(),
      facilities: [{ id: "fac-1", name: "Plant A", addressLine: "Line", city: "Pune", state: "MH", pincode: "411001" }],
    };
    const normalized = normalizeDraftFacilities(draft);
    expect(normalized.facilities[0]?.name).toBe("Plant A");
  });
});
