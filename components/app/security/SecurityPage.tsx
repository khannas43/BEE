"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";

/**
 * How the solution is protected. Seven groups of safeguards, a defence-in-depth picture, and a table against the OWASP Top 10 and the MeitY
 * expectations. Each safeguard says whether it runs in this demonstration (checked against the code on 21 October) or is planned for the
 * production solution. The alignment is a target, not a certification. Local demonstration, not a contractual specification.
 */

type State = "demo" | "planned";
type Pointer = { title: string; plain: string; tech: string; state: State };
type Group = { id: string; title: string; icon: string; line: string; pointers: Pointer[] };

const STATE: Record<State, { label: string; tone: string }> = {
  demo: { label: "Running in this demo", tone: "border-[#b7e0c6] bg-[#e2f3e8] text-[#14532d]" },
  planned: { label: "Planned", tone: "border-dashed border-[#254e9e] bg-white text-[#14315E]" },
};

const GROUPS: Group[] = [
  {
    id: "identity", title: "Who you are", icon: "badge", line: "Every person is identified before anything else happens",
    pointers: [
      { title: "Single sign-on", plain: "One trusted sign-in for every screen and every role.", tech: "Keycloak, OAuth2 / OpenID Connect, authorisation code flow with PKCE (S256). The ID token is checked for signature, issuer, audience, authorised party, lifetime and nonce.", state: "demo" },
      { title: "Second factor for officers and approvers", plain: "A one-time code from an authenticator app, on top of the password.", tech: "TOTP. Enforced by default in the API; the demonstration sign-in turns it off on purpose so the demo is quick.", state: "planned" },
      { title: "Sign-in attempt limits and session expiry", plain: "Repeated wrong passwords are slowed down; a session ends after a set time.", tech: "Per-person and overall rate limits on sign-in; 8-hour maximum session; refresh handled on the server.", state: "demo" },
      { title: "Accounts that can be switched off", plain: "A disabled account or an ended role stops working at once.", tech: "The API checks the account status, the active role assignment and the organisation membership on every call.", state: "demo" },
    ],
  },
  {
    id: "access", title: "What you may do", icon: "admin_panel_settings", line: "Rules are enforced on the server, not only on the screen",
    pointers: [
      { title: "Roles and scope", plain: "A manufacturer sees only its own company. BEE roles see what their role needs.", tech: "Role and scope (all, own organisation, assigned) resolved from the database on every request. A record outside your scope answers exactly like one that does not exist.", state: "demo" },
      { title: "Separation of duties", plain: "The person who submits a record cannot also approve or commit it.", tech: "Enforced in the API services and by database constraints; a refusal is the documented error segregation_refused. Delegates are counted with their delegator.", state: "demo" },
      { title: "Time-limited delegations", plain: "Handing a role to someone else ends on a date and is recorded.", tech: "Delegations carry a validity window and are logged when used.", state: "demo" },
    ],
  },
  {
    id: "browser", title: "Protecting the browser", icon: "web", line: "The browser never holds the keys",
    pointers: [
      { title: "Tokens stay on the server", plain: "The browser holds only a session cookie; the sign-in tokens never reach it.", tech: "Backend for frontend (BFF): server-side session, httpOnly and SameSite=Lax cookie (Secure over HTTPS). Access, refresh and ID tokens stay in the server process.", state: "demo" },
      { title: "Every answer is checked", plain: "The portal checks what the API returns before showing it.", tech: "Responses validated against the pinned OpenAPI contract; answers are no-store; path segments are sanitised; the sign-out route checks the origin.", state: "demo" },
      { title: "Browser security headers", plain: "Extra instructions to the browser against framing, sniffing and script injection.", tech: "Content-Security-Policy, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.", state: "planned" },
    ],
  },
  {
    id: "proof", title: "Proof and audit", icon: "fact_check", line: "Records cannot be quietly changed, and every step is on record",
    pointers: [
      { title: "Append-only audit history", plain: "Who did what and when is written once and never edited.", tech: "About 130 database triggers keep audit, certificate, document and event tables append-only; the application's database account cannot switch them off.", state: "demo" },
      { title: "Certificate fingerprint chain", plain: "Each certificate record carries the fingerprint of the one before it; any change shows as a mismatch.", tech: "SHA-256 hash chain in PostgreSQL, re-verified on every check. Hyperledger Fabric and signed QR payloads are the production target.", state: "demo" },
      { title: "Sign-in and action trail", plain: "Who signed in, from which address, and what they did.", tech: "Recorded with the IP address; visible per company and consolidated for BEE.", state: "demo" },
      { title: "Logs without secrets", plain: "Operational logs help find problems and never hold passwords or documents.", tech: "Structured request logs with correlation IDs, route templates and outcome codes; no tokens, headers, record IDs or bodies.", state: "demo" },
    ],
  },
  {
    id: "data", title: "Protecting the data", icon: "database", line: "Data is guarded where it lives",
    pointers: [
      { title: "Least-privilege database accounts", plain: "The application can do only what it needs: it cannot edit the register or remove protections.", tech: "Separate owner and runtime database roles; the runtime role has no DDL, cannot disable triggers and cannot write the register tables directly; checked by the release gate.", state: "demo" },
      { title: "Uploaded documents", plain: "Every uploaded file is fingerprinted, so a changed file is detectable.", tech: "Blobs stored under their SHA-256 name; media type, size and fingerprint recorded; documents stay 'pending verification' until a person checks them.", state: "demo" },
      { title: "No real sensitive data in the demo", plain: "No real payment, one-time password or identity data is used here.", tech: "Simulated gateway, messages and verification; synthetic data only.", state: "demo" },
      { title: "Encryption in transit and at rest", plain: "Data is scrambled on the network and on disk.", tech: "TLS 1.2 or higher everywhere; disk and database encryption; key management.", state: "planned" },
      { title: "Backups and recovery", plain: "Data can be restored after a failure, and the restore is tested.", tech: "Scheduled backups, point-in-time recovery, restore drills, retention rules.", state: "planned" },
      { title: "Virus scan on uploads", plain: "Files are scanned before anyone opens them.", tech: "Malware scanning in the upload path, quarantine on a hit.", state: "planned" },
    ],
  },
  {
    id: "platform", title: "Network and platform", icon: "hub", line: "Only the right traffic reaches the right place",
    pointers: [
      { title: "API gateway", plain: "One guarded front door in front of the services.", tech: "Apache APISIX: rate limits, routing, policies, authentication offload.", state: "planned" },
      { title: "Isolation of services", plain: "Each service runs in its own box, with only the access it needs.", tech: "Containers on Kubernetes, network policies, least-privilege service accounts.", state: "planned" },
      { title: "Secrets management", plain: "Passwords and keys are kept in a vault, not in files.", tech: "A secrets vault with rotation and access logging.", state: "planned" },
      { title: "Scanning of images and dependencies", plain: "Known weaknesses in the software we use are found early.", tech: "Trivy in the build pipeline; pinned dependency versions are already locked in the code.", state: "planned" },
    ],
  },
  {
    id: "watch", title: "Watching and testing", icon: "visibility", line: "Problems are found by us before anyone else finds them",
    pointers: [
      { title: "Monitoring and alerts", plain: "Unusual activity and failures raise an alarm.", tech: "Prometheus and Grafana dashboards, alert rules, on-call routing.", state: "planned" },
      { title: "Security and load testing", plain: "The system is attacked and stressed on purpose, before go-live.", tech: "OWASP ZAP for web security tests, k6 for load tests, run in every release.", state: "planned" },
      { title: "Independent security audit", plain: "An outside expert audits the system before it goes live.", tech: "Security audit by a CERT-In empanelled auditor, with findings closed before go-live.", state: "planned" },
      { title: "Incident response", plain: "A written plan for what to do, who to tell and how fast.", tech: "Runbook, roles, reporting to CERT-In within the required time, post-incident review.", state: "planned" },
    ],
  },
];

