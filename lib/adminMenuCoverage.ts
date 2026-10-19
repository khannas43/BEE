/**
 * Brief C3A: every Admin menu runtime route must have proven read-only access (backend + UI tests)
 * or be documented in NOT_IN_MENU. The coverage test fails if a new live link is added without one.
 */
import { NOT_IN_MENU, leaves, menuRoutesFor, navigationFor } from "./navigation";
import { RUNTIME_ROUTES } from "./runtimeRoutes";

export const ADMIN_DEMO_CAPS = ["fee_rule_manage", "rating_scheme_manage", "business_setting_manage", "fee_confirmation_correct"] as const;

/** Runtime routes the Admin demonstration menu opens; each maps to the test that proves read-only access. */
export const ADMIN_RUNTIME_READ_ONLY_PROVEN: Readonly<Record<string, string>> = {
  "/app/manufacturer/onboarding": "SnlWp03OptimizedManufacturerOnboardingDatabaseTest + AdminDemonstration.test.tsx",
  "/app/manufacturer/monitoring": "ManufacturerOnboardingPolicy read scope + AdminDemonstration.test.tsx",
  "/app/registrations/requests": "RegistrationDatabaseTest.whoReadsWhat + AdminDemonstration.test.tsx",
  "/app/registrations/reviews": "RegistrationReviewDatabaseTest + AdminDemonstration.test.tsx",
  "/app/registrations/register": "Register revocation read scope + AdminDemonstration.test.tsx",
  "/app/registrations/fees": "RegistrationDatabaseTest + AdminDemonstration.test.tsx",
  "/app/finance/finance-queue": "SlicePolicy admin allRecords + FinanceQueue read-only UI",
  "/app/workflow/personal-inbox": "SlicePolicy read scope + MyWork ScreenChrome",
  "/app/workflow/my-approvals": "SlicePolicy stage reads + ScreenChrome",
  "/app/workflow/application-review": "WorkflowViews read + ScreenChrome",
  "/app/workflow/escalation-dashboard": "WorkflowViews read + ScreenChrome",
  "/app/workflow/workflow-history": "HistoryService read scope + ScreenChrome",
  "/app/model-label/model-dashboard": "Model dashboard runtime list (SlicePolicy)",
  "/app/model-label/new-model-application": "Model draft read; mutations denied (ModelDraftPolicy)",
  "/app/model-label/notifications": "Notifications read API",
  "/app/model-label/label-preview": "Certificate read route",
  "/app/model-label/iame-scrutiny": "Stage work read (assigned/allRecords)",
  "/app/model-label/bee-scrutiny": "Stage work read",
  "/app/model-label/rating-calculation": "Rating read stage",
  "/app/model-label/director-approval": "Director stage read",
  "/app/delegations": "DelegationDatabaseTest (admin approve unchanged)",
  "/app/administration/fee-rules": "FeeRuleDatabaseTest admin read + propose own",
  "/app/administration/rating-formula": "RatingSchemeDatabaseTest admin read",
  "/app/administration/business-settings": "BusinessSettingDatabaseTest admin read",
  "/app/finance/receipt": "Fee correction admin capability (not operational mutation)",
  "/app/demo/mis": "Demo MIS read module",
  "/app/demo/payments": "Demo payments read",
  "/app/demo/ai": "AiDemoModule read roles include admin",
  "/app/demo/ledger": "LedgerDatabaseTest admin read/write (demo ledger, not slice workflow)",
  "/app/demo/qr": "QrModule admin reader",
  "/app/demo/executive": "DashboardDatabaseTest executive view",
  "/app/demo/manufacturer-360": "Demo manufacturer 360 read",
  "/app/demo/notifications": "Messages read API",
  "/app/demo/director": "Demo director dashboard read",
  "/app/demo/production": "Demo production read",
  "/app/demo/auditor": "DashboardDatabaseTest auditor view",
  "/app/verify": "Public verify page (standalone)",
};

/** Admin `available` menu routes that are runtime screens must appear here or in NOT_IN_MENU. */
export function adminRuntimeRoutesMissingCoverage(): string[] {
  const groups = navigationFor([{ role: "admin" }], [...ADMIN_DEMO_CAPS]);
  const menuRoutes = menuRoutesFor(groups);
  const runtimeOnMenu = [...menuRoutes].filter((href) => RUNTIME_ROUTES.some((r) => r.href === href));
  return runtimeOnMenu.filter((href) => !(href in NOT_IN_MENU) && !(href in ADMIN_RUNTIME_READ_ONLY_PROVEN));
}
