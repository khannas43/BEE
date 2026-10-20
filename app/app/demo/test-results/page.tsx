import { DemoShell } from "@/components/app/demo/DemoShell";
import { TestResults } from "@/components/app/demo/TestResults";

/** Demonstration area (manufacturer: BEE's test results and the grievance count per product). */
export default function Page() {
  return (
    <DemoShell icon="science">
      <TestResults />
    </DemoShell>
  );
}
