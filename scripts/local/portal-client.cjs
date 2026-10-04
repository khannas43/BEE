/* eslint-disable */
/**
 * Browser-like client for the local portal checks: per-host cookies, no redirect
 * following, every portal response recorded for leak scans, and real Keycloak TOTP
 * sign-in through the portal (scripts/local/totp.cjs).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const totp = require("./totp.cjs");

const env = (k, d) => process.env[k] || d;
const ROOT = path.join(__dirname, "../..");
const WEB = `http://127.0.0.1:${env("BEE_WEB_PORT", "3100")}`;
const API = `http://127.0.0.1:${env("BEE_API_PORT", "8090")}`;
const LOG_DIR = path.join(ROOT, ".local/logs");

class Jar {
  constructor() { this.c = new Map(); }
  header(url) { const h = new URL(url).hostname; return [...this.c].filter(([k]) => k.startsWith(h + "|")).map(([k, v]) => `${k.split("|")[1]}=${v}`).join("; "); }
  store(url, res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";").map((s) => s.trim());
      const i = pair.indexOf("="), key = `${new URL(url).hostname}|${pair.slice(0, i)}`, value = pair.slice(i + 1);
      if (!value || attrs.some((a) => /^max-age=0$/i.test(a))) this.c.delete(key); else this.c.set(key, value);
    }
  }
  has(name) { return [...this.c.keys()].some((k) => k.endsWith(`|${name}`)); }
  set(url, name, value) { this.c.set(`${new URL(url).hostname}|${name}`, value); }
}

/** Every portal response (status, URL, Location, headers, body) since the process started. */
const portalSeen = [];

async function call(url, { method = "GET", token, jar, correlationId, headers = {}, body } = {}) {
  const h = { Accept: "application/json", ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (correlationId !== undefined) h["X-Correlation-Id"] = correlationId;
  const cookie = jar?.header(url);
  if (cookie) h.Cookie = cookie;
  const res = await fetch(url, { method, headers: h, body, redirect: "manual", signal: AbortSignal.timeout(20000) });
  jar?.store(url, res);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const out = { status: res.status, headers: res.headers, text, body: text, json, location: res.headers.get("location"), sent: correlationId, setCookie: res.headers.getSetCookie() };
  if (url.startsWith(WEB)) portalSeen.push(`${res.status} ${url}\n${out.location || ""}\n${[...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n")}\n${text}`);
  return out;
}

const cid = (label) => `wp032-${label}-${crypto.randomBytes(4).toString("hex")}`;
const corr = (r) => r.headers.get("x-correlation-id");
const sameCorr = (r) => !!r?.sent && corr(r) === r.sent;
const noStore = (r) => /no-store/.test(r.headers.get("cache-control") || "");

/** Real portal sign-in: login route -> Keycloak password + TOTP -> callback. */
async function portalSignIn(u, jar = new Jar()) {
  const r1 = await call(`${WEB}/api/auth/login?returnTo=/app`, { jar, correlationId: cid("login") });
  const first = await call(r1.location, { jar });
  const done = await totp.completeLogin((url, init = {}) => call(url, { ...init, jar }), first, u);
  const cb = done.location?.startsWith(`${WEB}/api/auth/callback`) ? await call(done.location, { jar, correlationId: cid("callback") }) : null;
  return { jar, login: r1, cb, final: cb?.location ? new URL(cb.location, WEB) : null };
}

const logSize = (f) => { try { return fs.statSync(path.join(LOG_DIR, f)).size; } catch { return 0; } };
const logSince = (f, from = 0) => { try { return fs.readFileSync(path.join(LOG_DIR, f)).subarray(from).toString("utf8"); } catch { return ""; } };
/** Runs a scripts/local/lib.sh function (start_api, stop_api). */
const runtime = (fn) => execFileSync("bash", ["-c", `source "${ROOT}/scripts/local/lib.sh"; ${fn}`], { stdio: ["ignore", "pipe", "pipe"], timeout: 180000 }).toString();

module.exports = { WEB, API, ROOT, LOG_DIR, Jar, call, cid, corr, sameCorr, noStore, portalSignIn, portalSeen, logSize, logSince, runtime };
