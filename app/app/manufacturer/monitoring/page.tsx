import { ManufacturerRouteShell } from "@/components/app/manufacturer-onboarding/ManufacturerRouteShell";
import { MonitoringQueue } from "@/components/app/manufacturer-onboarding/MonitoringQueue";

export default function ManufacturerMonitoringPage() {
  return (
    <ManufacturerRouteShell>
      <MonitoringQueue />
    </ManufacturerRouteShell>
  );
}
