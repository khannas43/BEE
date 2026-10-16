import { DemoShell } from "@/components/app/demo/DemoShell";
import { RoleDashboard } from "@/components/app/demo/RoleDashboard";

/** Demonstration area (dashboard, auditor view); see docs/demo/DEMO_WORK_PLAN.md. */
export default function Page() {
  return (
    <DemoShell icon="fact_check">
      <RoleDashboard view="auditor" />
    </DemoShell>
  );
}
