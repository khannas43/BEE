import { notFound } from "next/navigation";
import { RegistrationFees } from "@/components/app/registrations/RegistrationFees";
import { moduleById, screenById } from "@/lib/screens";

/** Standalone route. Finance reaches it from the menu; other roles do not. */
export default function RegistrationFeesPage() {
  const model = moduleById("model-label");
  const dashboard = screenById("model-label", "model-dashboard");
  if (!model || !dashboard) notFound();
  return <RegistrationFees module={model} screen={{ ...dashboard, id: "registration-fees", name: "Registration fees" }} />;
}
