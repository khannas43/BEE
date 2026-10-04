/**
 * Screens backed by the real BEE service rather than prototype fixtures. Their menu
 * entries come from the Spring-reported identity (/api/runtime/me), not the development
 * preview role, and the preview display filter does not apply to them. Showing a link
 * grants nothing: Spring, through the Next.js BFF, decides every record the screen shows.
 */
export interface RuntimeRoute {
  href: string;
  en: string;
  hi: string;
  icon: string;
  /** Spring roles (from /api/runtime/me) that get the menu entry. A navigation hint only. */
  navRoles: readonly string[];
  /** What the screen actually does today, shown instead of preview access chips. */
  implemented: readonly string[];
}

export const RUNTIME_ROUTES: readonly RuntimeRoute[] = [
  {
    href: "/app/model-label/model-dashboard",
    en: "My model applications",
    hi: "मेरे मॉडल आवेदन",
    icon: "view_list",
    navRoles: ["manufacturer", "agency"],
    implemented: ["List", "View detail", "Edit draft", "Submit draft"],
  },
  {
    href: "/app/model-label/new-model-application",
    en: "New model application",
    hi: "नया मॉडल आवेदन",
    icon: "note_add",
    navRoles: ["manufacturer", "agency"],
    implemented: ["Create draft", "Edit draft", "Upload test reports", "Submit draft"],
  },
  {
    href: "/app/finance/finance-queue",
    en: "Finance queue",
    hi: "वित्त कतार",
    icon: "payments",
    navRoles: ["finance"],
    implemented: ["List fee-due applications", "View fee and evidence", "Confirm fee received"],
  },
  {
    href: "/app/model-label/iame-scrutiny",
    en: "IAME scrutiny",
    hi: "आईएएमई जाँच",
    icon: "fact_check",
    navRoles: ["iame"],
    implemented: ["List assigned applications", "View evidence and test reports", "Record finding and forward"],
  },
  {
    href: "/app/model-label/bee-scrutiny",
    en: "BEE scrutiny",
    hi: "बीईई जाँच",
    icon: "rule",
    navRoles: ["reviewer"],
    implemented: ["List assigned applications", "View evidence and test reports", "Forward to rating"],
  },
  {
    href: "/app/model-label/rating-calculation",
    en: "Rating calculation",
    hi: "रेटिंग गणना",
    icon: "star",
    navRoles: ["programme"],
    implemented: ["List applications awaiting a rating", "View evidence and test reports", "Compute and record a provisional local rating"],
  },
];

export function runtimeRouteFor(pathname: string): RuntimeRoute | undefined {
  return RUNTIME_ROUTES.find((r) => r.href === pathname);
}

/** Menu entries for a Spring identity; empty for no identity or no matching role. */
export function runtimeNavFor(roles: readonly { role: string }[] | null | undefined): RuntimeRoute[] {
  if (!roles?.length) return [];
  return RUNTIME_ROUTES.filter((r) => roles.some((g) => r.navRoles.includes(g.role)));
}
