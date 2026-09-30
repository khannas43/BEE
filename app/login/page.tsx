"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Emblem } from "@/components/chrome/Emblem";
import { ROLES, RoleKey } from "@/lib/roles";
import { countForRole } from "@/lib/screens";
import { persistRole, ROLE_PREVIEW_ENABLED } from "@/components/app/RoleContext";

const SIGN_IN_ERRORS: Record<string, string> = {
  no_active_account: "Your identity was confirmed, but there is no active BEE portal account for it.",
  no_effective_role: "Your identity was confirmed, but you have no active BEE role that matches your sign-in.",
  access_denied: "Sign-in was cancelled or refused.",
  login_expired: "The sign-in attempt expired or was already used. Please start again.",
  invalid_state: "The sign-in response did not match this browser's request. Please start again.",
  invalid_issuer: "The sign-in response came from an unexpected identity provider.",
  invalid_id_token: "The identity token could not be verified.",
  code_exchange_failed: "The sign-in could not be completed with the identity provider.",
  identity_unavailable: "The identity service is not reachable.",
  api_unreachable: "The BEE service is not reachable, so access could not be checked.",
};

const noSubscribe = () => () => {};

function noticeFor(q: URLSearchParams): { kind: "error" | "info"; text: string } | null {
  const error = q.get("error");
  if (error) return { kind: "error", text: SIGN_IN_ERRORS[error] ?? "Sign-in failed. Please try again." };
  if (q.get("signedOut")) return { kind: "info", text: "You have signed out." };
  return null;
}

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<RoleKey>("admin");
  const search = useSyncExternalStore(noSubscribe, () => window.location.search, () => "");
  const notice = noticeFor(new URLSearchParams(search));

  /** Preview only: sets a local display role. No identity check and no server session. */
  function openPreview() {
    persistRole(role);
    router.push("/app");
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Brand panel */}
      <div className="hidden lg:flex flex-col justify-between bg-forest-dark text-on-primary p-space-2xl relative overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-[#FF9933] via-white to-primary absolute top-0 inset-x-0" />
        <Link href="/" className="flex items-center gap-space-md relative z-10">
          <Emblem size={52} invert />
          <div>
            <div className="font-headline-md text-headline-md">Bureau of Energy Efficiency</div>
            <div className="font-label-sm text-label-sm text-forest-light/80">Standards & Labelling Portal</div>
          </div>
        </Link>
        <div className="relative z-10">
          <h1 className="font-display-lg text-display-lg font-bold leading-tight">Secure stakeholder & officer access</h1>
          <p className="font-body-lg text-body-lg text-forest-light/85 mt-space-md max-w-md">
            Registration, model & label lifecycle, fees, production, enforcement, MIS and audit — governed by role, delegation and workflow state.
          </p>
          <div className="flex items-center gap-space-md mt-space-xl">
            {[
              { icon: "shield_lock", t: "MFA enforced" },
              { icon: "verified_user", t: "RBAC + object policy" },
              { icon: "history_edu", t: "Every action audited" },
            ].map((f) => (
              <div key={f.t} className="flex items-center gap-1.5 font-label-md text-label-md text-forest-light/90">
                <Icon name={f.icon} size={18} /> {f.t}
              </div>
            ))}
          </div>
        </div>
        <div className="font-label-sm text-label-sm text-forest-light/60 relative z-10">© {new Date().getFullYear()} BEE, Ministry of Power, Government of India</div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-space-lg bg-surface-ground">
        <div className="w-full max-w-md bg-surface-card rounded-xl shadow-md p-space-xl">
          <Link href="/" className="lg:hidden flex items-center gap-space-sm mb-space-lg">
            <Emblem size={40} />
            <span className="font-headline-sm text-headline-sm text-primary">BEE S&L Portal</span>
          </Link>

          <h2 className="font-headline-md text-headline-md text-on-surface">Sign in</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 mb-space-lg">
            You sign in with the BEE identity service (Keycloak). Your roles and organisation come from the BEE portal&apos;s own records.
          </p>
          {notice && (
            <div role={notice.kind === "error" ? "alert" : "status"} className={`mb-space-md rounded-lg px-3 py-2 font-body-sm text-body-sm ${notice.kind === "error" ? "bg-error-container text-on-error-container" : "bg-forest-light text-forest-dark"}`}>
              {notice.text}
            </div>
          )}
          <a
            href="/api/auth/login?returnTo=/app"
            className="w-full bg-primary text-on-primary py-2.5 rounded-lg font-label-lg text-label-lg flex items-center justify-center gap-2 hover:bg-forest-dark transition-all"
          >
            <Icon name="login" size={18} /> Sign in with BEE identity
          </a>

          {ROLE_PREVIEW_ENABLED && (
            <div className="mt-space-lg pt-space-md border-t border-border-subtle">
              <p className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide mb-1">Development preview only</p>
              <p className="font-body-sm text-body-sm text-on-surface-variant mb-space-md">
                Explore the prototype screens as a chosen role. This does not sign you in, checks no credentials and creates no server session.
              </p>
              <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">Preview as role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as RoleKey)}
                className="w-full py-2.5 px-3 rounded-lg bg-surface-ground font-body-md text-body-md outline-none mb-1"
              >
                {ROLES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name} — {countForRole(r.key)} screens
                  </option>
                ))}
              </select>
              <p className="font-label-sm text-label-sm text-on-surface-variant mb-space-lg">
                Role controls which of the 140 screens appear, per DDD Annex A.1.
              </p>
              <button
                onClick={openPreview}
                className="w-full border border-primary text-primary py-2.5 rounded-lg font-label-lg text-label-lg flex items-center justify-center gap-2 hover:bg-forest-light transition-all"
                type="button"
              >
                <Icon name="visibility" size={18} /> Open preview
              </button>
            </div>
          )}

          <div className="mt-space-lg pt-space-md border-t border-border-subtle text-center">
            <Link href="/" className="font-label-sm text-label-sm text-on-surface-variant hover:text-primary">← Back to public portal</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
