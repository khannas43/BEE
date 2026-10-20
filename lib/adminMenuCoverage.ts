/**
 * Brief C3A: every Admin menu runtime route must have proven read-only access (backend + UI tests)
 * or be documented in NOT_IN_MENU. The coverage test fails if a new live link is added without one.
 */
import { NOT_IN_MENU, menuRoutesFor, navigationFor } from "./navigation";
import { RUNTIME_ROUTES } from "./runtimeRoutes";

export const ADMIN_DEMO_CAPS = ["fee_rule_manage", "rating_scheme_manage", "business_setting_manage", "fee_confirmation_correct"] as const;

/** Named test identifiers that prove read-only Admin access for a runtime menu route. */
export type AdminRouteProof = {
  backend?: readonly string[];
  ui: readonly string[];
};

const UI_CHROME = "AdminDemonstration.test.tsx: ScreenChrome hides header actions when Spring reports read-only Admin";
const UI_REG_LIST = "AdminDemonstration.test.tsx: Registration list hides New request for read-only Admin";

/** Runtime routes the Admin demonstration menu opens; each maps to named tests that prove read-only access. */
export const ADMIN_RUNTIME_READ_ONLY_PROVEN: Readonly<Record<string, AdminRouteProof>> = {
  "/app/manufacturer/onboarding": {
    backend: ["SnlWp03OptimizedManufacturerOnboardingDatabaseTest.adminDemonstrationReadsAllOnboardingApplicationsButCannotMutate"],
    ui: [UI_CHROME],
  },
  "/app/manufacturer/monitoring": {
    backend: ["SnlWp03OptimizedManufacturerOnboardingDatabaseTest.adminDemonstrationReadsAllOnboardingApplicationsButCannotMutate"],
    ui: [UI_CHROME],
  },
  "/app/registrations/requests": {
    backend: ["RegistrationDatabaseTest.adminDemonstrationListsAndReadsButCannotMutate"],
    ui: [UI_REG_LIST],
  },
  "/app/registrations/reviews": {
    backend: ["SlicePolicyTest.adminDemonstrationReadsAllModelApplications"],
    ui: [UI_CHROME],
  },
  "/app/registrations/register": {
    backend: ["RevocationDatabaseTest.adminDemonstrationReadsRegisterButCannotMutate"],
    ui: ["RegisterRevocations.test.tsx: read-only Admin hides revocation mutation controls"],
  },
  "/app/registrations/fees": {
    backend: ["RegistrationDatabaseTest.adminDemonstrationListsAndReadsButCannotMutate"],
    ui: [UI_CHROME],
  },
  "/app/finance/finance-queue": {
    backend: ["SlicePolicyTest.adminDemonstrationReadsAllModelApplications"],
    ui: [UI_CHROME],
  },
  "/app/workflow/personal-inbox": {
    backend: ["SlicePolicyTest.adminDemonstrationReadsAllModelApplications"],
    ui: [UI_CHROME],
  },
  "/app/workflow/my-approvals": {
    backend: ["SlicePolicyTest.adminDemonstrationReadsAllModelApplications"],
    ui: [UI_CHROME],
  },
  "/app/workflow/application-review": {
    backend: ["SlicePolicyTest.adminDemonstrationReadsAllModelApplications"],
    ui: [UI_CHROME],
  },
  "/app/workflow/escalation-dashboard": {
    backend: ["SlicePolicyTest.adminDemonstrationReadsAllModelApplications"],
    ui: [UI_CHROME],
  },
  "/app/workflow/workflow-history": {
    backend: ["SlicePolicyTest.adminDemonstrationReadsAllModelApplications"],
    ui: [UI_CHROME],
  },
  "/app/model-label/model-dashboard": {
    backend: ["SlicePolicyTest.adminDemonstrationReadsAllModelApplications"],
    ui: [UI_CHROME],
  },
  "/app/model-label/new-model-application": {
    backend: ["SlicePolicyTest.adminDemonstrationReadsAllModelApplications"],
    ui: [UI_CHROME],
  },
  "/app/model-label/notifications": {
    backend: ["SlicePolicyTest.adminDemonstrationReadsAllModelApplications"],
    ui: [UI_CHROME],
  },
  "/app/model-label/label-preview": {
    backend: ["SlicePolicyTest.adminDemonstrationReadsAllModelApplications"],
    ui: [UI_CHROME],
  },
  "/app/model-label/iame-scrutiny": {
    backend: ["SlicePolicyTest.adminDemonstrationReadsAllModelApplications"],
    ui: [UI_CHROME],
  },
  "/app/model-label/bee-scrutiny": {
    backend: ["SlicePolicyTest.adminDemonstrationReadsAllModelApplications"],
    ui: [UI_CHROME],
  },
  "/app/model-label/rating-calculation": {
    backend: ["SlicePolicyTest.adminDemonstrationReadsAllModelApplications"],
    ui: [UI_CHROME],
  },
  "/app/model-label/director-approval": {
    backend: ["SlicePolicyTest.adminDemonstrationReadsAllModelApplications"],
    ui: [UI_CHROME],
  },
  "/app/delegations": {
    backend: ["DelegationDatabaseTest.anAdministratorApprovesThirdPersonOnlyAndTheDelegateThenHoldsTheRoleButNotMoreThanThat"],
    ui: [UI_CHROME],
  },
  "/app/administration/fee-rules": {
    backend: ["FeeRuleDatabaseTest.theAdministratorHoldsTheCapabilityAndNobodyElseDoes"],
    ui: [UI_CHROME],
  },
  "/app/administration/rating-formula": {
    backend: ["RatingSchemeDatabaseTest.onlyTheAdministratorHoldsThePermissionAndNothingElseDoes"],
    ui: [UI_CHROME],
  },
  "/app/administration/business-settings": {
    backend: ["BusinessSettingDatabaseTest.onlyTheAdministratorHoldsThePermissionAndTheFiveSettingsHaveTheirOwnersAssumptionAsDefault"],
    ui: [UI_CHROME],
  },
  "/app/finance/receipt": {
    backend: ["FeeCorrectionDatabaseTest.financeHoldsThePermissionAndTheConfirmationIsListedWithItsEffectiveValues"],
    ui: [UI_CHROME],
  },
  "/app/demo/mis": {
    backend: ["MisModuleDatabaseTest.rolesAndMethodsAreEnforced"],
    ui: [UI_CHROME],
  },
  "/app/demo/payments": {
    backend: ["PaymentsDatabaseTest.listsAreScopedAndReconciliationIsForFinanceAdminAuditor"],
    ui: [UI_CHROME],
  },
  "/app/demo/ai": {
    backend: ["AiDemoDatabaseTest.otherRolesAreDeniedAndTheAuditorOnlyReads"],
    ui: [UI_CHROME],
  },
  "/app/demo/requests": {
    backend: ["ServiceRequestsModuleTest.adminDemonstrationCannotRaiseOrAnswerRequests"],
    ui: [UI_CHROME],
  },
  "/app/demo/activity": {
    backend: ["ActivityModuleTest.callersWithoutOversightOrOrganisationAreDeniedAndBadRecordsRefused"],
    ui: [UI_CHROME],
  },
  "/app/demo/ledger": {
    backend: ["LedgerDatabaseTest.readScopeAndRoleDenials"],
    ui: [UI_CHROME],
  },
  "/app/demo/qr": {
    backend: ["QrDatabaseTest.readScopeAndPaging"],
    ui: [UI_CHROME],
  },
  "/app/demo/executive": {
    backend: ["DashboardDatabaseTest.whoMayOpenWhichDashboard"],
    ui: [UI_CHROME],
  },
  "/app/demo/manufacturer-360": {
    backend: ["DashboardDatabaseTest.theExecutiveDashboardCountsWhatIsInTheTablesAndFollowsTheFilters"],
    ui: [UI_CHROME],
  },
  "/app/demo/notifications": {
    backend: ["MessagesDatabaseTest.aPaymentWritesMessagesToThePayerAndFinanceOnlyAndReadsAreOwnOnly"],
    ui: [UI_CHROME],
  },
  "/app/demo/director": {
    backend: ["DashboardDatabaseTest.theDirectorsTilesCountWhatIsInTheTablesAndDrillDownToTheFullList"],
    ui: [UI_CHROME],
  },
  "/app/demo/production": {
    backend: ["ProductionDatabaseTest.seedHasFourQuartersAndScopeFollowsTheOrganisation"],
    ui: [UI_CHROME],
  },
  "/app/demo/auditor": {
    backend: ["DashboardDatabaseTest.theAuditorSeesTheBrokenChainFirstAndTheTwoPersonProof"],
    ui: [UI_CHROME],
  },
  "/app/verify": {
    ui: ["verifyPage.test.tsx: asks nothing until a registration ID is given"],
  },
};

/** Admin `available` menu routes that are runtime screens must appear here or in NOT_IN_MENU. */
export function adminRuntimeRoutesMissingCoverage(): string[] {
  const groups = navigationFor([{ role: "admin" }], [...ADMIN_DEMO_CAPS]);
  const menuRoutes = menuRoutesFor(groups);
  const runtimeOnMenu = [...menuRoutes].filter((href) => RUNTIME_ROUTES.some((r) => r.href === href));
  return runtimeOnMenu.filter((href) => !(href in NOT_IN_MENU) && !(href in ADMIN_RUNTIME_READ_ONLY_PROVEN));
}
