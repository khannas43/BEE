import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

export default function ManufacturerRegistrationConfirmationPage() {
  return (
    <section className="w-full bg-surface-ground py-space-lg">
      <div className="max-w-3xl mx-auto px-gutter">
        <div className="rounded-2xl border border-success/30 bg-surface-card shadow-sm p-space-lg text-center space-y-space-md" data-testid="manufacturer-account-confirmation">
          <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-success-container text-on-success-container">
            <Icon name="check_circle" size={34} />
          </span>
          <div className="space-y-2">
            <h1 className="font-headline-md text-headline-md font-bold">Thank you for creating your account</h1>
            <p className="font-body-md text-on-surface-variant">
              Your manufacturer applicant account has been created successfully.
            </p>
            <p className="font-body-md text-on-surface-variant">
              Please check your email for the registration acknowledgement and keep your username and password safely for future sign-in.
            </p>
            <p className="font-body-sm text-on-surface-variant">
              Demonstration note: the email acknowledgement is shown as part of this local demo; no external email is sent.
            </p>
          </div>
          <Link
            href="/app/manufacturer/onboarding"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-space-md py-2.5 font-label-lg text-on-primary"
            data-testid="continue-manufacturer-application"
          >
            Continue to manufacturer application <Icon name="arrow_forward" size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}
