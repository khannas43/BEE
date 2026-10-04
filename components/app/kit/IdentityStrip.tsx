"use client";

import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/app/ScreenScaffold";
import { type IdentityState, orgsText, rolesText } from "@/components/app/SessionBadge";

/**
 * Who the portal thinks you are, as Spring reports it (roles and organisation from the BEE database). The development
 * preview role is not an identity and grants nothing; say so on every runtime screen.
 */
export function IdentityStrip({ identity, testId }: { identity: IdentityState; testId: string }) {
  return (
    <Card>
      <div className="flex items-start gap-space-sm" data-testid={testId}>
        <Icon name="badge" size={20} className="text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">Signed-in identity (BEE records)</div>
          {identity.status === "loading" ? (
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">Checking your sign-in…</p>
          ) : identity.status === "signed-out" ? (
            <p className="font-body-sm text-body-sm text-on-surface mt-1">No signed-in BEE identity with an active role.</p>
          ) : (
            <p className="font-body-sm text-body-sm text-on-surface mt-1">
              <span className="font-semibold">{identity.me.displayName}</span>
              {" · "}
              {rolesText(identity.me)}
              {orgsText(identity.me) ? ` · ${orgsText(identity.me)}` : ""}
            </p>
          )}
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
            The development preview role above is not your identity and does not grant access to these records.
          </p>
        </div>
      </div>
    </Card>
  );
}
