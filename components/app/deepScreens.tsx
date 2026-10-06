"use client";

import { Module, Screen } from "@/lib/screens";
import { FinanceQueue } from "./finance/FinanceQueue";
import { IameScrutiny } from "./iame/IameScrutiny";
import { FeeCorrections } from "./admin/FeeCorrections";
import { FeeRules } from "./admin/FeeRules";
import { RatingFormulas } from "./admin/RatingFormulas";
import { MyWork } from "./workflow/MyWork";
import { ApplicationReviewView, EscalationView, WorkflowHistoryView } from "./workflow/WorkflowViews";
import { ReviewerScrutiny } from "./reviewer/ReviewerScrutiny";
import { ProgrammeRating } from "./programme/ProgrammeRating";
import { DirectorApproval } from "./director/DirectorApproval";
import { ModelDashboard } from "./lifecycle/ModelDashboard";
import { NewModelApplication } from "./lifecycle/NewModelApplication";
import { StageScreen } from "./lifecycle/StageScreen";
import { ModelPaymentScreen } from "./lifecycle/PaymentScreens";
import { ApplicationDetailScreen, FamilyModels } from "./lifecycle/ModelDetailScreens";
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
import { CertificateAndLabel } from "./lifecycle/CertificateAndLabel";
import { Notifications } from "./notifications/Notifications";

type DeepComponent = (props: { module: Module; screen: Screen }) => React.ReactNode;

function DeepSecretaryApproval({ module, screen }: { module: Module; screen: Screen }) {
  return <StageScreen module={module} screen={screen} variant="approval" />;
}

function DeepDetailTestReports({ module, screen }: { module: Module; screen: Screen }) {
  return <ApplicationDetailScreen module={module} screen={screen} variant="test-reports" />;
}

function DeepDetailDocuments({ module, screen }: { module: Module; screen: Screen }) {
  return <ApplicationDetailScreen module={module} screen={screen} variant="documents" />;
}

function DeepDetailPerformance({ module, screen }: { module: Module; screen: Screen }) {
  return <ApplicationDetailScreen module={module} screen={screen} variant="performance" />;
}

function DeepDetailLab({ module, screen }: { module: Module; screen: Screen }) {
  return <ApplicationDetailScreen module={module} screen={screen} variant="lab" />;
}

function DeepDetailLabelDetails({ module, screen }: { module: Module; screen: Screen }) {
  return <ApplicationDetailScreen module={module} screen={screen} variant="label-details" />;
}

function DeepDetailApprovalNote({ module, screen }: { module: Module; screen: Screen }) {
  return <ApplicationDetailScreen module={module} screen={screen} variant="approval-note" />;
}

function DeepDetailApprovalLetter({ module, screen }: { module: Module; screen: Screen }) {
  return <ApplicationDetailScreen module={module} screen={screen} variant="approval-letter" />;
}

function DeepDetailRenewal({ module, screen }: { module: Module; screen: Screen }) {
  return <ApplicationDetailScreen module={module} screen={screen} variant="renewal" />;
}

function DeepPublicVerification({ module, screen }: { module: Module; screen: Screen }) {
  return <VerificationScreen module={module} screen={screen} mode="public" />;
}

function DeepCertificateVerification({ module, screen }: { module: Module; screen: Screen }) {
  return <VerificationScreen module={module} screen={screen} mode="certificate" />;
}

function DeepPersonalInbox({ module, screen }: { module: Module; screen: Screen }) {
  return <MyWork module={module} screen={screen} kind="inbox" />;
}

function DeepTeamQueue({ module, screen }: { module: Module; screen: Screen }) {
  return <WorkflowInbox module={module} screen={screen} scope="team" />;
}

export const DEEP_SCREENS: Record<string, DeepComponent> = {
  // Model & Label — full lifecycle
  "finance/finance-queue": FinanceQueue,
  "model-label/model-dashboard": ModelDashboard,
  "model-label/new-model-application": NewModelApplication,
  "model-label/notifications": Notifications,
  "model-label/model-payment": ModelPaymentScreen,
  "model-label/iame-scrutiny": IameScrutiny,
  "model-label/bee-scrutiny": ReviewerScrutiny,
  "model-label/director-approval": DirectorApproval,
  "model-label/secretary-approval": DeepSecretaryApproval,
  "model-label/rating-calculation": ProgrammeRating,
  "model-label/label-preview": CertificateAndLabel,
  "model-label/test-reports": DeepDetailTestReports,
  "model-label/model-documents": DeepDetailDocuments,
  "model-label/performance-parameters": DeepDetailPerformance,
  "model-label/lab-accreditation": DeepDetailLab,
  "model-label/label-details": DeepDetailLabelDetails,
  "model-label/approval-note": DeepDetailApprovalNote,
  "model-label/approval-letter": DeepDetailApprovalLetter,
  "model-label/renewal-or-degradation": DeepDetailRenewal,
  "model-label/family-models": FamilyModels,

  // QR & Verification — batches allocated against active models; verify closes the loop
  "qr-verification/qr-batch-request": QRBatchRequest,
  "qr-verification/qr-batch-status": QRBatchStatus,
  "qr-verification/batch-file-download": BatchFileDownload,
  "qr-verification/serial-upload": SerialUpload,
  "qr-verification/duplicate-exceptions": DuplicateExceptions,
  "qr-verification/qr-download": QRDownload,
  "qr-verification/public-verification": DeepPublicVerification,
  "qr-verification/certificate-verification": DeepCertificateVerification,

  // Workflow — driven by the same store
  "administration/fee-rules": FeeRules,
  "finance/receipt": FeeCorrections,
  "administration/rating-formula": RatingFormulas,

  "workflow/personal-inbox": DeepPersonalInbox,
  "workflow/team-queue": DeepTeamQueue,
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
