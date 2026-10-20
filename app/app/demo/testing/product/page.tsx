import { DemoShell } from "@/components/app/demo/DemoShell";
import { ShortlistedProduct } from "@/components/app/demo/ShortlistedProduct";

/** Demonstration area (BEE Officer: one shortlisted product, why it was picked, and the approval for testing). */
export default function Page() {
  return (
    <DemoShell icon="science">
      <ShortlistedProduct />
    </DemoShell>
  );
}
