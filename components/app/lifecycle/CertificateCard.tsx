import Link from "next/link";
import type { ModelApplication } from "@/lib/client/runtimeModelApplications";

/**
 * The certificate issued when the application was approved (WP09.1a; the owner's assumptions D7 to D9, not BEE's decisions). It is a
 * local demonstration, never a BEE certificate, and says so. Status (valid or expired) comes from Spring, worked out from the dates.
 */
export const CERTIFICATE_COPY = {
  heading: "Your application is approved",
  demo: "Local demonstration: this certificate is not issued by BEE and has no legal effect.",
  statusLabel: { valid: "Valid", expired: "Expired", not_yet_valid: "Not yet valid" },
} as const;

type Certificate = NonNullable<ModelApplication["certificate"]>;

export function CertificateCard({ certificate, applicationId, testIdPrefix = "model-app-certificate" }: { certificate: Certificate; applicationId?: string; testIdPrefix?: string }) {
  return (
    <div className="mt-space-md rounded-lg border border-primary/40 bg-primary/5 p-space-md" data-testid={testIdPrefix} data-status={certificate.status}>
      <p className="font-label-md text-label-md text-on-surface">{CERTIFICATE_COPY.heading}</p>
      <p className="font-title-md text-title-md text-on-surface mt-1 font-mono" data-testid={`${testIdPrefix}-registration`}>{certificate.registrationId}</p>
      <p className="font-body-sm text-body-sm mt-1" data-testid={`${testIdPrefix}-validity`}>
        {CERTIFICATE_COPY.statusLabel[certificate.status]} · valid from {certificate.validFrom} to {certificate.validTo}
      </p>
      <p className="font-body-sm text-body-sm mt-1" data-testid={`${testIdPrefix}-rating`}>
        {"★".repeat(certificate.stars)}{"☆".repeat(5 - certificate.stars)} {certificate.stars} {certificate.stars === 1 ? "star" : "stars"} · efficiency {certificate.verifiedIseer}
      </p>
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-1" data-testid={`${testIdPrefix}-demo`}>{CERTIFICATE_COPY.demo}</p>
      {applicationId ? (
        <Link href={`/app/model-label/label-preview?id=${encodeURIComponent(applicationId)}`} className="inline-block mt-space-sm text-primary font-label-md hover:underline" data-testid={`${testIdPrefix}-open`}>
          Open the printable certificate and label
        </Link>
      ) : null}
    </div>
  );
}
