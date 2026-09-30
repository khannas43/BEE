// Unit tests for lib/server/oidc.ts (WP02.1). Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { authorizeUrl, IdTokenError, pkceChallenge, safeReturnTo, verifyIdToken } from "../../lib/server/oidc.ts";

const ISSUER = "http://127.0.0.1:8180/realms/bee-local";
const CLIENT = "bee-web";
const NOW = 1_800_000_000;

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function token(claims = {}, { header = {}, key = privateKey } = {}) {
  const h = b64({ alg: "RS256", typ: "JWT", kid: "k1", ...header });
  const p = b64({ iss: ISSUER, aud: CLIENT, azp: CLIENT, sub: "00000000-0000-4000-a000-000000000001", iat: NOW - 5, exp: NOW + 300, nonce: "n-1", ...claims });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key).toString("base64url")}`;
}
const expect = { issuer: ISSUER, clientId: CLIENT, nonce: "n-1", jwks: [jwk], nowSeconds: NOW };
const rejects = (t, reason, e = expect) =>
  assert.throws(() => verifyIdToken(t, e), (err) => err instanceof IdTokenError && err.reason === reason);

test("accepts a valid ID token", () => {
  assert.equal(verifyIdToken(token(), expect).sub, "00000000-0000-4000-a000-000000000001");
});
test("rejects a nonce mismatch (replayed or injected token)", () => rejects(token({ nonce: "other" }), "nonce mismatch"));
test("rejects a missing nonce", () => rejects(token({ nonce: undefined }), "nonce mismatch"));
test("rejects another issuer", () => rejects(token({ iss: "http://127.0.0.1:8180/realms/master" }), "issuer mismatch"));
test("rejects a token for another client", () => rejects(token({ aud: "bee-local-check", azp: "bee-local-check" }), "audience mismatch"));
test("rejects a multi-audience token whose azp is not this client", () => rejects(token({ aud: [CLIENT, "x"], azp: "x" }), "authorised party mismatch"));
test("rejects an expired token", () => rejects(token({ exp: NOW - 60 }), "expired"));
test("rejects a token issued in the future", () => rejects(token({ iat: NOW + 120 }), "issued in the future"));
test("rejects a signature from another key", () => rejects(token({}, { key: other.privateKey }), "bad signature"));
test("rejects a tampered payload", () => {
  const [h, , s] = token().split(".");
  rejects(`${h}.${b64({ iss: ISSUER, aud: CLIENT, sub: "admin", iat: NOW, exp: NOW + 300, nonce: "n-1" })}.${s}`, "bad signature");
});
test("rejects alg none", () => {
  const [, p] = token().split(".");
  rejects(`${b64({ alg: "none", kid: "k1" })}.${p}.`, "unsupported alg none");
});
test("rejects an unknown key id", () => rejects(token({}, { header: { kid: "k2" } }), "unknown signing key"));
test("rejects malformed input", () => rejects("not-a-jwt", "malformed"));

test("PKCE S256 matches RFC 7636 appendix B", () => {
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});
test("authorize URL carries state, nonce and an S256 challenge, never the verifier", () => {
  const u = new URL(authorizeUrl({ authorizationEndpoint: `${ISSUER}/protocol/openid-connect/auth`, clientId: CLIENT, redirectUri: "http://127.0.0.1:3100/api/auth/callback", state: "s", nonce: "n", codeChallenge: "c" }));
  assert.deepEqual(Object.fromEntries(u.searchParams), { response_type: "code", client_id: CLIENT, redirect_uri: "http://127.0.0.1:3100/api/auth/callback", scope: "openid", state: "s", nonce: "n", code_challenge: "c", code_challenge_method: "S256" });
});
test("returnTo accepts only same-origin paths", () => {
  assert.equal(safeReturnTo("/app/workflow"), "/app/workflow");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, "/app\n"]) assert.equal(safeReturnTo(bad), "/app");
});
