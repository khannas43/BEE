/* eslint-disable */
/**
 * Generates the two synthetic local fixtures from one list so they cannot drift:
 *   local/keycloak/import/bee-local-realm.json  (who the user is: Keycloak)
 *   local/seed/seed.sql                   (what the user may do: Spring database)
 * Run: node local/generate-fixtures.cjs [--check | --counts]
 */
const fs = require("fs");
const path = require("path");

const DEV_PASSWORD = "bee-local-dev";
const REALM = "bee-local";
const WEB_PORT = 3100;
const ROLES = ["admin", "programme", "reviewer", "director", "secretary", "finance", "helpdesk", "auditor", "manufacturer", "agency", "iame", "sda", "laboratory"];

const org = (n) => `00000000-0000-4000-b000-${String(n).padStart(12, "0")}`;
const usr = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

const ORGS = [
  { id: org(1), code: "NOVA", kind: "manufacturer", name: "Nova Cool Appliances Pvt Ltd (synthetic)" },
  { id: org(2), code: "PIXEL", kind: "agency", name: "PixelCert Agency (synthetic)" },
  { id: org(3), code: "BEE", kind: "bee", name: "Bureau of Energy Efficiency (local)" },
  { id: org(4), code: "IAME", kind: "iame", name: "IAME Local Panel (synthetic)" },
  { id: org(5), code: "SDA", kind: "sda", name: "State Designated Agency (synthetic)" },
  { id: org(6), code: "LAB", kind: "laboratory", name: "Synthetic Test Laboratory" },
];

/**
 * kc: realm role in the token. db: Spring role assignment (null = no account).
 * The last three users exist to prove that Keycloak alone never grants access.
 */
const USERS = [
  { n: 1, username: "nova.applicant", first: "Nova", last: "Applicant", kc: "manufacturer", org: "NOVA", db: { role: "manufacturer", scope: "own-org", active: true } },
  { n: 2, username: "pixel.applicant", first: "Pixel", last: "Applicant", kc: "agency", org: "PIXEL", db: { role: "agency", scope: "own-org", active: true } },
  { n: 3, username: "bee.finance", first: "BEE", last: "Finance", kc: "finance", org: "BEE", db: { role: "finance", scope: "all", active: true } },
  { n: 4, username: "iame.officer", first: "IAME", last: "Officer", kc: "iame", org: "IAME", db: { role: "iame", scope: "assigned", active: true } },
  { n: 5, username: "bee.reviewer", first: "BEE", last: "Reviewer", kc: "reviewer", org: "BEE", db: { role: "reviewer", scope: "all", active: true } },
  { n: 6, username: "bee.programme", first: "BEE", last: "Programme", kc: "programme", org: "BEE", db: { role: "programme", scope: "all", active: true } },
  { n: 7, username: "bee.director", first: "BEE", last: "Director", kc: "director", org: "BEE", db: { role: "director", scope: "all", active: true } },
  { n: 8, username: "bee.secretary", first: "BEE", last: "Secretary", kc: "secretary", org: "BEE", db: { role: "secretary", scope: "all", active: true } },
  { n: 9, username: "bee.admin", first: "BEE", last: "Admin", kc: "admin", org: "BEE", db: { role: "admin", scope: "all", active: true } },
  { n: 10, username: "bee.helpdesk", first: "BEE", last: "Helpdesk", kc: "helpdesk", org: "BEE", db: { role: "helpdesk", scope: "all", active: true } },
  { n: 11, username: "bee.auditor", first: "BEE", last: "Auditor", kc: "auditor", org: "BEE", db: { role: "auditor", scope: "all", active: true } },
  { n: 12, username: "sda.officer", first: "SDA", last: "Officer", kc: "sda", org: "SDA", db: { role: "sda", scope: "assigned", active: true } },
  { n: 13, username: "lab.officer", first: "Lab", last: "Officer", kc: "laboratory", org: "LAB", db: { role: "laboratory", scope: "assigned", active: true } },
  { n: 14, username: "no.account", first: "No", last: "Account", kc: "manufacturer", org: null, db: null },
  { n: 15, username: "inactive.role", first: "Inactive", last: "Role", kc: "reviewer", org: "BEE", db: { role: "reviewer", scope: "all", active: false } },
  { n: 16, username: "role.mismatch", first: "Role", last: "Mismatch", kc: "finance", org: "BEE", db: { role: "auditor", scope: "all", active: true } },
];

const audience = { name: "bee-api-audience", protocol: "openid-connect", protocolMapper: "oidc-audience-mapper", consentRequired: false, config: { "included.custom.audience": "bee-api", "access.token.claim": "true", "id.token.claim": "false" } };

