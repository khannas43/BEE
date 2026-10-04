import { notFound } from "next/navigation";
import { MyWork } from "@/components/app/workflow/MyWork";
import { moduleById, screenById } from "@/lib/screens";

/** A standalone route: it borrows the Personal inbox entry for the screen frame and is named for itself. */
export default function MyApprovalsPage() {
  const module = moduleById("workflow");
  const inbox = screenById("workflow", "personal-inbox");
  if (!module || !inbox) notFound();
  return <MyWork module={module} screen={{ ...inbox, id: "my-approvals", name: "My approvals" }} kind="approvals" />;
}
