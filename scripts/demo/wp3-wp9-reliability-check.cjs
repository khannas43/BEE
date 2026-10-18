#!/usr/bin/env node
/* eslint-disable */
/**
 * WP3–WP9 demo rehearsal: seeded references and key routes.
 *   npm run demo:wp3-wp9-check
 * Needs Postgres (npm run local:app:up or local:up). Web/API checks are skipped when down.
 */
const { execFileSync } = require("child_process");

const env = (k, d) => process.env[k] || d;
const WEB = `http://127.0.0.1:${env("BEE_WEB_PORT", "3100")}`;
const API = `http://127.0.0.1:${env("BEE_API_PORT", "8090")}`;

let pass = 0;
let fail = 0;
let skip = 0;

function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(42)} ${detail}`);
}

function skipCheck(id, detail) {
  skip++;
  console.log(`${"SKIP".padEnd(4)} ${id.padEnd(42)} ${detail}`);
}

function psql(q) {
  const pw = env("BEE_APP_DB_PASSWORD", "bee-local-app");
  const user = env("BEE_APP_DB_USER", "bee_app");
  const port = env("BEE_PG_PORT", "5434");
  return execFileSync(
    "docker",
    ["exec", "-i", "-e", `PGPASSWORD=${pw}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", user, "-d", env("BEE_APP_DB", "bee_app"), "-v", "ON_ERROR_STOP=1", "-qtA", "-c", q],
    { encoding: "utf8" },
  ).trim();
}

function postgresUp() {
  try {
    execFileSync("docker", ["exec", "bee-local-postgres", "pg_isready", "-q", "-U", "bee_super", "-d", "postgres"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function fetchStatus(url) {
  const res = await fetch(url, { redirect: "manual" });
  const body = res.status < 400 ? await res.text() : "";
  return { status: res.status, body };
}

function routeOk(status) {
  return status === 200 || status === 307 || status === 308;
}

(async () => {
  if (!postgresUp()) {
    console.error("ERROR: bee-local-postgres is not running (npm run local:app:up)");
    process.exit(1);
  }

  const cert = psql("SELECT count(*) FROM certificate WHERE registration_id = 'BEE/RAC/2026/10101'");
  check("seed.certificate-10101", cert === "1", `count=${cert}`);

  const model = psql("SELECT count(*) FROM model_application WHERE reference = 'DEMO-MA-0101' AND state = 'approved'");
  check("seed.nova-model-demo-ma-0101", model === "1", `count=${model}`);

  const reg = psql("SELECT count(*) FROM registration_application WHERE reference = 'REG-2026-9001' AND state = 'approved'");
  check("seed.registration-reg-2026-9001", reg === "1", `count=${reg}`);

  const brand = psql("SELECT count(*) FROM brand b JOIN organisation o ON o.id = b.owner_organisation_id WHERE o.code = 'NOVA' AND b.name = 'Nova Cool'");
  check("seed.nova-cool-brand", brand === "1", `count=${brand}`);

  const pay = psql("SELECT count(*) FROM model_application WHERE reference LIKE 'DEMO-PAY-%'");
  check("seed.demo-pay-applications", Number(pay) >= 5, `count=${pay}`);

  const qr = psql("SELECT count(*) FROM qr_batch qb JOIN certificate c ON c.id = qb.certificate_id WHERE c.registration_id = 'BEE/RAC/2026/10101'");
  check("seed.qr-batch-for-10101", Number(qr) >= 1, `count=${qr}`);

  const prod = psql("SELECT count(*) FROM production_submission WHERE organisation_id = '00000000-0000-4000-b000-000000000001' AND quarter = '2026-Q3'");
  check("seed.nova-production-2026-q3", prod === "1", `count=${prod}`);

  const rev = psql("SELECT count(*) FROM register_revocation_proposal WHERE state = 'pending'");
  check("seed.register-revocation-pending", Number(rev) >= 1, `count=${rev}`);

  const payRowsBefore = psql("SELECT count(*) FROM payment");
  const certBefore = psql("SELECT count(*) FROM certificate WHERE registration_id = 'BEE/RAC/2026/10101'");

  try {
    execFileSync("bash", [`${process.cwd()}/scripts/demo/seed-demo.sh`], { stdio: "pipe" });
    const payRowsAfter = psql("SELECT count(*) FROM payment");
    const certAfter = psql("SELECT count(*) FROM certificate WHERE registration_id = 'BEE/RAC/2026/10101'");
    check("seed.idempotent-second-run", payRowsBefore === payRowsAfter && certBefore === certAfter, `payment ${payRowsBefore}->${payRowsAfter}, cert ${certBefore}->${certAfter}`);
  } catch (e) {
    check("seed.idempotent-second-run", false, String(e.message || e).slice(0, 120));
  }

  let webUp = false;
  try {
    const h = await fetchStatus(`${WEB}/api/runtime/health`);
    webUp = h.status === 200 && (h.body.includes('"api":"UP"') || h.body.includes("UP"));
  } catch {
    webUp = false;
  }

  if (webUp) {
    for (const [id, path] of [
      ["route.login", "/login"],
      ["route.verify", "/verify"],
      ["route.registrations", "/app/registrations"],
      ["route.payments-demo", "/app/demo/payments"],
      ["route.qr-demo", "/app/demo/qr"],
      ["route.production-demo", "/app/demo/production"],
      ["route.mis-demo", "/app/demo/mis"],
      ["route.register", "/app/register"],
    ]) {
      const r = await fetchStatus(`${WEB}${path}`);
      check(id, routeOk(r.status), `HTTP ${r.status}`);
    }
    const v = await fetchStatus(`${WEB}/api/runtime/verification?reg=${encodeURIComponent("BEE/RAC/2026/10101")}`);
    const valid = v.status === 200 && (v.body.includes('"status":"valid"') || v.body.includes('"valid"'));
    check("route.verification-10101", valid, `HTTP ${v.status}`);
  } else {
    skipCheck("route.*", "web/API not up — start with npm run local:up for route checks");
  }

  let apiUp = false;
  try {
    const a = await fetchStatus(`${API}/actuator/health`);
    apiUp = a.status === 200;
  } catch {
    apiUp = false;
  }
  if (apiUp) {
    check("route.spring-health", apiUp, "actuator UP");
  } else {
    skipCheck("route.spring-health", "Spring API not reachable");
  }

  console.log(`\nTotals: ${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exit(fail ? 1 : 0);
})();
