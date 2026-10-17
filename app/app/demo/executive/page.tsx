import { DemoShell } from "@/components/app/demo/DemoShell";
import { ExecutiveDashboard } from "@/components/app/demo/ExecutiveDashboard";

/** Demonstration area (the executive dashboard for the Director and the Secretary). */
export default function Page() {
  return (
    <DemoShell icon="space_dashboard">
      <ExecutiveDashboard />
    </DemoShell>
  );
}
