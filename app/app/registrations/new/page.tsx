import { notFound } from "next/navigation";
import { RegistrationNew } from "@/components/app/registrations/RegistrationNew";
import { moduleById, screenById } from "@/lib/screens";

/** Standalone route, reached from the registration list. */
export default function NewRegistrationPage() {
  const model = moduleById("model-label");
  const dashboard = screenById("model-label", "model-dashboard");
  if (!model || !dashboard) notFound();
  return <RegistrationNew module={model} screen={{ ...dashboard, id: "registration-new", name: "New registration request" }} />;
}
