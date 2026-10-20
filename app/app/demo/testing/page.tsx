import { DemoShell } from "@/components/app/demo/DemoShell";
import { ProductTesting } from "@/components/app/demo/ProductTesting";

/** Demonstration area (BEE Officer: random testing of products, from grievances and compliance risk). */
export default function Page() {
  return (
    <DemoShell icon="science">
      <ProductTesting />
    </DemoShell>
  );
}
