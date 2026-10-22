import "server-only";

import type { NextRequest } from "next/server";

const loopback = (hostname: string) => {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
};

/** Host header or URL host (with optional port) compared for logout Origin checks. */
export function portalHostsMatch(requestHost: string, configuredHost: string): boolean {
  const norm = (raw: string) => {
    const url = raw.includes("://") ? new URL(raw) : new URL(`http://${raw}`);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return { hostname: url.hostname.toLowerCase(), port };
  };
  const a = norm(requestHost);
  const b = norm(configuredHost);
  if (a.port !== b.port) return false;
  if (a.hostname === b.hostname) return true;
  return loopback(a.hostname) && loopback(b.hostname);
}

function originsEquivalent(origin: string, configuredOrigin: string): boolean {
  try {
    const o = new URL(origin);
    const c = new URL(configuredOrigin);
    if (o.origin === c.origin) return true;
    if (o.protocol !== c.protocol || o.port !== c.port) return false;
    return loopback(o.hostname) && loopback(c.hostname);
  } catch {
    return false;
  }
}

/**
 * Logout POST must not be callable from another site or port on loopback. Accept the
 * configured portal origin, localhost/127.0.0.1 aliases on the same port, and
 * same-origin form posts that omit Origin but send Host + Sec-Fetch-Site.
 */
export function logoutRequestFromPortal(request: NextRequest, configuredOrigin: string): boolean {
  const origin = request.headers.get("origin");
  if (origin) return originsEquivalent(origin, configuredOrigin);

  const configured = new URL(configuredOrigin);
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "same-origin") {
    const host = request.headers.get("host");
    return Boolean(host && portalHostsMatch(host, configured.host));
  }

  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return originsEquivalent(new URL(referer).origin, configuredOrigin);
  } catch {
    return false;
  }
}
