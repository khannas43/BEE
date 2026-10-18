import { ManufacturerRouteShell } from "@/components/app/manufacturer-onboarding/ManufacturerRouteShell";
import { DirectorQueue } from "@/components/app/manufacturer-onboarding/DirectorQueue";

export default function ManufacturerDirectorPage() {
  return (
    <ManufacturerRouteShell>
      <DirectorQueue />
    </ManufacturerRouteShell>
  );
}
