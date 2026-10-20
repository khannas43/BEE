"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { useSpringIdentity } from "./SessionBadge";
import { canOpenConsolePath } from "@/lib/navigation";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";

/**
 * Client route guard for the prototype console screens. It follows the signed-in Spring identity, never the
 * browser preview role: a screen opens only if the person's role menu, or the per-role screen policy for one
 * of their Spring roles, includes it (lib/navigation). It is a prototype convenience, not access control; the
 * BEE service decides access.
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

  return (
    <>
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
