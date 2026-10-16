"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";

/** The demonstration people (docs/demo/DEMO_WORK_PLAN.md). Picking one fills the username only. */
export const DEMO_ACCOUNTS: readonly { username: string; role: string }[] = [
  { username: "nova.applicant", role: "Manufacturer (Nova)" },
  { username: "pixel.applicant", role: "Agency (Pixel)" },
  { username: "bee.finance", role: "Finance" },
  { username: "iame.officer", role: "IAME officer" },
  { username: "bee.reviewer", role: "Reviewer" },
  { username: "bee.programme", role: "Programme" },
  { username: "bee.director", role: "Director" },
  { username: "bee.secretary", role: "Secretary" },
  { username: "bee.admin", role: "Administrator" },
  { username: "bee.auditor", role: "Auditor" },
  { username: "bee.helpdesk", role: "Helpdesk" },
];

export const DEMO_LOGIN_ERRORS: Record<string, string> = {
  invalid_credentials: "The username or password is not correct.",
  no_active_account: "Your identity was confirmed, but there is no active BEE portal account for it.",
  no_effective_role: "Your identity was confirmed, but you have no active BEE role that matches your sign-in.",
  identity_unavailable: "The sign-in service is not reachable. Try again.",
  api_unreachable: "The BEE service is not reachable, so access could not be checked.",
  service_unavailable: "The BEE service is temporarily unavailable. Try again.",
  rate_limited: "Too many sign-in attempts. Wait a minute and try again.",
};

/** Username and password only (the demonstration sign-in, BEE_DEMO_LOGIN). Success goes to the returned address. */
export function DemoLoginForm({ onSignedIn = (to: string) => window.location.assign(to) }: { onSignedIn?: (returnTo: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/runtime/demo/login", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; returnTo?: string; error?: string };
      if (res.ok && body.ok) {
        onSignedIn(typeof body.returnTo === "string" && body.returnTo.startsWith("/") ? body.returnTo : "/app");
        return;
      }
      setError(DEMO_LOGIN_ERRORS[body.error ?? ""] ?? (res.status >= 500 ? DEMO_LOGIN_ERRORS.identity_unavailable : "Sign-in failed. Please try again."));
      setPassword("");
      requestAnimationFrame(() => errorRef.current?.focus());
    } catch {
      setError(DEMO_LOGIN_ERRORS.identity_unavailable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate data-testid="demo-login-form">
      {error && (
        <div ref={errorRef} tabIndex={-1} role="alert" data-testid="demo-login-error" className="mb-space-md rounded-lg px-3 py-2 font-body-sm text-body-sm bg-error-container text-on-error-container outline-none">
          {error}
        </div>
      )}
      <label htmlFor="demo-username" className="font-label-md text-label-md text-on-surface block mb-1">Username</label>
      <div className="relative mb-space-md">
        <Icon name="person" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        <input
          id="demo-username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="for example bee.director"
          className="w-full pl-10 pr-3 py-3 rounded-lg bg-surface-ground border border-border-subtle font-body-md text-body-md outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
        />
      </div>
      <label htmlFor="demo-password" className="font-label-md text-label-md text-on-surface block mb-1">Password</label>
      <div className="relative mb-space-lg">
        <Icon name="lock" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        <input
          id="demo-password"
          ref={passwordRef}
          name="password"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full pl-10 pr-12 py-3 rounded-lg bg-surface-ground border border-border-subtle font-body-md text-body-md outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-pressed={show}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-on-surface-variant hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <Icon name={show ? "visibility_off" : "visibility"} size={18} />
        </button>
      </div>
      <button
        type="submit"
        disabled={busy || !username.trim() || !password}
        className="w-full bg-primary text-on-primary py-3 rounded-lg font-label-lg text-label-lg flex items-center justify-center gap-2 hover:bg-forest-dark transition-all disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2"
      >
        <Icon name={busy ? "progress_activity" : "login"} size={18} className={busy ? "animate-spin" : ""} /> {busy ? "Signing in…" : "Sign in"}
      </button>

      <div className="mt-space-lg pt-space-md border-t border-border-subtle">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="demo-accounts"
          className="flex items-center gap-1 font-label-md text-label-md text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
        >
          <Icon name={open ? "expand_less" : "expand_more"} size={18} /> Demo accounts
        </button>
        {open && (
          <div id="demo-accounts" className="mt-space-sm">
            <p className="font-body-sm text-body-sm text-on-surface-variant mb-space-sm">
              Password for every demo account: <span className="font-mono font-semibold text-on-surface">demo123</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.username}
                  type="button"
                  onClick={() => {
                    setUsername(a.username);
                    passwordRef.current?.focus();
                  }}
                  title={a.role}
                  className="px-2.5 py-1 rounded-full border border-border-subtle bg-surface-ground hover:border-primary hover:text-primary font-label-sm text-label-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  {a.username}
                  <span className="sr-only"> ({a.role})</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
