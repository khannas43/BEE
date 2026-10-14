import { notFound } from "next/navigation";
import { RegisterRevocations } from "@/components/app/registrations/RegisterRevocations";
import { moduleById, screenById } from "@/lib/screens";

/** Standalone route. Programme and the Director reach it from the menu; other roles do not. */
export default function RegisterPage() {
  const model = moduleById("model-label");
  const dashboard = screenById("model-label", "model-dashboard");
  if (!model || !dashboard) notFound();
  return <RegisterRevocations module={model} screen={{ ...dashboard, id: "register", name: "Register" }} />;
}
