"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState, type InputHTMLAttributes } from "react";
import { Icon } from "@/components/ui/Icon";

export default function RegisterManufacturerPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detailsValid = useMemo(() => fullName.trim().length >= 2
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    && /^[6-9]\d{9}$/.test(mobile.trim())
    && password.length >= 8
    && password === confirmPassword,
  [confirmPassword, email, fullName, mobile, password]);

  async function createAccountAndContinue(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!detailsValid) {
      setError("Enter a valid name, email, 10-digit Indian mobile number and matching password of at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/runtime/demo/login", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "onboarding.applicant", password: "demo123" }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean };
      if (!response.ok || !body.ok) throw new Error("registration_session_failed");
      router.push("/app/manufacturer/onboarding");
    } catch {
      setError("The applicant account could not be started. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-surface-ground py-space-lg lg:py-space-xl">
      <div className="max-w-2xl mx-auto px-space-md lg:px-space-lg">
        <div className="rounded-2xl bg-surface-card border border-border-subtle shadow-sm p-space-md sm:p-space-xl space-y-space-lg">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-3 py-1 font-label-sm mb-space-sm">
              <Icon name="factory" size={17} /> Manufacturer registration
            </div>
            <h1 className="font-display-md text-display-md font-bold" data-testid="register-manufacturer-title">Create applicant account</h1>
            <p className="font-body-md text-on-surface-variant mt-2">
              Verify your email and mobile number, then continue to the manufacturer/company registration application.
            </p>
            <p className="font-body-sm text-on-surface-variant mt-2">
              Already registered?{" "}
              <Link href="/login?returnTo=/app/manufacturer/onboarding" className="font-label-md text-primary hover:underline" data-testid="existing-applicant-sign-in">
                Sign in
              </Link>
            </p>
          </div>

          {error && <div role="alert" className="rounded-lg bg-error-container text-on-error-container px-3 py-2 font-body-sm" data-testid="registration-error">{error}</div>}

          <form onSubmit={createAccountAndContinue} noValidate className="space-y-space-md" data-testid="manufacturer-account-form">
              <Field id="manufacturer-full-name" label="Applicant full name" icon="person" value={fullName} onChange={setFullName} autoComplete="name" />
              <Field id="manufacturer-email" label="Email address" icon="mail" value={email} onChange={setEmail} type="email" autoComplete="email" />
              <Field id="manufacturer-mobile" label="Mobile number" icon="phone" value={mobile} onChange={(value) => setMobile(value.replace(/\D/g, "").slice(0, 10))} type="tel" autoComplete="tel" placeholder="10-digit Indian mobile number" />

              <div className="grid sm:grid-cols-2 gap-space-md">
                <PasswordField id="manufacturer-password" label="Create password" value={password} onChange={setPassword} show={showPassword} toggle={() => setShowPassword((value) => !value)} />
                <PasswordField id="manufacturer-confirm-password" label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} show={showPassword} toggle={() => setShowPassword((value) => !value)} />
              </div>

              <div className="rounded-xl border border-primary/25 bg-primary/5 p-space-md" data-testid="demo-verification-process">
                <p className="font-label-md text-on-surface">Identity verification process</p>
                <p className="font-body-sm text-on-surface-variant mt-1">
                  Email and mobile OTP verification are part of the standard registration process. For this demonstration, both checks are simulated automatically because no SMS or email gateway is connected.
                </p>
                <div className="grid sm:grid-cols-2 gap-2 mt-3">
                  <div className="rounded-lg bg-surface-card border border-border-subtle p-3 flex items-center gap-2">
                    <Icon name="mark_email_read" size={20} className="text-primary" />
                    <span className="font-body-sm"><strong>Email OTP</strong><br />Simulated verification</span>
                  </div>
                  <div className="rounded-lg bg-surface-card border border-border-subtle p-3 flex items-center gap-2">
                    <Icon name="sms" size={20} className="text-primary" />
                    <span className="font-body-sm"><strong>Mobile OTP</strong><br />Simulated verification</span>
                  </div>
                </div>
              </div>

              <button type="submit" disabled={busy} className="w-full rounded-lg bg-primary text-on-primary py-3 px-space-md font-semibold inline-flex justify-center items-center gap-2 disabled:opacity-50" data-testid="create-demo-applicant">
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
      <span className="font-label-md block mb-1">{label}</span>
      <span className="relative block">
        <Icon name={icon} size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        <input {...input} id={id} aria-label={label} type={type} required value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-border-subtle bg-surface-ground py-3 pl-10 pr-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
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
      <span className="font-label-md block mb-1">{label}</span>
      <span className="relative block">
        <Icon name="lock" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        <input id={id} aria-label={label} type={show ? "text" : "password"} required minLength={8} autoComplete="new-password" value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-border-subtle bg-surface-ground py-3 pl-10 pr-11 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        <button type="button" onClick={toggle} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-on-surface-variant hover:text-primary">
          <Icon name={show ? "visibility_off" : "visibility"} size={18} />
        </button>
      </span>
    </label>
  );
}
