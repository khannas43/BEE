import type { ModelApplication } from "@/lib/client/runtimeModelApplications";
import { stateLabel } from "@/lib/client/runtimeModelApplications";
import type { DescriptionList } from "@/components/app/kit/StatePanels";

type DetailRow = Parameters<typeof DescriptionList>[0]["rows"][number];

/** Shared application fields for officer stage screens (optional Stage row). */
export function stageDetailRows(application: ModelApplication, options?: { includeStage?: boolean }): DetailRow[] {
  const rows: DetailRow[] = [
    { label: "Reference", value: application.reference, mono: true },
    { label: "Organisation", value: application.organisation },
    { label: "Brand", value: application.brandName },
    { label: "Model number", value: application.modelNumber },
    { label: "Laboratory", value: application.laboratoryCode ?? "—" },
    { label: "Test date", value: application.testedOn ?? "—" },
    {
      label: "Declared efficiency",
      value: application.declaredIseer === undefined ? "—" : String(application.declaredIseer),
    },
  ];
  if (options?.includeStage) {
    rows.push({ label: "Stage", value: stateLabel(application.state) });
  }
  rows.push({ label: "Version", value: String(application.version) });
  return rows;
}
