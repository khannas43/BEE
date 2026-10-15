import { DemoShell } from "@/components/app/demo/DemoShell";
import { LedgerDemo } from "@/components/app/demo/LedgerDemo";

/** Demonstration area (ledger); see docs/demo/DEMO_WORK_PLAN.md. */
export default function Page() {
  return (
    <DemoShell icon="link">
      <LedgerDemo />
    </DemoShell>
  );
}
