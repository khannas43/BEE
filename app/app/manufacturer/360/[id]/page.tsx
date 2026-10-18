import { ManufacturerRouteShell } from "@/components/app/manufacturer-onboarding/ManufacturerRouteShell";
import { Manufacturer360View } from "@/components/app/manufacturer-onboarding/Manufacturer360View";

export default async function Manufacturer360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ManufacturerRouteShell>
      <Manufacturer360View id={id} />
    </ManufacturerRouteShell>
  );
}
