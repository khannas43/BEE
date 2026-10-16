import { DemoShell } from "@/components/app/demo/DemoShell";
import { QrDemo } from "@/components/app/demo/QrDemo";

/** Demonstration area (qr); see docs/demo/DEMO_WORK_PLAN.md. */
export default function Page() {
  return (
    <DemoShell icon="qr_code_2">
      <QrDemo />
    </DemoShell>
  );
}
