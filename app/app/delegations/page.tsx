import { notFound } from "next/navigation";
import { Delegations } from "@/components/app/delegations/Delegations";
import { moduleById, screenById } from "@/lib/screens";

/** Standalone route. Programme, the Director, Finance and the Administrator reach it from the menu. */
export default function DelegationsPage() {
  const model = moduleById("model-label");
  const dashboard = screenById("model-label", "model-dashboard");
  if (!model || !dashboard) notFound();
  return <Delegations module={model} screen={{ ...dashboard, id: "delegations", name: "Delegations" }} />;
}
