import { DemoShell } from "@/components/app/demo/DemoShell";
import { AiDemo } from "@/components/app/demo/AiDemo";

/** Demonstration area (ai); see docs/demo/DEMO_WORK_PLAN.md. */
export default function Page() {
  return (
    <DemoShell icon="psychology">
      <AiDemo />
    </DemoShell>
  );
}
