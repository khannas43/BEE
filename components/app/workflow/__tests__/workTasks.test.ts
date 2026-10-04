import { describe, expect, it } from "vitest";
import { workTasks } from "@/components/app/workflow/workTasks";
import type { ModelApplication, ModelState } from "@/lib/client/runtimeModelApplications";

function app(state: ModelState, id: string = state): ModelApplication {
  return { id, reference: `REF-${id}`, organisation: "NOVA", brandName: "Nova", category: "RAC", modelNumber: "M1", state, version: 1 } as ModelApplication;
}

describe("workTasks", () => {
  it("sends an officer to the screen of the stage the application is in", () => {
    const t = workTasks(["iame"], [app("iame_scrutiny", "a1")]);
    expect(t).toHaveLength(1);
    expect(t[0].href).toBe("/app/model-label/iame-scrutiny?id=a1");
    expect(t[0].approval).toBe(false);
  });

  it("marks the Director and Secretary decisions as approvals", () => {
    const t = workTasks(["secretary"], [app("director_review"), app("secretary_approval")]);
    expect(t.map((x) => x.approval)).toEqual([true, true]);
    expect(t[0].href).toContain("/app/model-label/director-approval");
  });

  it("asks Finance only for fees and the applicant only for drafts and returned applications", () => {
    const items = [app("fee_due"), app("draft"), app("returned"), app("iame_scrutiny"), app("approved")];
    expect(workTasks(["finance"], items).map((x) => x.application.state)).toEqual(["fee_due"]);
    expect(workTasks(["manufacturer"], items).map((x) => x.application.state)).toEqual(["draft", "returned"]);
  });

  it("lists nothing for a person with no role and for finished or rejected applications", () => {
    expect(workTasks([], [app("fee_due"), app("iame_scrutiny")])).toEqual([]);
    expect(workTasks(["iame", "manufacturer"], [app("approved"), app("rejected")])).toEqual([]);
  });
});
