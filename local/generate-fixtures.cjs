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
const app = (n) => `00000000-0000-4000-c000-${String(n).padStart(12, "0")}`;

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
  { n: 5, username: "bee.reviewer", first: "BEE", last: "Reviewer", kc: "reviewer", org: "BEE", db: { role: "reviewer", scope: "assigned", active: true } },
  { n: 6, username: "bee.programme", first: "BEE", last: "Programme", kc: "programme", org: "BEE", db: { role: "programme", scope: "all", active: true } },
  { n: 7, username: "bee.director", first: "BEE", last: "Director", kc: "director", org: "BEE", db: { role: "director", scope: "all", active: true } },
  { n: 8, username: "bee.secretary", first: "BEE", last: "Secretary", kc: "secretary", org: "BEE", db: { role: "secretary", scope: "all", active: true } },
  { n: 9, username: "bee.admin", first: "BEE", last: "Admin", kc: "admin", org: "BEE", db: { role: "admin", scope: "all", active: true } },
  { n: 10, username: "bee.helpdesk", first: "BEE", last: "Helpdesk", kc: "helpdesk", org: "BEE", db: { role: "helpdesk", scope: "all", active: true } },
  { n: 11, username: "bee.auditor", first: "BEE", last: "Auditor", kc: "auditor", org: "BEE", db: { role: "auditor", scope: "all", active: true } },
  { n: 12, username: "sda.officer", first: "SDA", last: "Officer", kc: "sda", org: "SDA", db: { role: "sda", scope: "assigned", active: true } },
  { n: 13, username: "lab.officer", first: "Lab", last: "Officer", kc: "laboratory", org: "LAB", db: { role: "laboratory", scope: "assigned", active: true } },
  { n: 14, username: "no.account", first: "No", last: "Account", kc: "manufacturer", org: null, db: null },
  { n: 15, username: "inactive.role", first: "Inactive", last: "Role", kc: "reviewer", org: "BEE", db: { role: "reviewer", scope: "assigned", active: false } },
  { n: 16, username: "role.mismatch", first: "Role", last: "Mismatch", kc: "finance", org: "BEE", db: { role: "auditor", scope: "all", active: true } },
];

/**
 * WP02.2 scope fixtures: seeded states, not transitions (no workflow is implemented).
 * Nova owns three, PixelCert one. Only IAME holds an active assignment; the
 * Reviewer's assignment on LOCAL-MA-0004 is inactive, so the Reviewer sees nothing.
 */
const APPLICATIONS = [
  { n: 1, reference: "LOCAL-MA-0001", org: "NOVA", brand: "Nova Cool", model: "NC-RAC-12D", state: "draft" },
  { n: 2, reference: "LOCAL-MA-0002", org: "NOVA", brand: "Nova Cool", model: "NC-RAC-18F", state: "fee_due" },
  { n: 3, reference: "LOCAL-MA-0003", org: "PIXEL", brand: "Aurora Air (synthetic principal)", model: "AU-RAC-15X", state: "iame_scrutiny" },
  { n: 4, reference: "LOCAL-MA-0004", org: "NOVA", brand: "Nova Cool", model: "NC-RAC-24H", state: "bee_scrutiny" },
];
const ASSIGNMENTS = [
  { user: 4, app: 3, stage: "iame_scrutiny", active: true },
  { user: 5, app: 4, stage: "bee_scrutiny", active: false },
];

const audience = { name: "bee-api-audience", protocol: "openid-connect", protocolMapper: "oidc-audience-mapper", consentRequired: false, config: { "included.custom.audience": "bee-api", "access.token.claim": "true", "id.token.claim": "false" } };

const misleadingOrg = (value) => ({ name: "misleading-organisation-claim", protocol: "openid-connect", protocolMapper: "oidc-hardcoded-claim-mapper", consentRequired: false, config: { "claim.name": "organisation", "claim.value": value, "jsonType.label": "String", "access.token.claim": "true", "id.token.claim": "false", "userinfo.token.claim": "false" } });
const WEB_ACCESS_TOKEN_SECONDS = 60;

/**
 * WP02.3 MFA policy: TOTP is REQUIRED for every user in both the browser flow and the
 * direct-grant flow used by local checks. No role or client is exempt. A user without
 * an OTP credential must enroll (CONFIGURE_TOTP) before Keycloak issues a code; codes
 * are single-use. The AMR mapper records "pwd" and "otp" so the portal can verify them.
 */
