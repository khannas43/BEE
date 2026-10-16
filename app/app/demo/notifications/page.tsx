import { DemoShell } from "@/components/app/demo/DemoShell";
import { MessagesDemo } from "@/components/app/demo/MessagesDemo";

/** Demonstration area (messages): simulated email and SMS; see docs/demo/DEMO_WORK_PLAN.md. */
export default function Page() {
  return (
    <DemoShell icon="notifications_active">
      <MessagesDemo />
    </DemoShell>
  );
}
