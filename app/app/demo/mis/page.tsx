import { DemoShell } from "@/components/app/demo/DemoShell";
import { MisDemo } from "@/components/app/demo/MisDemo";

/** Demonstration area (mis); see docs/demo/DEMO_WORK_PLAN.md. */
export default function Page() {
  return (
    <DemoShell icon="monitoring">
      <MisDemo />
    </DemoShell>
  );
}