const amr = { name: "authentication-method-reference", protocol: "openid-connect", protocolMapper: "oidc-amr-mapper", consentRequired: false, config: { "id.token.claim": "true", "access.token.claim": "true", "introspection.token.claim": "true" } };
const OTP_POLICY = { otpPolicyType: "totp", otpPolicyAlgorithm: "HmacSHA1", otpPolicyDigits: 6, otpPolicyPeriod: 30, otpPolicyLookAheadWindow: 1, otpPolicyCodeReusable: false };
const step = (authenticator, priority, authenticatorConfig) => ({ authenticator, authenticatorFlow: false, requirement: "REQUIRED", priority, userSetupAllowed: false, ...(authenticatorConfig ? { authenticatorConfig } : {}) });
const AUTH_FLOWS = [
  {
    alias: "bee browser with otp", description: "Cookie, or username/password then OTP (required). No conditional bypass.", providerId: "basic-flow", topLevel: true, builtIn: false,
    authenticationExecutions: [
      { authenticator: "auth-cookie", authenticatorFlow: false, requirement: "ALTERNATIVE", priority: 10, userSetupAllowed: false },
      { authenticatorFlow: true, requirement: "ALTERNATIVE", priority: 20, flowAlias: "bee browser otp forms", userSetupAllowed: false },
    ],
  },
  {
    alias: "bee browser otp forms", description: "Password, then OTP; enrollment is forced when no OTP credential exists.", providerId: "basic-flow", topLevel: false, builtIn: false,
    authenticationExecutions: [step("auth-username-password-form", 10, "bee-amr-pwd"), step("auth-otp-form", 20, "bee-amr-otp")],
  },
  {
    alias: "bee direct grant with otp", description: "Local check client only: username, password and OTP all required.", providerId: "basic-flow", topLevel: true, builtIn: false,
    authenticationExecutions: [step("direct-grant-validate-username", 10), step("direct-grant-validate-password", 20, "bee-amr-pwd-grant"), step("direct-grant-validate-otp", 30, "bee-amr-otp-grant")],
  },
];
const amrRef = (alias, value) => ({ alias, config: { "default.reference.value": value, "default.reference.maxAge": "36000" } });
const AUTH_CONFIG = [amrRef("bee-amr-pwd", "pwd"), amrRef("bee-amr-otp", "otp"), amrRef("bee-amr-pwd-grant", "pwd"), amrRef("bee-amr-otp-grant", "otp")];

const realm = {
  realm: REALM,
  enabled: true,
  sslRequired: "none",
  registrationAllowed: false,
  loginWithEmailAllowed: false,
  verifyEmail: false,
  accessTokenLifespan: 300,
  ...OTP_POLICY,
  browserFlow: "bee browser with otp",
  directGrantFlow: "bee direct grant with otp",
  authenticationFlows: AUTH_FLOWS,
  authenticatorConfig: AUTH_CONFIG,
  roles: { realm: ROLES.map((r) => ({ name: r, description: `BEE persona: ${r}` })) },
  clients: [
    {
      clientId: "bee-web",
      name: "BEE portal (Next.js server, authorization code + PKCE)",
      description: "Short access tokens so local checks exercise refresh. The organisation claim is wrong for every user on purpose: Spring must ignore it.",
      enabled: true,
      publicClient: false,
      secret: "bee-local-web-secret",
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: [`http://127.0.0.1:${WEB_PORT}/api/auth/callback`],
      webOrigins: [],
      attributes: { "pkce.code.challenge.method": "S256", "access.token.lifespan": String(WEB_ACCESS_TOKEN_SECONDS), "post.logout.redirect.uris": `http://127.0.0.1:${WEB_PORT}/login` },
      protocolMappers: [audience, amr, misleadingOrg("Bureau of Energy Efficiency (local)")],
    },
    {
      clientId: "bee-local-check",
      name: "Local checks only (password grant; not used by the portal)",
      description: "Adds a deliberately misleading organisation claim so checks can prove Spring ignores token attributes for access.",
      enabled: true,
      publicClient: true,
      standardFlowEnabled: false,
      directAccessGrantsEnabled: true,
      protocolMappers: [audience, amr, misleadingOrg("PixelCert Agency (synthetic)")],
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
    requiredActions: ["CONFIGURE_TOTP"],
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
S.push("-- WP02.2 scope fixtures: seeded states only; version reset to 0 on every seed.");
S.push("INSERT INTO model_application (id, reference, organisation_id, brand_name, category, model_number, state, version) VALUES");
S.push(APPLICATIONS.map((a) => `  (${q(app(a.n))}, ${q(a.reference)}, ${q(ORGS.find((o) => o.code === a.org).id)}, ${q(a.brand)}, 'RAC', ${q(a.model)}, ${q(a.state)}, 0)`).join(",\n"));
S.push("ON CONFLICT (id) DO UPDATE SET reference = EXCLUDED.reference, organisation_id = EXCLUDED.organisation_id, brand_name = EXCLUDED.brand_name, model_number = EXCLUDED.model_number, state = EXCLUDED.state, version = 0;");
S.push("INSERT INTO assignment (user_id, subject_type, subject_id, stage, active) VALUES");
S.push(ASSIGNMENTS.map((a) => `  (${q(usr(a.user))}, 'model_application', ${q(app(a.app))}, ${q(a.stage)}, ${a.active})`).join(",\n"));
S.push("ON CONFLICT (user_id, subject_type, subject_id, stage) DO UPDATE SET active = EXCLUDED.active;");
S.push("INSERT INTO seed_run (seed_version) VALUES ('rt1-local-v2'), ('wp02.2-local-v1') ON CONFLICT (seed_version) DO NOTHING;");
S.push("COMMIT;");
S.push("");

if (require.main === module) {
  const OUT = [
    [path.join(__dirname, `keycloak/import/${REALM}-realm.json`), JSON.stringify(realm, null, 2) + "\n"],
    [path.join(__dirname, "seed/seed.sql"), S.join("\n")],
  ];
  if (process.argv.includes("--counts")) {
    console.log(JSON.stringify({ organisations: ORGS.length, keycloakUsers: USERS.length, userAccounts: dbUsers.length, memberships: dbUsers.length, roleAssignments: dbUsers.length, activeRoleAssignments: dbUsers.filter((u) => u.db.active).length, feeRules: 1, ratingFormulas: 1, modelApplications: APPLICATIONS.length, assignments: ASSIGNMENTS.length, activeAssignments: ASSIGNMENTS.filter((a) => a.active).length }));
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
}

module.exports = { ORGS, USERS, APPLICATIONS, ASSIGNMENTS, usr, org, app, REALM, DEV_PASSWORD };
