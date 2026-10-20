import { DemoShell } from "@/components/app/demo/DemoShell";
import { ServiceRequests } from "@/components/app/demo/ServiceRequests";

/** Demonstration area (renewals, withdrawals and helpdesk requests). */
export default function Page() {
  return (
    <DemoShell icon="support_agent">
      <ServiceRequests />
    </DemoShell>
  );
}
