#!/usr/bin/env node
// npm run demo:scan-gateway — lets a phone on the same Wi-Fi scan a label's QR code and read the result.
// The portal itself keeps listening on this laptop only (127.0.0.1). This small gateway listens on the local network and answers ONE thing:
// the public label check at /verify?reg=<serial or registration id>. It asks the portal for the public verification record and draws a
// small phone-friendly page itself, so no portal page, script, sign-in or record is reachable from the network.
// Stop it with Ctrl-C. Port: BEE_SCAN_PORT (default 3101). Portal: BEE_WEB_PORT (default 3100).
import http from "node:http";
import os from "node:os";

const PORT = Number(process.env.BEE_SCAN_PORT ?? 3101);
const TARGET_PORT = Number(process.env.BEE_WEB_PORT ?? 3100);

function lanAddress() {
  const nets = os.networkInterfaces();
  const names = Object.keys(nets).sort((a, b) => (a === "en0" ? -1 : b === "en0" ? 1 : a.localeCompare(b)));
  for (const n of names) for (const i of nets[n] ?? []) if (i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254.")) return i.address;
  return null;
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STATUS = {
  valid: ["Valid label", "#14532d", "#e2f3e8", "&#10003;"],
  expired: ["Expired registration", "#475569", "#eef2f7", "!"],
  not_yet_valid: ["Registration not yet valid", "#8a4b00", "#fff4d6", "!"],
  revoked: ["Revoked registration", "#93000a", "#fdecea", "&#10007;"],
  pending: ["Registration pending", "#8a4b00", "#fff4d6", "!"],
};

function page(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BEE label check</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f4f8ff;color:#1e293b}
header{background:#14315e;color:#fff;padding:14px 18px}header b{display:block;font-size:17px}header span{font-size:12px;opacity:.8}
main{max-width:520px;margin:0 auto;padding:18px}.card{background:#fff;border:1px solid #dbe6f7;border-radius:16px;padding:20px;margin-bottom:14px}
.badge{display:flex;align-items:center;gap:12px;border-radius:14px;padding:14px 16px;font-weight:800;font-size:20px;margin-bottom:16px}
.badge i{font-style:normal;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:#fff;font-size:18px}
dl{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:14px 12px}dt{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b}
dd{margin:2px 0 0;font-weight:700;color:#14315e;font-size:15px}.wide{grid-column:1/-1}.stars{color:#b45309;font-size:22px;letter-spacing:2px}.stars span{color:#cbd5e1}
form{display:flex;gap:8px}input{flex:1;min-width:0;padding:12px;border:1px solid #c9d9f7;border-radius:10px;font-size:15px}button{padding:12px 16px;border:0;border-radius:10px;background:#1f3c88;color:#fff;font-weight:700;font-size:15px}
.note{font-size:12px;color:#64748b;text-align:center;margin-top:8px}</style></head><body>
<header><b>Bureau of Energy Efficiency</b><span>Star label check · local demonstration</span></header><main>${body}<p class="note">Local demonstration: this is not a BEE certificate and has no legal effect.</p></main></body></html>`;
}

function result(reg, status, data) {
  const form = `<div class="card"><form action="/verify" method="get"><input name="reg" value="${esc(reg)}" placeholder="BEEQ-… or BEE/RAC/2026/10001" aria-label="Serial or registration ID"><button>Check</button></form></div>`;
  if (status === 200 && data) {
    const [label, fg, bg, mark] = STATUS[data.status] ?? [String(data.status), "#14315e", "#e7effb", "?"];
    const n = Math.max(0, Math.min(5, Number(data.stars) || 0));
    return form + `<div class="card"><div class="badge" style="color:${fg};background:${bg}"><i>${mark}</i>${esc(label)}</div>
<dl><div class="wide"><dt>Registration</dt><dd>${esc(data.registrationId)}</dd></div>
<div><dt>Brand</dt><dd>${esc(data.brandName)}</dd></div><div><dt>Model</dt><dd>${esc(data.modelNumber)}</dd></div>
<div class="wide"><dt>Manufacturer</dt><dd>${esc(String(data.manufacturer ?? "").replace(/\s*\(synthetic[^)]*\)\s*$/i, ""))}</dd></div>
<div><dt>Star rating</dt><dd class="stars">${"&#9733;".repeat(n)}<span>${"&#9733;".repeat(5 - n)}</span></dd></div><div><dt>Efficiency (ISEER)</dt><dd>${esc(data.verifiedIseer)}</dd></div>
<div><dt>Valid from</dt><dd>${esc(data.validFrom)}</dd></div><div><dt>Valid to</dt><dd>${esc(data.validTo)}</dd></div>
<div class="wide"><dt>Category</dt><dd>${esc(data.category)}</dd></div></dl></div>`;
  }
  const msg = status === 404 ? "No such registration. Check the serial or registration ID on the label." : status === 429 ? "Too many checks just now. Please wait a moment and try again." : "The check is not available right now. Please try again.";
  return form + `<div class="card"><div class="badge" style="color:#93000a;background:#fdecea"><i>&#10007;</i>Not confirmed</div><p style="margin:0">${esc(msg)}</p></div>`;
}

function fetchRecord(reg) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: TARGET_PORT, path: `/api/runtime/verification?reg=${encodeURIComponent(reg)}`, headers: { accept: "application/json" }, timeout: 8000 }, (r) => {
      let buf = "";
      r.on("data", (c) => (buf += c));
      r.on("end", () => { let data = null; try { data = JSON.parse(buf); } catch { /* not JSON */ } resolve({ status: r.statusCode ?? 502, data }); });
    });
    req.on("error", () => resolve({ status: 502, data: null }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 504, data: null }); });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", "http://gateway");
  if (u.pathname === "/__scan-info") {
    const ip = lanAddress();
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: Boolean(ip), base: ip ? `http://${ip}:${PORT}` : null }));
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end("Method not allowed"); return; }
  if (u.pathname === "/" || u.pathname === "/verify") {
    const reg = (u.searchParams.get("reg") ?? "").trim().slice(0, 80);
    const body = reg ? await fetchRecord(reg).then((r) => result(reg, r.status, r.data)) : result("", 0, null).replace(/<div class="card"><div class="badge"[\s\S]*$/, "<p class=\"note\">Enter a serial or registration ID, or scan a label.</p>");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(page(body));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" }).end("This address only serves the public label check.");
});

server.listen(PORT, "0.0.0.0", () => {
  const ip = lanAddress();
  console.log(`Scan gateway on port ${PORT} (portal on ${TARGET_PORT}).`);
  console.log(ip ? `A phone on the same Wi-Fi can open http://${ip}:${PORT}/verify` : "No network address found: connect to Wi-Fi first.");
  console.log("Only the public label check is served. Ctrl-C to stop.");
});
