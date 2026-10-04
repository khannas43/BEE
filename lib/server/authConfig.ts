import "server-only";

/**
 * Server-only identity settings. Defaults match local/local.env; `local:up`
 * exports the real values. The client secret never reaches the browser.
 */
const env = (name: string, fallback: string) => process.env[name] || fallback;

const kcPort = env("BEE_KC_PORT", "8180");
const webPort = env("BEE_WEB_PORT", "3100");
const realm = env("BEE_REALM", "bee-local");

const clientSecret = process.env.BEE_WEB_CLIENT_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "bee-local-web-secret");

const issuer = `http://127.0.0.1:${kcPort}/realms/${realm}`;
const publicBase = new URL(issuer).origin;
/** Where this server can reach Keycloak when that is not the public address (a container: "http://keycloak:8080"). */
const internalBase = (process.env.BEE_KC_INTERNAL_URL ?? "").replace(/\/+$/, "");

export const AUTH = {
  issuer,
  /** Maps a Keycloak URL from its public address to the one this server can call. The browser keeps the public one. */
  reachable(url: string): string {
    return internalBase && url.startsWith(publicBase) ? internalBase + url.slice(publicBase.length) : url;
  },
  webOrigin: env("BEE_WEB_ORIGIN", `http://127.0.0.1:${webPort}`),
  clientId: env("BEE_WEB_CLIENT_ID", "bee-web"),
  clientSecret,
  get redirectUri() {
    return `${this.webOrigin}/api/auth/callback`;
  },
  /** Cookie holding only a random session id; tokens stay in the server store. */
  sessionCookie: "bee_session",
  loginCookie: "bee_login",
  loginTtlSeconds: 600,
  /** Hard upper bound on a server session, whatever Keycloak allows. */
  sessionMaxSeconds: Number(env("BEE_SESSION_MAX_SECONDS", String(8 * 3600))),
  /** Refresh the access token when it has less than this left. */
  refreshLeewaySeconds: 15,
  /** Cookies are Secure whenever the portal is served over HTTPS. */
  get secureCookies() {
    return this.webOrigin.startsWith("https://");
  },
};