const OWASP: { id: string; name: string; how: string; state: State }[] = [
  { id: "A01", name: "Broken access control", how: "Roles and scope are decided on the server on every call; out-of-scope records look like they do not exist; separation of duties is enforced in the API and database.", state: "demo" },
  { id: "A02", name: "Cryptographic failures", how: "Passwords are handled by the identity service. Encryption in transit and at rest, with key management, is the production design.", state: "planned" },
  { id: "A03", name: "Injection", how: "Database values are always passed as bound parameters; path segments are sanitised; answers are validated against the contract.", state: "demo" },
  { id: "A04", name: "Insecure design", how: "Rules such as two-person commit and append-only records are built into the design. A formal threat-modelling review is planned before go-live.", state: "demo" },
  { id: "A05", name: "Security misconfiguration", how: "Demo-only switches are off unless set; the release gate checks database permissions. Browser security headers and hardened images are planned.", state: "planned" },
  { id: "A06", name: "Vulnerable and outdated components", how: "Dependency versions are locked and the stack is open source with active communities. Automated scanning (Trivy) is planned.", state: "planned" },
  { id: "A07", name: "Identification and authentication failures", how: "Single sign-on with PKCE, sign-in rate limits, session expiry, and an authenticator code for officers and approvers.", state: "demo" },
  { id: "A08", name: "Software and data integrity failures", how: "Append-only audit, the certificate fingerprint chain and fingerprinted documents. Signed pipelines and signed QR payloads are planned.", state: "demo" },
  { id: "A09", name: "Logging and monitoring failures", how: "Structured logs with correlation IDs, audit history and the sign-in trail. Central monitoring and alerts are planned.", state: "demo" },
  { id: "A10", name: "Server-side request forgery", how: "The portal server calls only fixed, configured service addresses; a user never chooses where it connects.", state: "demo" },
];

