"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";

/**
 * The solution architecture: every layer and component the solution is planned to use, marked for this demonstration as Built (running
 * here), Simulated (a local stand-in with the same rules) or Planned (the target stack, not installed here). Source: the development plan
 * (section 3.2, the target catalogue), the decisions register and the code. Local demonstration, not a contractual specification.
 */

type Status = "built" | "simulated" | "planned";
type Item = { name: string; tech: string; what: string; status: Status; note?: string };
type Layer = { id: string; title: string; icon: string; blurb: string; items: Item[] };

const STATUS: Record<Status, { label: string; tone: string; dot: string }> = {
  built: { label: "Built", tone: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]", dot: "bg-[#1c7c4a]" },
  simulated: { label: "Simulated", tone: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]", dot: "bg-[#f59e0b]" },
  planned: { label: "Planned", tone: "bg-[#e7effb] text-[#14315E] border-[#c9d9f7]", dot: "bg-[#254e9e]" },
};

const LAYERS: Layer[] = [
  {
    id: "channels", title: "People and channels", icon: "devices", blurb: "Who uses it",
    items: [
      { name: "Public portal", tech: "Next.js pages", what: "Public site, registration ID check, star label verification.", status: "built" },
      { name: "Partner and officer portal", tech: "Next.js, React 19", what: "Manufacturer, BEE Officer, Director, Finance, Programme, Reviewer and Admin work screens.", status: "built" },
      { name: "QR scan on a phone", tech: "QR codes, scan gateway", what: "A consumer or inspector scans a label and sees the star label check.", status: "built", note: "Demo gateway on the local network." },
      { name: "Existing BEE mobile app", tech: "Native mobile", what: "Connect the existing app to the verification and label services.", status: "planned" },
    ],
  },
  {
    id: "experience", title: "Screens", icon: "web", blurb: "What people see",
    items: [
      { name: "Web application", tech: "Next.js 16 (App Router), React 19, TypeScript 5", what: "Server-rendered pages, client screens, route guards, role-based menus.", status: "built" },
      { name: "Design system", tech: "Tailwind CSS 3, Material Symbols", what: "One look across screens: cards, chips, collapsible boxes, tables, filters.", status: "built" },
      { name: "Documents, exports and labels", tech: "Browser PDF, Excel and QR generators", what: "Certificates, receipts, CSV and Excel downloads, printable star labels.", status: "built" },
      { name: "Generated forms and letters with e-sign", tech: "Versioned templates, e-sign", what: "Official templates, letter versions and digital signature.", status: "planned" },
    ],
  },
  {
    id: "api", title: "Access and security", icon: "shield_lock", blurb: "Who may do what",
    items: [
      { name: "Backend for frontend (BFF)", tech: "Next.js server routes", what: "Holds the session, validates every answer against the contract, logs requests.", status: "built" },
      { name: "Business API", tech: "Spring Boot 3.5, Java 17, Spring Security", what: "Resource server: roles, scopes, separation of duties, all business rules.", status: "built" },
      { name: "API contract", tech: "OpenAPI", what: "A pinned, tested contract between portal and API.", status: "built" },
      { name: "Identity and sign-in", tech: "Keycloak, OAuth2 / OpenID Connect, PKCE", what: "Single sign-on, role assignment, token checks.", status: "built" },
      { name: "Multi-factor sign-in", tech: "TOTP authenticator", what: "A second factor for officers and approvers.", status: "simulated", note: "Local TOTP demonstration; the demo uses password-only sign-in." },
      { name: "API gateway", tech: "Apache APISIX", what: "Rate limits, routing, policies in front of the API.", status: "planned" },
    ],
  },
  {
    id: "services", title: "Business engine", icon: "hub", blurb: "The work behind the screens",
    items: [
      { name: "Registration and onboarding", tech: "Spring modules, PostgreSQL rules", what: "Company, brand and agency registration, scrutiny, observation, holds, revocation.", status: "built" },
      { name: "Model, test and rating workflow", tech: "In-application state machine", what: "Model applications, fee confirmation, IAME and BEE scrutiny, rating, Director approval, certificates.", status: "built" },
      { name: "QR batches, production and reconciliation", tech: "Spring modules", what: "QR serials, quarterly production, BEE tests per quarter, reconciliation.", status: "built" },
      { name: "Payments", tech: "Payment adapter", what: "Fee payment, receipts, Finance reconciliation.", status: "simulated", note: "Simulated gateway; no money moves." },
      { name: "Notifications", tech: "Email and SMS adapters", what: "Messages for every step to every role.", status: "simulated", note: "Messages are recorded, nothing is sent." },
      { name: "AI advisory helpers", tech: "Transparent rules and statistics", what: "Compliance risk, production anomaly, rating trends, document extraction; a person decides.", status: "simulated" },
      { name: "Document intelligence (OCR)", tech: "OCR and extraction models", what: "Read test reports and trade licences, compare with declarations.", status: "planned" },
      { name: "Chatbot and assisted helpdesk", tech: "Rasa", what: "Guided answers and ticket drafting for applicants.", status: "planned" },
      { name: "Machine learning models", tech: "Production AI", what: "Risk scoring and anomaly detection trained on live data.", status: "planned" },
      { name: "Workflow orchestration and batch jobs", tech: "Apache Airflow", what: "Scheduled checks, renewals, expiry reminders.", status: "planned" },
    ],
  },
  {
    id: "data", title: "Data and insight", icon: "database", blurb: "Records, documents, dashboards",
    items: [
      { name: "Operational database", tech: "PostgreSQL, Flyway migrations", what: "All records; triggers enforce append-only audit tables, separation of duties and hash chains.", status: "built" },
      { name: "Production database option", tech: "Microsoft SQL Server", what: "Planned production migration of the operational database.", status: "planned" },
      { name: "Document and evidence storage", tech: "Managed document store with verification (to be selected)", what: "Test reports, licences, signed documents with virus checks and retention.", status: "planned", note: "Today uploads sit in the database, marked pending verification." },
      { name: "Search", tech: "OpenSearch", what: "Full-text search across registers, applications and documents.", status: "planned" },
      { name: "Event streaming and change capture", tech: "Apache Kafka, NiFi, Debezium", what: "Events between services, feeds to analytics and the ledger.", status: "planned" },
      { name: "Analytics store and dashboards", tech: "ClickHouse, Apache Superset", what: "Programme MIS, dashboards, trends for officials.", status: "planned", note: "Dashboards today read PostgreSQL directly." },
    ],
  },
  {
    id: "trust", title: "Trust and proof", icon: "link", blurb: "Records that cannot be quietly changed",
    items: [
      { name: "Certificate hash chain", tech: "SHA-256 chain in PostgreSQL", what: "Each record carries the previous record's fingerprint; MATCH or MISMATCH on every check.", status: "simulated", note: "Stands in for a blockchain network." },
      { name: "Hyperledger Fabric network", tech: "Hyperledger Fabric (permissioned blockchain)", what: "Certificate and revocation records replicated across organisations, committed by agreement of the member organisations.", status: "planned" },
      { name: "Chaincode (smart contracts)", tech: "Hyperledger Fabric chaincode", what: "The rules for issuing, amending and revoking a certificate, run by every peer.", status: "planned" },
      { name: "Signed QR payloads", tech: "Digital signatures on QR content", what: "A label that proves its own origin offline.", status: "planned" },
      { name: "Anchoring", tech: "Merkle tree anchoring", what: "Periodic proof that the evidence set has not changed.", status: "planned" },
      { name: "Digital signature", tech: "eSign service", what: "Signed certificates and letters.", status: "planned" },
    ],
  },
  {
    id: "external", title: "Connections to others", icon: "swap_horiz", blurb: "Outside systems",
    items: [
      { name: "Payment gateway", tech: "Government payment gateway", what: "Real fee collection and settlement.", status: "planned" },
      { name: "Email and SMS gateways", tech: "Messaging providers", what: "Real delivery of notices and OTPs.", status: "planned" },
      { name: "Company and tax verification", tech: "MCA and GSTN checks", what: "Verify CIN and GSTIN during registration.", status: "planned" },
      { name: "National ID and platforms", tech: "ID and national-platform interfaces", what: "Identity proofing and links to national services.", status: "planned" },
    ],
  },
  {
    id: "platform", title: "Foundation", icon: "construction", blurb: "How it is run and watched",
    items: [
      { name: "Local runtime", tech: "Docker Compose, Maven, Node 22", what: "PostgreSQL, Keycloak, the API and the portal on one machine for the demonstration.", status: "built" },
      { name: "Automated checks", tech: "Vitest, JUnit, browser checks, contract checks", what: "Portal tests, backend tests, live browser journeys, a full gate.", status: "built" },
      { name: "Containers and orchestration", tech: "Kubernetes", what: "Deployment, scaling and recovery of every service.", status: "planned" },
      { name: "Build and delivery", tech: "Gitea, Jenkins, Argo CD", what: "Pipelines and GitOps deployment.", status: "planned" },
      { name: "Infrastructure as code", tech: "OpenTofu, Ansible", what: "Repeatable environments.", status: "planned" },
      { name: "Monitoring", tech: "Prometheus, Grafana", what: "Metrics, alerts and service dashboards.", status: "planned" },
      { name: "Security and load testing", tech: "Trivy, OWASP ZAP, k6", what: "Image and dependency scanning, web security tests, load tests.", status: "planned" },
    ],
  },
];


type Pillar = "M" | "A" | "C" | "H";
const PILLARS: { key: Pillar; name: string; how: string; status: Status; note: string }[] = [
  { key: "M", name: "Microservices", how: "Business capabilities are separate modules with their own rules and data: registration, models and rating, QR and production, payments, ledger, AI, messages.", status: "built", note: "Built as separate business modules, deployed together today; independent deployment behind a gateway is planned." },
  { key: "A", name: "API-first", how: "Every screen and channel uses the same pinned OpenAPI contract through the portal server; nothing reads another module's tables directly.", status: "built", note: "Contract, BFF and role checks are running; the API gateway is planned." },
  { key: "C", name: "Cloud-native", how: "Containers, configuration by environment, stateless portal and API, infrastructure as code and orchestration for scaling and recovery.", status: "planned", note: "Today: Docker on one machine. Target: Kubernetes, pipelines, monitoring." },
  { key: "H", name: "Headless", how: "The portal is only one client. The public site, partner portal, QR check and the existing mobile app all consume the same APIs.", status: "built", note: "Portal and API are separate today; more channels are planned." },
];
const MACH_OF: Record<string, Pillar[]> = {
  "Public portal": ["H"], "Partner and officer portal": ["H"], "QR scan on a phone": ["H"], "Existing BEE mobile app": ["H"], "Web application": ["H"],
  "Backend for frontend (BFF)": ["A", "H"], "Business API": ["A"], "API contract": ["A"], "Identity and sign-in": ["A"], "API gateway": ["A"],
  "Registration and onboarding": ["M"], "Model, test and rating workflow": ["M"], "QR batches, production and reconciliation": ["M"], "Payments": ["M"], "Notifications": ["M"], "AI advisory helpers": ["M"],
  "Document intelligence (OCR)": ["M"], "Chatbot and assisted helpdesk": ["M"], "Machine learning models": ["M"], "Workflow orchestration and batch jobs": ["M", "C"],
  "Event streaming and change capture": ["M", "C"], "Search": ["M", "C"], "Analytics store and dashboards": ["M", "C"], "Hyperledger Fabric network": ["M", "C"], "Chaincode (smart contracts)": ["M"],
  "Payment gateway": ["A"], "Email and SMS gateways": ["A"], "Company and tax verification": ["A"], "National ID and platforms": ["A"],
  "Local runtime": ["C"], "Containers and orchestration": ["C"], "Build and delivery": ["C"], "Infrastructure as code": ["C"], "Monitoring": ["C"], "Security and load testing": ["C"],
};


/** Shown when the pointer rests on a MACH tile: the business services, the API groups with their counts, and the channels and foundation blocks. */
const SERVICES = [
  "Identity and access", "Registration (company, brand, agency)", "Manufacturer onboarding and observation", "Model applications and documents", "Fees and payments",
  "Scrutiny and approval workflow", "Rating", "Certificates and the ledger", "QR and labels", "Production and quarterly tests", "Notifications and service requests",
  "Public verification", "Insight and AI (dashboards, MIS)", "Master data and settings", "Audit and history",
];
const API_GROUPS: [string, number][] = [
  ["Model applications", 40], ["Registrations (brand, agency)", 24], ["Manufacturer onboarding", 22], ["Fees (rules and corrections)", 16], ["Notifications and messages", 12],
  ["Ledger", 10], ["Production and quarterly tests", 11], ["Sign-in and identity", 8], ["Dashboards and MIS", 7], ["QR labels", 6], ["Rating schemes", 6], ["Business settings", 6],
  ["Register and revocation", 6], ["Delegations", 6], ["AI helpers", 5], ["Payments", 4], ["Public verification and sign-up", 4], ["Manufacturer 360 and product details", 3], ["Service requests", 3],
];
const API_TOTAL = API_GROUPS.reduce((n, [, c]) => n + c, 0);

function Popover({ pillar }: { pillar: Pillar }) {
  const channels = LAYERS[0].items.map((i) => i.name);
  const foundation = LAYERS[LAYERS.length - 1].items.map((i) => i.name);
  return (
    <div role="tooltip" data-testid={`arch-pop-${pillar}`} className={`pointer-events-none absolute top-full z-30 mt-2 hidden w-[480px] max-w-[92vw] rounded-xl border border-[#c9d9f7] bg-white p-4 text-left shadow-xl group-hover:block group-focus-within:block ${pillar === "M" ? "left-0" : pillar === "H" ? "right-0" : "left-1/2 -translate-x-1/2"}`}>
      {pillar === "M" ? (
        <>
          <div className="text-[13px] font-bold text-[#14315E]">Business services <span className="font-normal text-[#64748b]">· about {SERVICES.length}</span></div>
          <ol className="mt-2 columns-2 gap-x-4 text-[12px] text-[#334155] [&>li]:mb-1 [&>li]:break-inside-avoid">{SERVICES.map((n, i) => <li key={n}><span className="mr-1.5 inline-block w-4 text-right font-semibold text-[#254e9e]">{i + 1}</span>{n}</li>)}</ol>
        </>
      ) : pillar === "A" ? (
        <>
          <div className="text-[13px] font-bold text-[#14315E]">APIs for</div>
          <ul className="mt-2 columns-2 gap-x-6 text-[12px] text-[#334155] [&>li]:mb-1 [&>li]:break-inside-avoid">{API_GROUPS.map(([n, c]) => <li key={n} className="flex justify-between gap-3"><span>{n}</span><b className="text-[#14315E]">{c}</b></li>)}</ul>
          <div className="mt-2 flex justify-between border-t border-[#e2e8f0] pt-2 text-[12px] font-bold text-[#14315E]"><span>In all</span><span>about {API_TOTAL}</span></div>
        </>
      ) : (
        <>
          <div className="text-[13px] font-bold text-[#14315E]">{pillar === "H" ? "Channels that use the same APIs" : "Foundation blocks"}</div>
          <ul className="mt-2 space-y-1 text-[12px] text-[#334155]">{(pillar === "H" ? channels : foundation).map((n) => <li key={n}>• {n}</li>)}</ul>
        </>
      )}
    </div>
  );
}

const PILLAR_ICON: Record<Pillar, string> = { M: "widgets", A: "api", C: "cloud", H: "devices" };

type JStatus = "core" | "simulated" | "partial" | "planned";
/** The thirteen journey items of the solution walkthrough and how far each works in this demonstration. "Working" counts core and simulated. */
const JOURNEY: [string, JStatus, string][] = [
  ["Seven-screen journey", "core", "Admin view across registration, labels, operations and dashboard"],
  ["Applicant dashboard", "core", "Manufacturer 360 with company, models, QR, fees"],
  ["Company and brand registration", "core", "Wizard, review, approval; MCA/GSTN checks planned"],
  ["Document verification", "core", "Upload and return; OCR planned"],
  ["Model and test report", "core", "Application, product details, test report, rating"],
  ["Officer scrutiny", "core", "Work queue, holds, approvals; full risk queue planned"],
  ["Secure QR batch", "core", "Batches, serials, scannable star labels"],
  ["Consumer verification", "core", "Public check and phone scan"],
  ["AI use cases", "simulated", "Four advisory use cases, person decides"],
  ["Secure evidence ledger", "simulated", "Hash chain; Hyperledger Fabric planned"],
  ["Data model and audit", "core", "Registers, audit history, evidence records"],
  ["Generated formats", "partial", "Certificates and receipts; versioning and e-sign planned"],
  ["Official templates", "planned", "Template retrieval still open"],
];
const J_TONE: Record<JStatus, { label: string; colour: string; chip: string }> = {
  core: { label: "Core covered", colour: "#1c7c4a", chip: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]" },
  simulated: { label: "Simulated", colour: "#f59e0b", chip: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]" },
  partial: { label: "Partial", colour: "#7aa2d6", chip: "bg-[#e7effb] text-[#14315E] border-[#c9d9f7]" },
  planned: { label: "Planned", colour: "#254e9e", chip: "bg-white text-[#14315E] border-[#254e9e] border-dashed" },
};

function Donut({ counts, centre, caption }: { counts: Record<JStatus, number>; centre: string; caption: string }) {
  const total = counts.core + counts.simulated + counts.partial + counts.planned;
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <svg viewBox="0 0 140 140" width={150} height={150} role="img" aria-label={`${centre}: ${caption}`} data-testid="arch-donut">
      <circle cx="70" cy="70" r={R} fill="none" stroke="#e7edf6" strokeWidth="18" />
      {(["core", "simulated", "partial", "planned"] as JStatus[]).map((k) => {
        const len = (counts[k] / total) * C;
        const el = <circle key={k} cx="70" cy="70" r={R} fill="none" stroke={J_TONE[k].colour} strokeWidth="18" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />;
        acc += len;
        return el;
      })}
      <text x="70" y="70" textAnchor="middle" fontSize="28" fontWeight="800" fill="#14315E">{centre}</text>
      <text x="70" y="88" textAnchor="middle" fontSize="9" fill="#64748b">{caption}</text>
    </svg>
  );
}

const chipTone: Record<Status, string> = {
  built: "border-[#1c7c4a] bg-[#1c7c4a] text-white",
  simulated: "border-[#f59e0b] bg-[#f59e0b] text-[#3b2400]",
  planned: "border-dashed border-[#254e9e] bg-white text-[#14315E]",
};

function Journey() {
  const steps: [string, string, string][] = [["person", "Person", "manufacturer, officer, public"], ["web", "Screens", "the portal"], ["shield_lock", "Security", "sign-in and roles"], ["settings", "Rules", "the business engine"], ["database", "Data", "records and audit"]];
  return (
    <div className="rounded-2xl border border-[#dbe6f7] bg-white p-5" data-testid="arch-flow">
      <div role="heading" aria-level={2} className="mb-4 text-[16px] font-bold text-[#14315E]">From a click to a record</div>
      <ol className="flex flex-wrap items-center gap-2">
        {steps.map(([icon, name, sub], i) => (
          <li key={name} className="flex items-center gap-2">
            <span className="flex w-[118px] flex-col items-center rounded-xl border border-[#c9d9f7] bg-[#f4f8ff] px-2 py-3 text-center"><Icon name={icon} size={26} className="text-[#254e9e]" /><b className="mt-1 text-[13px] text-[#14315E]">{name}</b><span className="text-[11px] text-[#64748b]">{sub}</span></span>
            {i < steps.length - 1 ? <Icon name="arrow_forward" size={20} className="text-[#94a3b8]" /> : null}
          </li>
        ))}
        <li className="flex items-center gap-2"><Icon name="arrow_forward" size={20} className="text-[#94a3b8]" />
          <span className="flex w-[130px] flex-col items-center rounded-xl border border-[#f3dc9c] bg-[#fffaf0] px-2 py-3 text-center"><Icon name="link" size={26} className="text-[#8a4b00]" /><b className="mt-1 text-[13px] text-[#14315E]">Fingerprint chain</b><span className="text-[11px] text-[#8a4b00]">simulated today</span></span>
          <Icon name="arrow_forward" size={20} className="text-[#94a3b8]" />
          <span className="flex w-[130px] flex-col items-center rounded-xl border-2 border-dashed border-[#254e9e] bg-white px-2 py-3 text-center"><Icon name="deployed_code" size={26} className="text-[#254e9e]" /><b className="mt-1 text-[13px] text-[#14315E]">Hyperledger Fabric</b><span className="text-[11px] text-[#254e9e]">planned</span></span>
        </li>
      </ol>
    </div>
  );
}

export function ArchitecturePage() {
  const [picked, setPicked] = useState<Item | null>(null);
  const all = LAYERS.flatMap((l) => l.items);
  const counts: Record<Status, number> = { built: 0, simulated: 0, planned: 0 };
  all.forEach((i) => { counts[i.status] += 1; });
  const jc: Record<JStatus, number> = { core: 0, simulated: 0, partial: 0, planned: 0 };
  JOURNEY.forEach(([, st]) => { jc[st] += 1; });
  const working = jc.core + jc.simulated;
  const pct = Math.round((working / JOURNEY.length) * 100);
  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="architecture-page">
      <div className="relative z-30 grid items-center gap-4 rounded-2xl bg-gradient-to-r from-[#14315E] to-[#254e9e] p-6 text-white md:grid-cols-[1fr_auto]">
        <div>
          <h1 className="text-[28px] font-extrabold leading-8 !text-white">Solution architecture</h1>
          <p className="mt-2 max-w-xl text-[15px] text-white/85">One platform for registration, labelling and verification: what works today, and what comes next.</p>
          <div className="mt-4 flex flex-wrap gap-2 text-[13px] font-semibold" data-testid="arch-legend">
            <span className="rounded-full bg-[#1c7c4a] px-3 py-1">Core covered · {jc.core}</span>
            <span className="rounded-full bg-[#f59e0b] px-3 py-1 text-[#3b2400]">Simulated · {jc.simulated}</span>
            <span className="rounded-full bg-[#7aa2d6] px-3 py-1 text-[#0f2547]">Partial · {jc.partial}</span>
            <span className="rounded-full border-2 border-dashed border-white px-3 py-1">Planned · {jc.planned}</span>
          </div>
          <p className="mt-3 text-[12px] text-white/70">Technology blocks below: Built {counts.built} · Simulated {counts.simulated} · Planned {counts.planned}</p>
        </div>
        <div className="group relative rounded-2xl bg-white p-2" tabIndex={0} data-testid="arch-readiness">
          <Donut counts={jc} centre={`${pct}%`} caption="journey items working" />
          <div role="tooltip" data-testid="arch-readiness-list" className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-[430px] max-w-[92vw] rounded-xl border border-[#c9d9f7] bg-white p-4 text-left shadow-xl group-hover:block group-focus-within:block">
            <div className="text-[13px] font-bold text-[#14315E]">{working} of {JOURNEY.length} journey items work in this demonstration <span className="font-normal text-[#64748b]">(core covered or simulated)</span></div>
            <ul className="mt-2 space-y-1 text-[12px] text-[#334155]">
              {JOURNEY.map(([name, st, note]) => (
                <li key={name} className="flex items-start justify-between gap-2"><span><b className="text-[#14315E]">{name}</b> <span className="text-[#64748b]">· {note}</span></span><span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${J_TONE[st].chip}`}>{J_TONE[st].label}</span></li>
              ))}
            </ul>
            <p className="mt-2 border-t border-[#e2e8f0] pt-2 text-[11px] italic text-[#64748b]">This measures the journey shown in the walkthrough. It is not a measure of the complete production solution: the planned technology blocks and advanced features below are still ahead.</p>
          </div>
        </div>
      </div>

      <div className="relative z-20 grid gap-3 md:grid-cols-4" data-testid="arch-mach">
        {PILLARS.map((p) => (
          <div key={p.key} tabIndex={0} className="group relative cursor-default rounded-2xl border border-[#c9d9f7] bg-white p-4 text-center outline-none hover:border-[#254e9e] focus:border-[#254e9e]" data-testid={`arch-mach-${p.key}`}>
            <Popover pillar={p.key} />
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#14315E] text-white"><Icon name={PILLAR_ICON[p.key]} size={26} /></div>
            <div className="mt-2 text-[22px] font-extrabold leading-6 text-[#14315E]">{p.key}</div>
            <div className="text-[14px] font-bold text-[#14315E]">{p.name}</div>
            <span className={`mt-2 inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS[p.status].tone}`}>{STATUS[p.status].label}</span>
            {p.key === "M" ? <div className="mt-1 text-[11px] italic text-[#64748b]">as modules today</div> : null}
          </div>
        ))}
      </div>

      <Journey />

      <div className="rounded-2xl border border-[#dbe6f7] bg-white p-5" data-testid="arch-stack">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div role="heading" aria-level={2} className="text-[16px] font-bold text-[#14315E]">The building blocks</div>
          <span className="text-[12px] text-[#64748b]">Click any block to see what it does · letters M A C H show the MACH pillar it serves</span>
        </div>
        <div className="mt-3 space-y-2">
          {LAYERS.map((l, idx) => (
            <div key={l.id} className="grid items-stretch gap-3 md:grid-cols-[190px_1fr]" data-testid={`arch-layer-${l.id}`}>
              <div className="flex items-center gap-3 rounded-xl px-3 py-3 text-white" style={{ background: `hsl(${215 + idx * 4} ${55 - idx * 3}% ${22 + idx * 3}%)` }}>
                <Icon name={l.icon} size={24} />
                <div><div className="text-[14px] font-bold leading-4">{l.title}</div><div className="text-[11px] text-white/75">{l.blurb}</div></div>
              </div>
              <div className="flex flex-wrap content-center gap-2 rounded-xl border border-[#e2e8f0] bg-[#f9fbff] p-3">
                {l.items.map((i) => (
                  <button key={i.name} type="button" onClick={() => setPicked(i)} aria-pressed={picked?.name === i.name} data-testid={`arch-item-${i.name}`} data-status={i.status}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${chipTone[i.status]} ${picked?.name === i.name ? "ring-2 ring-[#14315E] ring-offset-1" : ""}`}>
                    {i.name}
                    {(MACH_OF[i.name] ?? []).length ? <span className="rounded bg-black/15 px-1 text-[10px] font-extrabold">{(MACH_OF[i.name] ?? []).join("")}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 min-h-[84px] rounded-xl border border-[#c9d9f7] bg-[#f4f8ff] p-4" data-testid="arch-detail" aria-live="polite">
          {picked ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-bold text-[#14315E]">{picked.name}</div>
                <div className="text-[12px] font-semibold text-[#254e9e]">{picked.tech}</div>
                <p className="mt-1 max-w-2xl text-[13px] text-[#334155]">{picked.what}{picked.note ? ` ${picked.note}` : ""}</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${STATUS[picked.status].tone}`}>{STATUS[picked.status].label}</span>
            </div>
          ) : <p className="text-[13px] text-[#64748b]">Solid green blocks run in this demonstration. Amber blocks are simulated with the same rules. Dashed blocks are planned.</p>}
        </div>
      </div>
    </div>
  );
}
