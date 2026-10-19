/** Demo-only: the seeded demo account for each role, used by the header role dropdown in demo sign-in mode. Password is the one shown on the login page. */
export const DEMO_ACCOUNT_FOR_ROLE: Record<string, string> = {
  admin: "bee.admin",
  programme: "bee.programme",
  reviewer: "bee.reviewer",
  officer: "bee.officer",
  director: "bee.director",
  finance: "bee.finance",
  helpdesk: "bee.helpdesk",
  auditor: "bee.auditor",
  manufacturer: "nova.applicant",
  agency: "pixel.applicant",
  iame: "iame.officer",
  sda: "sda.officer",
  laboratory: "lab.officer",
};
export const DEMO_PASSWORD = "demo123";

/** Signs in as the demo account for a role and returns the landing path, or null when it did not work. */
export async function switchDemoRole(role: string): Promise<string | null> {
  const username = DEMO_ACCOUNT_FOR_ROLE[role];
  if (!username) return null;
  try {
    const r = await fetch("/api/runtime/demo/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: DEMO_PASSWORD }),
    });
    if (!r.ok) return null;
    const b = await r.json();
    return typeof b.returnTo === "string" ? b.returnTo : "/app";
  } catch {
    return null;
  }
}
