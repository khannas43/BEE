import { ManufacturerRouteShell } from "@/components/app/manufacturer-onboarding/ManufacturerRouteShell";
import { ApplicationLifecycle } from "@/components/app/manufacturer-onboarding/ApplicationLifecycle";

export default async function ManufacturerApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ManufacturerRouteShell>
      <ApplicationLifecycle id={id} />
    </ManufacturerRouteShell>
  );
}
