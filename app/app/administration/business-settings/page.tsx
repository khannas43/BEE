import { notFound } from "next/navigation";
import { BusinessSettings } from "@/components/app/admin/BusinessSettings";
import { moduleById, screenById } from "@/lib/screens";

/** A standalone route. It borrows the administration frame; the menu entry follows the permission, not the prototype catalogue. */
export default function BusinessSettingsPage() {
  const administration = moduleById("administration");
  const feeRules = screenById("administration", "fee-rules");
  if (!administration || !feeRules) notFound();
  return <BusinessSettings module={administration} screen={{ ...feeRules, id: "business-settings", name: "Business settings" }} />;
}
