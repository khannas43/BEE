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

export const AUTH = {
  issuer: `http://127.0.0.1:${kcPort}/realms/${realm}`,
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
