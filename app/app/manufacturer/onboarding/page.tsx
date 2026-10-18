import { ManufacturerRouteShell } from "@/components/app/manufacturer-onboarding/ManufacturerRouteShell";
import { OnboardingWizard } from "@/components/app/manufacturer-onboarding/OnboardingWizard";

export default function ManufacturerOnboardingPage() {
  return (
    <ManufacturerRouteShell>
      <OnboardingWizard />
    </ManufacturerRouteShell>
  );
}
