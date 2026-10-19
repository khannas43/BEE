"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { useSpringIdentity } from "./SessionBadge";
import { canOpenConsolePath, navProfileFor } from "@/lib/navigation";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";

/**
 * Client route guard for the prototype console screens. It follows the signed-in Spring identity, never the
 * browser preview role: a screen opens only if the person's role menu, or the per-role screen policy for one
 * of their Spring roles, includes it (lib/navigation). It is a prototype convenience, not access control; the
 * BEE service decides access. External partners get a scoped-view banner.
 *
 * Runtime routes (lib/runtimeRoutes.ts) are exempt: they show real BEE records that Spring scopes to the
 * signed-in identity and refuse on their own.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const identity = useSpringIdentity();

  if (runtimeRouteFor(pathname)) return <>{children}</>;

  if (identity.status === "loading") {
    return <div className="p-space-md lg:p-space-lg font-body-md text-body-md text-on-surface-variant" data-testid="route-guard-loading" aria-busy="true">Checking your sign-in…</div>;
  }

  if (identity.status === "signed-out") {
    return (
      <Refusal icon="login" title="Sign in to continue" testId="route-guard-signed-out" pathname={pathname}>
        <Link href={`/api/auth/login?returnTo=${encodeURIComponent(pathname)}`} className="inline-flex items-center gap-1.5 mt-space-md bg-primary text-on-primary font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg hover:bg-forest-dark">
          <Icon name="login" size={16} /> Sign in
        </Link>
      </Refusal>
    );
  }

  const { effectiveRoles, capabilities = [] } = identity.me;
  if (!canOpenConsolePath(effectiveRoles, capabilities, pathname)) {
    return (
      <Refusal icon="lock" title="Not in your menu" testId="route-guard-refused" pathname={pathname}>
        <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-sm">Your role menu does not include this screen. The menu follows your sign-in; changing the preview role does not change it.</p>
        <Link href="/app" className="inline-flex items-center gap-1.5 mt-space-md bg-primary text-on-primary font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg hover:bg-forest-dark">
          <Icon name="arrow_back" size={16} /> Back to your dashboard
        </Link>
      </Refusal>
    );
  }

  const external = navProfileFor(effectiveRoles.map((g) => g.role)) === "manufacturer";
  return (
    <>
      {pathname !== "/app" && pathname !== "/app/screens" && (
        <p className="mx-space-md lg:mx-space-lg mt-space-md inline-flex items-center gap-1.5 rounded-full bg-surface-container-low px-space-sm py-1 font-label-sm text-label-sm text-on-surface-variant" data-testid="preview-screen-note">
          <Icon name="science" size={14} /> Preview screen: sample data, not yet connected to the BEE service.
        </p>
      )}
      {external && (
        <div className="mx-space-md lg:mx-space-lg mt-space-md flex items-start gap-space-sm bg-solar-gold-light/50 border border-solar-gold/40 rounded-xl p-space-sm" role="note">
          <Icon name="visibility" size={18} className="text-solar-gold-dark shrink-0 mt-0.5" />
          <p className="font-body-sm text-body-sm text-on-surface">
            <span className="font-semibold">Organisation view.</span> This preview shows only one organisation&apos;s records and assigned cases, not other parties, BEE approvals or finance ledgers. Scoping is simulated here with sample data.
          </p>
        </div>
      )}
      {children}
    </>
  );
}

function Refusal({ icon, title, testId, pathname, children }: { icon: string; title: string; testId: string; pathname: string; children: React.ReactNode }) {
  return (
    <div className="p-space-md lg:p-space-lg" data-testid={testId}>
      <div className="max-w-lg mx-auto mt-space-2xl bg-surface-card rounded-xl shadow-sm p-space-lg text-center">
        <span className="w-14 h-14 rounded-full bg-error-container text-on-error-container inline-flex items-center justify-center mb-space-sm"><Icon name={icon} size={28} fill /></span>
        <h1 className="font-headline-sm text-headline-sm text-on-surface">{title}</h1>
        <p className="font-mono text-label-sm text-on-surface-variant mt-space-sm break-all bg-surface-container-low rounded-lg p-space-sm">{pathname}</p>
        {children}
      </div>
    </div>
  );
}
