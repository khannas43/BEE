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
    id: "channels", title: "Users and channels", icon: "devices", blurb: "Who uses the solution and how they reach it.",
    items: [
      { name: "Public portal", tech: "Next.js pages", what: "Public site, registration ID check, star label verification.", status: "built" },
      { name: "Partner and officer portal", tech: "Next.js, React 19", what: "Manufacturer, BEE Officer, Director, Finance, Programme, Reviewer and Admin work screens.", status: "built" },
      { name: "QR scan on a phone", tech: "QR codes, scan gateway", what: "A consumer or inspector scans a label and sees the star label check.", status: "built", note: "Demo gateway on the local network." },
      { name: "Existing BEE mobile app", tech: "Native mobile", what: "Connect the existing app to the verification and label services.", status: "planned" },
    ],
  },
  {
    id: "experience", title: "Experience layer", icon: "web", blurb: "What runs in the browser.",
    items: [
      { name: "Web application", tech: "Next.js 16 (App Router), React 19, TypeScript 5", what: "Server-rendered pages, client screens, route guards, role-based menus.", status: "built" },
      { name: "Design system", tech: "Tailwind CSS 3, Material Symbols", what: "One look across screens: cards, chips, collapsible boxes, tables, filters.", status: "built" },
      { name: "Documents, exports and labels", tech: "Browser PDF, Excel and QR generators", what: "Certificates, receipts, CSV and Excel downloads, printable star labels.", status: "built" },
      { name: "Generated forms and letters with e-sign", tech: "Versioned templates, e-sign", what: "Official templates, letter versions and digital signature.", status: "planned" },
    ],
  },
  {
    id: "api", title: "API and security layer", icon: "shield_lock", blurb: "How requests are authenticated, checked and routed.",
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
    id: "services", title: "Application services", icon: "hub", blurb: "The business modules behind the screens.",
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
    id: "data", title: "Data layer", icon: "database", blurb: "Where records, documents and analytics live.",
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
    id: "trust", title: "Trust and evidence layer", icon: "link", blurb: "What makes a record tamper-evident and a label verifiable.",
    items: [
      { name: "Certificate hash chain", tech: "SHA-256 chain in PostgreSQL", what: "Each record carries the previous record's fingerprint; MATCH or MISMATCH on every check.", status: "simulated", note: "Stands in for a blockchain network." },
      { name: "Permissioned blockchain", tech: "Hyperledger Fabric", what: "Certificate and revocation records replicated across organisations with agreed commits.", status: "planned" },
      { name: "Signed QR payloads", tech: "Digital signatures on QR content", what: "A label that proves its own origin offline.", status: "planned" },
      { name: "Anchoring", tech: "Merkle tree anchoring", what: "Periodic proof that the evidence set has not changed.", status: "planned" },
      { name: "Digital signature", tech: "eSign service", what: "Signed certificates and letters.", status: "planned" },
    ],
  },
  {
    id: "external", title: "External integrations", icon: "swap_horiz", blurb: "Systems outside the solution it connects to.",
    items: [
      { name: "Payment gateway", tech: "Government payment gateway", what: "Real fee collection and settlement.", status: "planned" },
      { name: "Email and SMS gateways", tech: "Messaging providers", what: "Real delivery of notices and OTPs.", status: "planned" },
      { name: "Company and tax verification", tech: "MCA and GSTN checks", what: "Verify CIN and GSTIN during registration.", status: "planned" },
      { name: "National ID and platforms", tech: "ID and national-platform interfaces", what: "Identity proofing and links to national services.", status: "planned" },
    ],
  },
  {
    id: "platform", title: "Platform and operations", icon: "construction", blurb: "How the solution is built, delivered and watched.",
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

function Card({ item }: { item: Item }) {
  const s = STATUS[item.status];
  return (
    <div className="rounded-xl border border-[#dbe6f7] bg-white p-4" data-testid={`arch-item-${item.name}`} data-status={item.status}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[14px] font-bold text-[#14315E]">{item.name}</div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.tone}`}><span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />{s.label}</span>
      </div>
      <div className="mt-1 text-[12px] font-semibold text-[#254e9e]">{item.tech}</div>
      <p className="mt-1 text-[12px] leading-4 text-[#475569]">{item.what}</p>
      {item.note ? <p className="mt-1 text-[11px] italic text-[#64748b]">{item.note}</p> : null}
    </div>
  );
}

function LayerBox({ layer, filter }: { layer: Layer; filter: Status | "all" }) {
  const [open, setOpen] = useState(true);
  const items = layer.items.filter((i) => filter === "all" || i.status === filter);
  if (items.length === 0) return null;
  return (
    <section className="rounded-2xl border border-[#dbe6f7] bg-[#f9fbff] p-5" data-testid={`arch-layer-${layer.id}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#14315E] text-white"><Icon name={layer.icon} size={20} /></span>
          <span><span role="heading" aria-level={2} className="block text-[16px] font-bold text-[#14315E]">{layer.title}</span><span className="block text-[12px] text-[#64748b]">{layer.blurb}</span></span>
        </span>
        <Icon name={open ? "expand_less" : "expand_more"} size={22} className="text-[#475569]" />
      </button>
      {open ? <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((i) => <Card key={i.name} item={i} />)}</div> : null}
    </section>
  );
}

export function ArchitecturePage() {
  const [filter, setFilter] = useState<Status | "all">("all");
  const all = LAYERS.flatMap((l) => l.items);
  const count = (s: Status) => all.filter((i) => i.status === s).length;
  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="architecture-page">
      <div>
        <h1 className="font-headline-md text-headline-md text-on-surface">Solution architecture</h1>
        <p className="mt-1 text-[14px] text-[#475569]">Every layer and component the solution is planned to use. What runs in this demonstration is marked <b>Built</b> or <b>Simulated</b>; the target stack that is not installed here is marked <b>Planned</b>.</p>
      </div>

      <div className="rounded-2xl border border-[#dbe6f7] bg-white p-5" data-testid="arch-flow">
        <div role="heading" aria-level={2} className="mb-3 text-[14px] font-bold text-[#14315E]">How a request travels (as built)</div>
        <ol className="flex flex-wrap items-stretch gap-2 text-[12px]">
          {[["Browser", "React screens, role menu"], ["Portal server (BFF)", "Session, contract checks"], ["Business API", "Spring Boot, rules, roles"], ["PostgreSQL", "Records, audit, hash chain"]].map(([name, sub], i, a) => (
            <li key={name} className="flex items-center gap-2">
              <span className="rounded-xl border border-[#c9d9f7] bg-[#f4f8ff] px-3 py-2"><b className="block text-[#14315E]">{name}</b><span className="text-[#64748b]">{sub}</span></span>
              {i < a.length - 1 ? <Icon name="arrow_forward" size={18} className="text-[#94a3b8]" /> : null}
            </li>
          ))}
          <li className="flex items-center gap-2 pl-2"><span className="text-[#94a3b8]">with</span><span className="rounded-xl border border-[#c9d9f7] bg-[#f4f8ff] px-3 py-2"><b className="block text-[#14315E]">Keycloak</b><span className="text-[#64748b]">Sign-in and roles</span></span></li>
        </ol>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Show">
        {([["all", `All components (${all.length})`], ["built", `Built (${count("built")})`], ["simulated", `Simulated (${count("simulated")})`], ["planned", `Planned (${count("planned")})`]] as [Status | "all", string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} data-testid={`arch-filter-${k}`}
            className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold ${filter === k ? "border-[#14315E] !bg-[#14315E] !text-white" : "border-[#dbe6f7] bg-white text-[#14315E]"}`}>{label}</button>
        ))}
        <span className="ml-auto flex flex-wrap items-center gap-3 text-[12px] text-[#64748b]">
          {(Object.keys(STATUS) as Status[]).map((s) => <span key={s} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${STATUS[s].dot}`} />{STATUS[s].label}</span>)}
        </span>
      </div>

      <div className="space-y-space-md">{LAYERS.map((l) => <LayerBox key={l.id} layer={l} filter={filter} />)}</div>
      <p className="text-[12px] text-[#64748b]">Planned components are the target catalogue for the full solution, not something installed in this demonstration. Simulated components follow the same rules as the real ones but use local stand-ins; no external system is contacted.</p>
    </div>
  );
}
