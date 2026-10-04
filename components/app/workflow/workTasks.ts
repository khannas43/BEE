import type { ModelApplication, ModelState } from "@/lib/client/runtimeModelApplications";

/**
 * A task is an application waiting for the signed-in person to act. Spring already limits the list to what the caller may
 * see (their organisation's applications, or the stage they are assigned to), so this only decides which of those need
 * action and where to go. It grants nothing: the stage screen and Spring check every action again.
 */
export interface WorkTask {
  application: ModelApplication;
  /** What the person is asked to do. */
  action: string;
  /** The screen where they do it. */
  href: string;
  /** True for the Director and Secretary decisions shown on My approvals. */
  approval: boolean;
}

const OFFICER_STAGES: Partial<Record<ModelState, { action: string; screen: string; approval?: boolean }>> = {
  iame_scrutiny: { action: "Scrutinise and record a finding", screen: "/app/model-label/iame-scrutiny" },
  bee_scrutiny: { action: "Verify and forward to rating", screen: "/app/model-label/bee-scrutiny" },
  rating: { action: "Compute and record the rating", screen: "/app/model-label/rating-calculation" },
  director_review: { action: "Recommend a decision", screen: "/app/model-label/director-approval", approval: true },
  secretary_approval: { action: "Give final approval", screen: "/app/model-label/director-approval", approval: true },
};

const DASHBOARD = "/app/model-label/model-dashboard";
const APPLICANT_ROLES = ["manufacturer", "agency"];

export function workTasks(roles: readonly string[], items: readonly ModelApplication[]): WorkTask[] {
  const applicant = roles.some((r) => APPLICANT_ROLES.includes(r));
  const finance = roles.includes("finance");
  const officer = roles.some((r) => !APPLICANT_ROLES.includes(r) && r !== "finance");
  const tasks: WorkTask[] = [];
  for (const application of items) {
    const href = (screen: string) => `${screen}?id=${encodeURIComponent(application.id)}`;
    const stage = OFFICER_STAGES[application.state];
    if (stage) {
      // An applicant sees their own application at these stages, but it is not waiting for them.
      if (officer) tasks.push({ application, action: stage.action, href: href(stage.screen), approval: stage.approval === true });
    } else if (application.state === "fee_due" && finance) {
      tasks.push({ application, action: "Confirm the fee was received", href: href("/app/finance/finance-queue"), approval: false });
    } else if (application.state === "returned" && applicant) {
      tasks.push({ application, action: "Edit and resubmit", href: href(DASHBOARD), approval: false });
    } else if (application.state === "draft" && applicant) {
      tasks.push({ application, action: "Finish and submit", href: href(DASHBOARD), approval: false });
    }
  }
  return tasks;
}
