"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { DemoLoginForm } from "@/components/login/DemoLoginForm";
import { REGISTRATION_HREF, SOP_REGISTRATION_FLOW } from "@/lib/registrationFlow";

const SIGN_IN_ERRORS: Record<string, string> = {
  no_active_account: "Your identity was confirmed, but there is no active BEE portal account for it.",
  no_effective_role: "Your identity was confirmed, but you have no active BEE role that matches your sign-in.",
  access_denied: "Sign-in was cancelled or refused.",
  login_expired: "The sign-in attempt expired or was already used. Please start again.",
  invalid_state: "The sign-in response did not match this browser's request. Please start again.",
  invalid_issuer: "The sign-in response came from an unexpected identity provider.",
  invalid_id_token: "The identity token could not be verified.",
  mfa_required: "Sign-in needs your password and an authenticator code.",
  code_exchange_failed: "The sign-in could not be completed with the identity provider.",
  identity_unavailable: "The identity service is not reachable.",
  api_unreachable: "The BEE service is not reachable, so access could not be checked.",
  service_unavailable: "The BEE service is temporarily unavailable, so access could not be checked.",
  invalid_api_response: "The BEE service returned an unexpected response, so you were not signed in.",
  api_error: "The BEE service could not check your access, so you were not signed in.",
  subject_mismatch: "The BEE service answered for a different identity, so you were not signed in.",
};

const noSubscribe = () => () => {};

function noticeFor(q: URLSearchParams): { kind: "error" | "info"; text: string } | null {
  const error = q.get("error");
  if (error) return { kind: "error", text: SIGN_IN_ERRORS[error] ?? "Sign-in failed. Please try again." };
  if (q.get("signedOut")) return { kind: "info", text: "You have signed out." };
  return null;
}

export function LoginPageClient({ demo }: { demo: boolean }) {
  const search = useSyncExternalStore(noSubscribe, () => window.location.search, () => "");
  const notice = noticeFor(new URLSearchParams(search));

  return (
    <section className="min-h-[calc(100vh-196px)] bg-surface-ground px-space-md py-space-2xl flex items-center justify-center">
      <div
        className="w-full max-w-md rounded-[2.5rem] border border-border-subtle bg-surface-card px-space-lg py-space-xl sm:px-space-xl shadow-[0_18px_55px_rgba(20,55,45,0.14)]"
        data-testid="login-card"
      >
        <div className="mx-auto mb-space-md flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary">
          <Icon name="person" size={28} />
        </div>
        <h1 className="mb-space-lg text-center font-headline-md text-headline-md text-on-surface">Login</h1>

        {notice && (
          <div role={notice.kind === "error" ? "alert" : "status"} className={`mb-space-md rounded-lg px-3 py-2 font-body-sm text-body-sm ${notice.kind === "error" ? "bg-error-container text-on-error-container" : "bg-forest-light text-forest-dark"}`}>
            {notice.text}
          </div>
        )}

        {demo ? (
          <DemoLoginForm showAccounts={false} />
        ) : (
          // eslint-disable-next-line @next/next/no-html-link-for-pages -- route handler redirects to the identity provider
          <a href="/api/auth/login?returnTo=/app" className="w-full bg-primary text-on-primary py-3 rounded-lg font-label-lg text-label-lg flex items-center justify-center gap-2 hover:bg-forest-dark transition-all">
            <Icon name="login" size={18} /> Sign in with BEE identity
          </a>
        )}

        <div className="mt-space-md flex flex-wrap items-center justify-between gap-3 font-label-md text-label-md">
          <Link href="/contact?request=password-reset" className="text-primary hover:underline" data-testid="forgot-password-link">
            Forgot password?
          </Link>
          <Link href={REGISTRATION_HREF} className="text-primary hover:underline" data-testid="new-user-registration-link">
            New user registration
          </Link>
          {SOP_REGISTRATION_FLOW ? <Link href="/register/agency/pay" className="text-primary hover:underline" data-testid="pay-registration-fee-link">Pay Registration Fee</Link> : null}
        </div>
      </div>
    </section>
  );
}
