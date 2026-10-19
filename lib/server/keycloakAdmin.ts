import "server-only";
import { AUTH } from "./authConfig";

const TIMEOUT_MS = 5000;
const adminUser = process.env.BEE_KC_ADMIN_USER || "admin";
const adminPassword = process.env.BEE_KC_ADMIN_PASSWORD || "bee-local-admin";

function adminBase(): string {
  const issuer = AUTH.issuer;
  const origin = new URL(issuer).origin;
  const realm = issuer.split("/realms/")[1]?.split("/")[0] ?? "bee-local";
  return `${AUTH.reachable(origin)}/admin/realms/${realm}`;
}

async function adminToken(): Promise<string> {
  const tokenUrl = AUTH.reachable(`${new URL(AUTH.issuer).origin}/realms/master/protocol/openid-connect/token`);
  const res = await fetch(tokenUrl, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: adminUser, password: adminPassword }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!res.ok || !body.access_token) throw new Error("keycloak_admin_unavailable");
  return body.access_token;
}

export type GuestIdentity = { id: string };

export async function createGuestIdentity(input: {
  username: string;
  email: string;
  fullName: string;
  password: string;
}): Promise<{ ok: true; id: string } | { ok: false; conflict: boolean }> {
  const token = await adminToken();
  const names = input.fullName.trim().split(/\s+/);
  const firstName = names[0] ?? input.fullName;
  const lastName = names.slice(1).join(" ") || "Applicant";
  const res = await fetch(`${adminBase()}/users`, {
    method: "POST",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      username: input.username,
      email: input.email,
      enabled: true,
      emailVerified: true,
      firstName,
      lastName,
      requiredActions: [],
      credentials: [{ type: "password", value: input.password, temporary: false }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 409) return { ok: false, conflict: true };
  if (!res.ok) throw new Error("keycloak_admin_unavailable");
  const location = res.headers.get("Location") ?? "";
  const id = location.split("/").filter(Boolean).at(-1);
  if (!id) throw new Error("keycloak_admin_unavailable");
  // The portal resolves a caller only when the Keycloak realm role and the
  // BEE database role agree. Public manufacturer sign-up creates the database
  // assignment in the same flow, so give the new local demonstration identity
  // its matching realm role before returning it to the BFF.
  const roleResponse = await fetch(`${adminBase()}/roles/manufacturer`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const role = await roleResponse.json().catch(() => null);
  if (!roleResponse.ok || !role || typeof role !== "object") {
    await fetch(`${adminBase()}/users/${encodeURIComponent(id)}`, {
      method: "DELETE", cache: "no-store", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    throw new Error("keycloak_admin_unavailable");
  }
  const mapping = await fetch(`${adminBase()}/users/${encodeURIComponent(id)}/role-mappings/realm`, {
    method: "POST",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([role]),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!mapping.ok) {
    await fetch(`${adminBase()}/users/${encodeURIComponent(id)}`, {
      method: "DELETE", cache: "no-store", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    throw new Error("keycloak_admin_unavailable");
  }
  return { ok: true, id };
}

export async function deleteGuestIdentity(id: string): Promise<void> {
  try {
    const token = await adminToken();
    await fetch(`${adminBase()}/users/${encodeURIComponent(id)}`, {
      method: "DELETE",
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    /* best-effort rollback */
  }
}
