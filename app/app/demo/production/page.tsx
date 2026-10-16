import { DemoShell } from "@/components/app/demo/DemoShell";
import { ProductionDemo } from "@/components/app/demo/ProductionDemo";

/** Demonstration area (production); see docs/demo/DEMO_WORK_PLAN.md. */
export default function Page() {
  return (
    <DemoShell icon="factory">
      <ProductionDemo />
    </DemoShell>
  );
}
