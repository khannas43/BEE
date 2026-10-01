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

/*
 * WP04.1 effective-dated masters (docs/wp04/WP04.1_MASTERS.md). Synthetic RAC examples for the
 * local slice: none is BEE-approved ("verified"). Periods are half-open [from, to); to = null
 * is open-ended. Seeded versions are immutable: to change a value, add a new version.
 */
const SHARED = ["rule_key", "version", "effective_from", "effective_to", "source_reference", "verification_status", "note", "legacy_id"];
const MASTERS = [
  { table: "master_category", columns: { name: "text" }, rows: [
    { rule_key: "RAC", version: 1, effective_from: "2026-01-01", effective_to: null, verification_status: "provisional", legacy_id: null,
      source_reference: "FIRST_SLICE.md §1 (slice category); BEE category list not yet consulted", note: "Local slice category only", name: "Room air conditioner" },
  ] },
  { table: "master_standard", columns: { category_code: "text", purpose: "text", standard_code: "text", title: "text", edition: "text" }, rows: [
    { rule_key: "RAC:performance_test", version: 1, effective_from: "2026-01-01", effective_to: "2026-07-01", verification_status: "synthetic", legacy_id: null,
      source_reference: "Synthetic local example; the applicable standard is BEE decision M2", note: "Stand-in code, not a real standard",
      category_code: "RAC", purpose: "performance_test", standard_code: "SYN-RAC-PERF", title: "Synthetic RAC performance test standard", edition: "synthetic-2025" },
    { rule_key: "RAC:performance_test", version: 2, effective_from: "2026-07-01", effective_to: null, verification_status: "synthetic", legacy_id: null,
      source_reference: "Synthetic local example; the applicable standard is BEE decision M2", note: "Stand-in code, not a real standard",
      category_code: "RAC", purpose: "performance_test", standard_code: "SYN-RAC-PERF", title: "Synthetic RAC performance test standard", edition: "synthetic-2026" },
  ] },
  { table: "master_lab_accreditation", columns: { laboratory_code: "text", category_code: "text", accreditation_body: "text", certificate_ref: "text", accreditation_status: "text" }, rows: [
    ...[[1, "2026-01-01", "2026-06-01", "active"], [2, "2026-06-01", "2026-07-01", "suspended"], [3, "2026-08-01", null, "active"]].map(([version, from, to, status]) => ({
      rule_key: "LAB:RAC", version, effective_from: from, effective_to: to, verification_status: "synthetic", legacy_id: null,
      source_reference: "Synthetic local example; no accreditation body was consulted", note: version === 3 ? "Re-accredited after a synthetic gap (2026-07-01 to 2026-08-01)" : "Synthetic accreditation history",
      laboratory_code: "LAB", category_code: "RAC", accreditation_body: "SYN-ACCREDITATION-BODY", certificate_ref: `SYN-LAB-RAC-000${version}`, accreditation_status: status })),
  ] },
  { table: "master_fee_rule", columns: { category_code: "text", application_type: "text", amount_inr: "numeric" }, rows: [
    { rule_key: "RAC:new_model", version: 1, effective_from: "2026-01-01", effective_to: "2026-10-01", verification_status: "synthetic", legacy_id: "RAC-DEMO",
      source_reference: "V2 local seed fee_rule RAC-DEMO (local placeholder; no source)", note: "Synthetic local amount only; BEE fee decision pending",
      category_code: "RAC", application_type: "new_model", amount_inr: "1000.00" },
    { rule_key: "RAC:new_model", version: 2, effective_from: "2026-10-01", effective_to: null, verification_status: "provisional", legacy_id: null,
      source_reference: "FIRST_SLICE.md provisional decision D6, citing DDD §5.3 (gap G08); not confirmed by BEE",
      note: "Provisional local amount from D6; supersedes the ₹1,000 placeholder for dates from 2026-10-01; BEE decision D6 pending",
      category_code: "RAC", application_type: "new_model", amount_inr: "24000.00" },
  ] },
  { table: "master_rating_formula", columns: { category_code: "text", formula_label: "text", inputs: "jsonb", definition: "jsonb", computation_allowed: "boolean" }, rows: [
    { rule_key: "RAC:star_rating", version: 1, effective_from: "2026-01-01", effective_to: null, verification_status: "synthetic", legacy_id: "RAC-STAR-DEMO",
      source_reference: "V2 local seed rating_formula RAC-STAR-DEMO (FIRST_SLICE.md D3 placeholder)", note: "Placeholder only; no official rating may be computed",
      category_code: "RAC", formula_label: "0-unverified", inputs: "[]", definition: "{}", computation_allowed: false },
  ] },
];
const SHARED_TYPES = { rule_key: "text", version: "integer", effective_from: "date", effective_to: "date", source_reference: "text", verification_status: "text", note: "text", legacy_id: "text" };
const lit = (v, type) => (v === null || v === undefined ? `NULL::${type}` : type === "integer" || type === "boolean" ? `${v}::${type}` : `${q(v)}::${type}`);
function masterSql(m) {
  const types = { ...SHARED_TYPES, ...m.columns };
  const cols = Object.keys(types);
  const values = m.rows.map((r) => `  (${cols.map((c) => lit(r[c], types[c])).join(", ")})`).join(",\n");
  const compared = cols.filter((c) => c !== "rule_key" && c !== "version");
  return [
    `INSERT INTO ${m.table} (${cols.join(", ")}) VALUES`,
    values,
    "ON CONFLICT (rule_key, version) DO NOTHING;",
    `DO $$ BEGIN IF EXISTS (SELECT 1 FROM (VALUES`,
    values,
    `) AS f (${cols.join(", ")}) JOIN ${m.table} m ON m.rule_key = f.rule_key AND m.version = f.version`,
    `  WHERE (${compared.map((c) => `m.${c}`).join(", ")}) IS DISTINCT FROM (${compared.map((c) => `f.${c}`).join(", ")})) THEN`,
    `  RAISE EXCEPTION '${m.table}: a stored version differs from the fixture; versions are immutable, add a new version instead'; END IF; END $$;`,
  ].join("\n");
}
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
S.push("-- WP04.1 effective-dated masters: synthetic or provisional, none BEE-approved; no official fee or star rating.");
S.push("-- Inserted once per (rule_key, version); a stored version that differs from the fixture fails the seed.");
for (const m of MASTERS) S.push(masterSql(m));
S.push("-- WP02.2 scope fixtures: seeded states only; version reset to 0 on every seed.");
S.push("INSERT INTO model_application (id, reference, organisation_id, brand_name, category, model_number, state, version) VALUES");
S.push(APPLICATIONS.map((a) => `  (${q(app(a.n))}, ${q(a.reference)}, ${q(ORGS.find((o) => o.code === a.org).id)}, ${q(a.brand)}, 'RAC', ${q(a.model)}, ${q(a.state)}, 0)`).join(",\n"));
S.push("ON CONFLICT (id) DO UPDATE SET reference = EXCLUDED.reference, organisation_id = EXCLUDED.organisation_id, brand_name = EXCLUDED.brand_name, model_number = EXCLUDED.model_number, state = EXCLUDED.state, version = 0;");
S.push("INSERT INTO assignment (user_id, subject_type, subject_id, stage, active) VALUES");
S.push(ASSIGNMENTS.map((a) => `  (${q(usr(a.user))}, 'model_application', ${q(app(a.app))}, ${q(a.stage)}, ${a.active})`).join(",\n"));
S.push("ON CONFLICT (user_id, subject_type, subject_id, stage) DO UPDATE SET active = EXCLUDED.active;");
S.push("INSERT INTO seed_run (seed_version) VALUES ('rt1-local-v2'), ('wp02.2-local-v1'), ('wp04.1-masters-v1') ON CONFLICT (seed_version) DO NOTHING;");
S.push("COMMIT;");
S.push("");

if (require.main === module) {
  const OUT = [
    [path.join(__dirname, `keycloak/import/${REALM}-realm.json`), JSON.stringify(realm, null, 2) + "\n"],
    [path.join(__dirname, "seed/seed.sql"), S.join("\n")],
  ];
  if (process.argv.includes("--counts")) {
    console.log(JSON.stringify({ organisations: ORGS.length, keycloakUsers: USERS.length, userAccounts: dbUsers.length, memberships: dbUsers.length, roleAssignments: dbUsers.length, activeRoleAssignments: dbUsers.filter((u) => u.db.active).length, masters: Object.fromEntries(MASTERS.map((m) => [m.table, m.rows.length])), modelApplications: APPLICATIONS.length, assignments: ASSIGNMENTS.length, activeAssignments: ASSIGNMENTS.filter((a) => a.active).length }));
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

module.exports = { ORGS, USERS, APPLICATIONS, ASSIGNMENTS, MASTERS, usr, org, app, REALM, DEV_PASSWORD };
