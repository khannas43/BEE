import { notFound } from "next/navigation";
import { MyWork } from "@/components/app/workflow/MyWork";
import { moduleById, screenById } from "@/lib/screens";

/** A standalone route: it borrows the Personal inbox entry for the screen frame and is named for itself. */
export default function MyApprovalsPage() {
  const workflowModule = moduleById("workflow");
  const inbox = screenById("workflow", "personal-inbox");
  if (!workflowModule || !inbox) notFound();
  return <MyWork module={workflowModule} screen={{ ...inbox, id: "my-approvals", name: "My approvals" }} kind="approvals" />;
}
