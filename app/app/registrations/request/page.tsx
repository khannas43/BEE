import { Suspense } from "react";
import { notFound } from "next/navigation";
import { RegistrationRequest } from "@/components/app/registrations/RegistrationRequest";
import { moduleById, screenById } from "@/lib/screens";

/** Standalone route. The request id is the `id` search parameter, as on the model dashboard. */
export default function RegistrationRequestPage() {
  const model = moduleById("model-label");
  const dashboard = screenById("model-label", "model-dashboard");
  if (!model || !dashboard) notFound();
  return (
    <Suspense fallback={<p className="p-space-lg font-body-md text-on-surface-variant">Loading…</p>}>
      <RegistrationRequest module={model} screen={{ ...dashboard, id: "registration-request", name: "Registration request" }} />
    </Suspense>
  );
}
