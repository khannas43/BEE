import { notFound } from "next/navigation";
import { RegistrationList } from "@/components/app/registrations/RegistrationList";
import { moduleById, screenById } from "@/lib/screens";

/** Standalone route. It borrows the model-label frame; the menu entry follows the manufacturer and agency roles. */
export default function RegistrationRequestsPage() {
  const model = moduleById("model-label");
  const dashboard = screenById("model-label", "model-dashboard");
  if (!model || !dashboard) notFound();
  return <RegistrationList module={model} screen={{ ...dashboard, id: "registration-requests", name: "Registration requests" }} />;
}
