import { DemoShell } from "@/components/app/demo/DemoShell";
import { Manufacturer360Demo } from "@/components/app/demo/Manufacturer360Demo";

/** Demonstration: Manufacturer 360 guided lifecycle (WP3–WP9); see docs/demo/MANUFACTURER_360_FIXTURE.md. */
export default function Page() {
  return (
    <DemoShell icon="hub">
      <Manufacturer360Demo />
    </DemoShell>
  );
}
