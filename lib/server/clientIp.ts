import "server-only";

/** The address a request came from, as the portal server sees it (the first of X-Forwarded-For, else X-Real-IP). Only for the sign-in trail; not a security control. */
export function clientIpOf(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = headers.get("x-real-ip")?.trim();
  const ip = forwarded || real || "";
  return /^[0-9A-Za-z:.%\-]{1,64}$/.test(ip) ? ip : "local (this laptop)";
}
