"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { PREVIEW_SUFFIX, previewRoleOf, useRole } from "./RoleContext";
import { useLang } from "@/components/i18n/LangProvider";
import { canRoleAccessPath, categoriesForRole } from "@/lib/categories";
import { isExternalRole } from "@/lib/roles";

/**
 * Client route guard for the development preview — the same screen filter as the
 * sidebar, applied to the route. It is a prototype convenience, not access control:
 * the BEE service (Spring) decides access. Default deny: a role that is not granted the category a
 * path belongs to sees a refusal, not the page. (Hiding the link is not
 * enough; this also blocks direct-URL access within the app.) External
 * partner roles get a scoped-view banner.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { role } = useRole();
  const { t } = useLang();
  const pathname = usePathname();
  const allowed = canRoleAccessPath(role, pathname);
  const external = isExternalRole(role);
  const home = categoriesForRole(role)[0]?.items[0]?.href ?? "/app";

  if (!allowed) {
    return (
      <div className="p-space-md lg:p-space-lg">
        <div className="max-w-lg mx-auto mt-space-2xl bg-surface-card rounded-xl shadow-sm p-space-lg text-center">
          <span className="w-14 h-14 rounded-full bg-error-container text-on-error-container inline-flex items-center justify-center mb-space-sm"><Icon name="lock" size={28} fill /></span>
          <h1 className="font-headline-sm text-headline-sm text-on-surface">Not in this preview</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">
            The <span data-preview-role className="font-semibold text-on-surface">{t(`role.${role}`)}{PREVIEW_SUFFIX}</span> preview does not include this area.
          </p>
          <p className="font-mono text-label-sm text-on-surface-variant mt-space-sm break-all bg-surface-container-low rounded-lg p-space-sm">{pathname}</p>
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-sm">This is a prototype screen filter, not an access decision; the BEE service decides access. Choose another preview role from the top bar to see this area.</p>
          <Link href={home} className="inline-flex items-center gap-1.5 mt-space-md bg-primary text-on-primary font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg hover:bg-forest-dark">
            <Icon name="arrow_back" size={16} /> Back to the preview workspace
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {external && (
        <div className="mx-space-md lg:mx-space-lg mt-space-md flex items-start gap-space-sm bg-solar-gold-light/50 border border-solar-gold/40 rounded-xl p-space-sm" role="note">
          <Icon name="visibility" size={18} className="text-solar-gold-dark shrink-0 mt-0.5" />
          <p className="font-body-sm text-body-sm text-on-surface">
            <span data-preview-role className="font-semibold">{previewRoleOf(role).name} view.</span> This preview shows only one organisation&apos;s records and assigned cases, not other parties, BEE approvals or finance ledgers. Scoping is simulated here with sample data.
          </p>
        </div>
      )}
      {children}
    </>
  );
}
