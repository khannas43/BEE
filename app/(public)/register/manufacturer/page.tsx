"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState, type InputHTMLAttributes } from "react";
import { Icon } from "@/components/ui/Icon";

export default function RegisterManufacturerPage() {
  const router = useRouter();
  const [legalName, setLegalName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detailsValid = useMemo(() => legalName.trim().length > 0
    && fullName.trim().length > 0
    && email.trim().length > 0
    && mobile.trim().length > 0
    && username.trim().length > 0
    && password.length > 0
    && password === confirmPassword,
  [confirmPassword, email, fullName, legalName, mobile, password, username]);

  async function createAccountAndContinue(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!detailsValid) {
      setError("Complete all registration fields and ensure the passwords match.");
      return;
    }
    setBusy(true);
    try {
      const idempotencyKey = crypto.randomUUID().replace(/-/g, "") + "0";
      const response = await fetch("/api/runtime/public/manufacturer-signup", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ legalName: legalName.trim(), fullName: fullName.trim(), email: email.trim(), mobile: mobile.trim(), username: username.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-"), password }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; returnTo?: string; error?: string };
      if (!response.ok || !body.ok) {
        if (body.error === "registration_not_available") {
          throw new Error("registration_not_available");
        }
        throw new Error("registration_session_failed");
      }
      router.push(typeof body.returnTo === "string" ? body.returnTo : "/app/manufacturer/onboarding");
    } catch (err) {
      setError(err instanceof Error && err.message === "registration_not_available"
        ? "This registration could not be completed. Sign in if you already have an account, or try different details."
        : "The applicant account could not be started. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="w-full bg-surface-ground py-space-md lg:py-space-lg">
      <div className="w-full max-w-7xl mx-auto px-gutter">
        <div className="w-full rounded-2xl bg-surface-card border border-border-subtle shadow-sm p-space-md lg:p-space-lg space-y-space-md">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-3 py-1 font-label-sm mb-space-sm">
              <Icon name="factory" size={17} /> Manufacturer registration
            </div>
            <h1 className="font-headline-md text-headline-md font-bold" data-testid="register-manufacturer-title">Create applicant account</h1>
            <p className="font-body-sm text-on-surface-variant mt-1">
              Verify your email and mobile number, then continue to the manufacturer/company registration application.
            </p>
            <p className="font-body-sm text-on-surface-variant mt-1">
              Already registered?{" "}
              <Link href="/login?returnTo=/app/manufacturer/onboarding" className="font-label-md text-primary hover:underline" data-testid="existing-applicant-sign-in">
                Sign in
              </Link>
            </p>
          </div>

          {error && <div role="alert" className="rounded-lg bg-error-container text-on-error-container px-3 py-2 font-body-sm" data-testid="registration-error">{error}</div>}

          <form onSubmit={createAccountAndContinue} noValidate className="space-y-space-md" data-testid="manufacturer-account-form">
              <div className="grid sm:grid-cols-2 gap-space-md">
                <Field id="manufacturer-legal-name" label="Manufacturer / company legal name" icon="corporate_fare" value={legalName} onChange={setLegalName} autoComplete="organization" />
                <Field id="manufacturer-full-name" label="Applicant full name" icon="person" value={fullName} onChange={setFullName} autoComplete="name" />
              </div>
              <div className="grid sm:grid-cols-2 gap-space-md">
                <Field id="manufacturer-email" label="Email address" icon="mail" value={email} onChange={setEmail} type="email" autoComplete="email" />
                <Field id="manufacturer-mobile" label="Mobile number" icon="phone" value={mobile} onChange={(value) => {
                  const digits = value.replace(/\D/g, "");
                  setMobile(digits.length > 10 && digits.startsWith("91") ? digits.slice(2, 12) : digits.slice(0, 10));
                }} type="tel" autoComplete="tel" placeholder="10-digit Indian mobile number" />
              </div>

              <div className="grid sm:grid-cols-3 gap-space-md">
                <Field id="manufacturer-username" label="Username" icon="badge" value={username} onChange={setUsername} autoComplete="username" placeholder="Choose a username" />
                <PasswordField id="manufacturer-password" label="Create password" value={password} onChange={setPassword} show={showPassword} toggle={() => setShowPassword((value) => !value)} />
                <PasswordField id="manufacturer-confirm-password" label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} show={showPassword} toggle={() => setShowPassword((value) => !value)} />
              </div>

              <button type="submit" disabled={busy} className="w-full rounded-lg bg-primary text-on-primary py-2.5 px-space-md font-label-lg text-label-lg inline-flex justify-center items-center gap-2 disabled:opacity-50" data-testid="create-demo-applicant">
                <Icon name={busy ? "progress_activity" : "how_to_reg"} size={18} className={busy ? "animate-spin" : ""} />
                {busy ? "Creating applicant account…" : "Create applicant account and continue"}
              </button>
            </form>
        </div>
      </div>
    </section>
  );
}

function Field({ id, label, icon, value, onChange, type = "text", ...input }: {
  id: string;
  label: string;
  icon: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange" | "type">) {
  return (
    <label htmlFor={id} className="block">
      <span className="font-label-sm text-label-sm block mb-1">{label}</span>
      <span className="relative block">
        <Icon name={icon} size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        <input {...input} id={id} data-testid={id} aria-label={label} type={type} required value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-border-subtle bg-surface-ground py-2.5 pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </span>
    </label>
  );
}

function PasswordField({ id, label, value, onChange, show, toggle }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  toggle: () => void;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="font-label-sm text-label-sm block mb-1">{label}</span>
      <span className="relative block">
        <Icon name="lock" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        <input id={id} data-testid={id} aria-label={label} type={show ? "text" : "password"} required minLength={8} autoComplete="new-password" value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-border-subtle bg-surface-ground py-2.5 pl-10 pr-11 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        <button type="button" onClick={toggle} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-on-surface-variant hover:text-primary">
          <Icon name={show ? "visibility_off" : "visibility"} size={18} />
        </button>
      </span>
    </label>
  );
}