const MEITY: { title: string; text: string }[] = [
  { title: "Security audit before go-live", text: "By a CERT-In empanelled auditor, with findings closed and a clearance certificate." },
  { title: "Hosting on an empanelled cloud", text: "On a MeitY-empanelled cloud service provider, with data kept in India." },
  { title: "Government website guidelines", text: "The public pages follow the Guidelines for Indian Government Websites (GIGW) for security, accessibility and content." },
  { title: "Data protection", text: "Personal data handled as the Digital Personal Data Protection Act requires: purpose, consent, retention and breach reporting." },
];

const RINGS = [
  { name: "People", note: "sign-in, second factor, roles", icon: "badge" },
  { name: "Network and platform", note: "gateway, isolation, secrets", icon: "hub" },
  { name: "Application", note: "browser protection, rules, separation of duties", icon: "web" },
  { name: "Data", note: "database permissions, encryption, backups", icon: "database" },
];

function Chip({ state }: { state: State }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATE[state].tone}`}>{STATE[state].label}</span>;
}

function DefenceDiagram() {
  const shades = ["#14315E", "#1c3f78", "#254e9e", "#3b66b8"];
  return (
    <section className="rounded-2xl border border-[#dbe6f7] bg-white p-6" data-testid="sec-rings">
      <div role="heading" aria-level={2} className="mb-1 text-[18px] font-bold text-[#14315E]">Defence in depth</div>
      <p className="mb-5 text-[13px] text-[#64748b]">An attacker has to get through every layer to reach the records, and each layer logs what it sees.</p>
      <div className="mx-auto max-w-3xl">
        {RINGS.reduceRight<React.ReactNode>((inner, r, i) => (
          <div key={r.name} className="rounded-2xl p-3 text-white" style={{ background: shades[i] }}>
            <div className="mb-2 flex items-center gap-2 px-1"><Icon name={r.icon} size={18} /><b className="text-[14px]">{r.name}</b><span className="text-[12px] text-white/75">{r.note}</span></div>
            {inner}
          </div>
        ), (
          <div className="flex items-center justify-center gap-3 rounded-xl bg-white px-4 py-5 text-[#14315E]">
            <Icon name="verified_user" size={30} className="text-[#146c43]" />
            <div><b className="block text-[15px]">Records and proof</b><span className="text-[12px] text-[#64748b]">append-only audit, certificate fingerprint chain, sign-in trail</span></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function GroupCard({ g, open, onToggle }: { g: Group; open: boolean; onToggle: () => void }) {
  const running = g.pointers.filter((p) => p.state === "demo").length;
  return (
    <section className="overflow-hidden rounded-2xl border border-[#dbe6f7] bg-white shadow-[0_1px_2px_rgba(20,49,94,0.06)]" style={{ borderTop: "4px solid #254e9e" }} data-testid={`sec-group-${g.id}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 p-5 text-left" data-testid={`sec-group-${g.id}-toggle`}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e7effb] text-[#254e9e]"><Icon name={g.icon} size={24} /></span>
        <span className="min-w-0 flex-1">
          <span role="heading" aria-level={2} className="block text-[18px] font-bold text-[#14315E]">{g.title}</span>
          <span className="block text-[13px] text-[#64748b]">{g.line}</span>
          <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#64748b]">{g.pointers.length} safeguards{running ? ` · ${running} running in this demo` : ""}</span>
        </span>
        <span className="mt-1 flex items-center gap-1 text-[12px] font-semibold text-primary">{open ? "Hide" : "Details"}<Icon name={open ? "expand_less" : "expand_more"} size={20} /></span>
      </button>
      {open ? (
        <ul className="divide-y divide-[#e2e8f0] border-t border-[#e2e8f0] bg-[#fbfcfe]">
          {g.pointers.map((p) => (
            <li key={p.title} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-2"><b className="text-[15px] text-[#14315E]">{p.title}</b><Chip state={p.state} /></div>
              <p className="mt-1 text-[14px] text-[#1e293b]">{p.plain}</p>
              <p className="mt-2 rounded-lg bg-[#f1f5f9] px-3 py-2 text-[12px] leading-5 text-[#475569]"><span className="font-bold text-[#334155]">Technical: </span>{p.tech}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function SecurityPage() {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const allOpen = GROUPS.every((g) => open[g.id]);
  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="security-page">
      <header className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#14315E] via-[#1c3f78] to-[#254e9e] text-white shadow-[0_6px_20px_rgba(20,49,94,0.25)]" data-testid="sec-hero">
        <div className="flex flex-wrap items-center justify-between gap-5 p-6">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-[#14315E]"><Icon name="shield_lock" size={30} /></span>
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#c9d9f7]">Cybersecurity</div>
              <h1 className="text-[30px] font-extrabold leading-9 !text-white">Secured in layers</h1>
              <p className="mt-1 max-w-2xl text-[14px] text-[#dbe6f7]">How people, rules, data and records are protected, from the first sign-in to the last audit entry. Some safeguards already run in this demonstration; the rest are the design for the production solution.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[12px] font-semibold">
            <span className="rounded-full bg-white px-3 py-1.5 text-[#14315E]">OWASP Top 10</span>
            <span className="rounded-full bg-white px-3 py-1.5 text-[#14315E]">MeitY guidelines</span>
            <span className="rounded-full bg-white/15 px-3 py-1.5">alignment target, not a certification</span>
          </div>
        </div>
      </header>

      <DefenceDiagram />

      <div className="flex items-center justify-between">
        <div role="heading" aria-level={2} className="text-[18px] font-bold text-[#14315E]">The safeguards</div>
        <button type="button" className="text-[13px] font-semibold text-primary hover:underline" onClick={() => setOpen(Object.fromEntries(GROUPS.map((g) => [g.id, !allOpen])))} data-testid="sec-toggle-all">{allOpen ? "Collapse all" : "Expand all"}</button>
      </div>
      <div className="grid items-start gap-space-md lg:grid-cols-2">
        {GROUPS.map((g) => <GroupCard key={g.id} g={g} open={Boolean(open[g.id])} onToggle={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))} />)}
      </div>

      <section className="rounded-2xl border border-[#dbe6f7] bg-white p-6" data-testid="sec-owasp">
        <div role="heading" aria-level={2} className="text-[18px] font-bold text-[#14315E]">Against the OWASP Top 10</div>
        <p className="mb-4 text-[13px] text-[#64748b]">The ten most common web application risks, and how the solution addresses each.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <caption className="sr-only">OWASP Top 10 and how each risk is addressed</caption>
            <thead><tr className="bg-[#eef3fb] text-left text-[12px] font-semibold uppercase tracking-wide text-[#475569]"><th className="px-3 py-2">#</th><th className="px-3 py-2">Risk</th><th className="px-3 py-2">How it is addressed</th><th className="px-3 py-2">Status</th></tr></thead>
            <tbody>
              {OWASP.map((o) => (
                <tr key={o.id} className="border-t border-[#e2e8f0] align-top">
                  <td className="px-3 py-3 font-bold text-[#254e9e]">{o.id}</td><td className="px-3 py-3 font-semibold text-[#14315E]">{o.name}</td><td className="px-3 py-3 text-[#334155]">{o.how}</td><td className="px-3 py-3"><Chip state={o.state} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-[#dbe6f7] bg-white p-6" data-testid="sec-meity">
        <div role="heading" aria-level={2} className="text-[18px] font-bold text-[#14315E]">MeitY and government expectations</div>
        <p className="mb-4 text-[13px] text-[#64748b]">What the production solution is designed to meet. The exact requirements are to be confirmed with BEE and the department.</p>
        <ul className="grid gap-3 md:grid-cols-2">
          {MEITY.map((m) => (
            <li key={m.title} className="flex gap-3 rounded-xl border border-[#e2e8f0] bg-[#fbfcfe] p-4"><Icon name="policy" size={22} className="mt-0.5 shrink-0 text-[#254e9e]" /><span><b className="block text-[14px] text-[#14315E]">{m.title}</b><span className="text-[13px] text-[#334155]">{m.text}</span></span><span className="ml-auto"><Chip state="planned" /></span></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
