/** Applicant company-registration wizard — full-page flow, not the signed-in console. */
export function isManufacturerRegistrationWizardPath(pathname: string): boolean {
  return pathname === "/app/manufacturer/onboarding" || pathname === "/app/manufacturer/onboarding/";
}
