import { DemoShell } from "@/components/app/demo/DemoShell";
import { ActivityScreen } from "@/components/app/demo/ActivityScreen";

/** Demonstration area (sign-in and action trail, with the address each came from). */
export default function Page() {
  return (
    <DemoShell icon="manage_search">
      <ActivityScreen />
    </DemoShell>
  );
}