const realm = {
  realm: REALM,
  enabled: true,
  sslRequired: "none",
  registrationAllowed: false,
  loginWithEmailAllowed: false,
  verifyEmail: false,
  accessTokenLifespan: 300,
  roles: { realm: ROLES.map((r) => ({ name: r, description: `BEE persona: ${r}` })) },
  clients: [
    {
      clientId: "bee-web",
      name: "BEE portal (Next.js server, authorization code + PKCE)",
      enabled: true,
      publicClient: false,
      secret: "bee-local-web-secret",
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: [`http://127.0.0.1:${WEB_PORT}/*`],
      webOrigins: [`http://127.0.0.1:${WEB_PORT}`],
      attributes: { "pkce.code.challenge.method": "S256" },
      protocolMappers: [audience],
    },
    {
      clientId: "bee-local-check",
      name: "Local checks only (password grant; not used by the portal)",
      description: "Adds a deliberately misleading organisation claim so checks can prove Spring ignores token attributes for access.",
      enabled: true,
      publicClient: true,
      standardFlowEnabled: false,
      directAccessGrantsEnabled: true,
      protocolMappers: [
        audience,
        { name: "misleading-organisation-claim", protocol: "openid-connect", protocolMapper: "oidc-hardcoded-claim-mapper", consentRequired: false, config: { "claim.name": "organisation", "claim.value": "PixelCert Agency (synthetic)", "jsonType.label": "String", "access.token.claim": "true", "id.token.claim": "false", "userinfo.token.claim": "false" } },
      ],
    },
  ],
  users: USERS.map((u) => ({
    id: usr(u.n),
    username: u.username,
    email: `${u.username}@bee.local.invalid`,
    emailVerified: true,
    firstName: u.first,
    lastName: u.last,
    enabled: true,
    requiredActions: [],
    credentials: [{ type: "password", value: DEV_PASSWORD, temporary: false }],
    realmRoles: [u.kc],
  })),
};

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const S = [];
S.push("-- Generated by local/generate-fixtures.cjs. Synthetic local data only. Idempotent.");
S.push("BEGIN;");
S.push("INSERT INTO organisation (id, code, kind, legal_name) VALUES");
S.push(ORGS.map((o) => `  (${q(o.id)}, ${q(o.code)}, ${q(o.kind)}, ${q(o.name)})`).join(",\n"));
S.push("ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, kind = EXCLUDED.kind, legal_name = EXCLUDED.legal_name, status = 'active';");
const dbUsers = USERS.filter((u) => u.db);
S.push("INSERT INTO user_account (id, keycloak_subject, username, display_name) VALUES");
S.push(dbUsers.map((u) => `  (${q(usr(u.n))}, ${q(usr(u.n))}, ${q(u.username)}, ${q(`${u.first} ${u.last}`)})`).join(",\n"));
S.push("ON CONFLICT (id) DO UPDATE SET keycloak_subject = EXCLUDED.keycloak_subject, username = EXCLUDED.username, display_name = EXCLUDED.display_name, status = 'active';");
S.push("INSERT INTO organisation_membership (user_id, organisation_id) VALUES");
S.push(dbUsers.map((u) => `  (${q(usr(u.n))}, ${q(ORGS.find((o) => o.code === u.org).id)})`).join(",\n"));
S.push("ON CONFLICT (user_id, organisation_id) DO UPDATE SET active = true;");
S.push("INSERT INTO role_assignment (user_id, role, scope, active) VALUES");
S.push(dbUsers.map((u) => `  (${q(usr(u.n))}, ${q(u.db.role)}, ${q(u.db.scope)}, ${u.db.active})`).join(",\n"));
S.push("ON CONFLICT (user_id, role) DO UPDATE SET scope = EXCLUDED.scope, active = EXCLUDED.active;");
S.push("-- Synthetic local-only fee; this is not a BEE-approved amount.");
S.push("INSERT INTO fee_rule (id, category, version, amount_inr, status, note) VALUES ('RAC-DEMO', 'RAC', '0-unverified', 1000.00, 'unverified', 'Synthetic local amount only; BEE fee decision pending') ON CONFLICT (id) DO UPDATE SET amount_inr = EXCLUDED.amount_inr, status = EXCLUDED.status, note = EXCLUDED.note;");
S.push("-- Metadata only: no approved star-rating expression or computation is claimed.");
S.push("INSERT INTO rating_formula (id, category, version, status, definition, note) VALUES ('RAC-STAR-DEMO', 'RAC', '0-unverified', 'unverified', '{}'::jsonb, 'Placeholder only; no official rating may be computed') ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, definition = EXCLUDED.definition, note = EXCLUDED.note;");
S.push("INSERT INTO seed_run (seed_version) VALUES ('rt1-local-v2') ON CONFLICT (seed_version) DO NOTHING;");
S.push("COMMIT;");
S.push("");

const OUT = [
  [path.join(__dirname, `keycloak/import/${REALM}-realm.json`), JSON.stringify(realm, null, 2) + "\n"],
  [path.join(__dirname, "seed/seed.sql"), S.join("\n")],
];
if (process.argv.includes("--counts")) {
  console.log(JSON.stringify({ organisations: ORGS.length, keycloakUsers: USERS.length, userAccounts: dbUsers.length, memberships: dbUsers.length, roleAssignments: dbUsers.length, activeRoleAssignments: dbUsers.filter((u) => u.db.active).length, feeRules: 1, ratingFormulas: 1 }));
  process.exit(0);
}
const CHECK = process.argv.includes("--check");
let stale = 0;
OUT.forEach(([file, text]) => {
  if (CHECK) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) { console.log(`stale: ${path.relative(process.cwd(), file)}`); stale++; }
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
});
if (CHECK && stale) process.exit(1);
if (!CHECK) console.log(`wrote ${OUT.length} fixture files (${ORGS.length} organisations, ${USERS.length} Keycloak users, ${dbUsers.length} Spring accounts)`);

module.exports = { ORGS, USERS, usr, org, REALM, DEV_PASSWORD };
