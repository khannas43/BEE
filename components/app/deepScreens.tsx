"use client";

import { Module, Screen } from "@/lib/screens";
import { FinanceQueue } from "./finance/FinanceQueue";
import { IameScrutiny } from "./iame/IameScrutiny";
import { FeeRules } from "./admin/FeeRules";
import { RatingFormulas } from "./admin/RatingFormulas";
import { MyWork } from "./workflow/MyWork";
import { ApplicationReviewView, EscalationView, WorkflowHistoryView } from "./workflow/WorkflowViews";
import { ReviewerScrutiny } from "./reviewer/ReviewerScrutiny";
import { ProgrammeRating } from "./programme/ProgrammeRating";
import { DirectorApproval } from "./director/DirectorApproval";
import { ModelDashboard } from "./lifecycle/ModelDashboard";
import { NewModelApplication } from "./lifecycle/NewModelApplication";
import { StageScreen, StageVariant } from "./lifecycle/StageScreen";
import { ModelPaymentScreen } from "./lifecycle/PaymentScreens";
import { ApplicationDetailScreen, DetailVariant, FamilyModels } from "./lifecycle/ModelDetailScreens";
import { WorkflowInbox } from "./lifecycle/WorkflowScreens";
import {
  QRBatchRequest,
  QRBatchStatus,
  BatchFileDownload,
  SerialUpload,
  DuplicateExceptions,
  QRDownload,
  VerificationScreen,
} from "./lifecycle/QRScreens";
import {
  ComplianceRiskScoring,
  ProductionAnomalyDetection,
  DocumentIntelligence,
  HelpdeskAssistant,
  StarRatingTrends,
  AIModelGovernance,
} from "./ai/AIScreens";
import { FabricMonitoring } from "./blockchain/FabricMonitoring";
import { LabelPreviewScreen } from "./lifecycle/LabelPreviewScreen";

type DeepComponent = (props: { module: Module; screen: Screen }) => React.ReactNode;

const stage = (variant: StageVariant): DeepComponent =>
  ({ module, screen }) => <StageScreen module={module} screen={screen} variant={variant} />;

const detail = (variant: DetailVariant): DeepComponent =>
  ({ module, screen }) => <ApplicationDetailScreen module={module} screen={screen} variant={variant} />;

export const DEEP_SCREENS: Record<string, DeepComponent> = {
  // Model & Label — full lifecycle
  "finance/finance-queue": FinanceQueue,
  "model-label/model-dashboard": ModelDashboard,
  "model-label/new-model-application": NewModelApplication,
  "model-label/model-payment": ModelPaymentScreen,
  "model-label/iame-scrutiny": IameScrutiny,
  "model-label/bee-scrutiny": ReviewerScrutiny,
  "model-label/director-approval": DirectorApproval,
  "model-label/secretary-approval": stage("approval"),
  "model-label/rating-calculation": ProgrammeRating,
  "model-label/label-preview": LabelPreviewScreen,
  "model-label/test-reports": detail("test-reports"),
  "model-label/model-documents": detail("documents"),
  "model-label/performance-parameters": detail("performance"),
  "model-label/lab-accreditation": detail("lab"),
  "model-label/label-details": detail("label-details"),
  "model-label/approval-note": detail("approval-note"),
  "model-label/approval-letter": detail("approval-letter"),
  "model-label/renewal-or-degradation": detail("renewal"),
  "model-label/family-models": FamilyModels,

  // QR & Verification — batches allocated against active models; verify closes the loop
  "qr-verification/qr-batch-request": QRBatchRequest,
  "qr-verification/qr-batch-status": QRBatchStatus,
  "qr-verification/batch-file-download": BatchFileDownload,
  "qr-verification/serial-upload": SerialUpload,
  "qr-verification/duplicate-exceptions": DuplicateExceptions,
  "qr-verification/qr-download": QRDownload,
  "qr-verification/public-verification": ({ module, screen }) => <VerificationScreen module={module} screen={screen} mode="public" />,
  "qr-verification/certificate-verification": ({ module, screen }) => <VerificationScreen module={module} screen={screen} mode="certificate" />,

  // Workflow — driven by the same store
  "administration/fee-rules": FeeRules,
  "administration/rating-formula": RatingFormulas,

  "workflow/personal-inbox": ({ module, screen }) => <MyWork module={module} screen={screen} kind="inbox" />,
  "workflow/team-queue": ({ module, screen }) => <WorkflowInbox module={module} screen={screen} scope="team" />,
  "workflow/application-review": ApplicationReviewView,
  "workflow/escalation-dashboard": EscalationView,
  "workflow/workflow-history": WorkflowHistoryView,

  // MIS & AI — the five committed use cases + governance, each bespoke
  "mis-ai/risk-scoring": ComplianceRiskScoring,
  "mis-ai/production-anomaly": ProductionAnomalyDetection,
  "mis-ai/extraction-review": DocumentIntelligence,
  "mis-ai/chatbot-review": HelpdeskAssistant,
  "mis-ai/rating-trends": StarRatingTrends,
  "mis-ai/model-monitoring": AIModelGovernance,

  // Blockchain / integration monitoring
  "audit/integration-correlation": FabricMonitoring,
};

export function getDeepScreen(moduleId: string, screenId: string): DeepComponent | undefined {
  return DEEP_SCREENS[`${moduleId}/${screenId}`];
}
