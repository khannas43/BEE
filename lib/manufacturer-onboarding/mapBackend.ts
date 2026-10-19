import { PROVISIONAL_COMPANY_REGISTRATION_FEE_INR, PROVISIONAL_COMPANY_REGISTRATION_FEE_LABEL } from "./fees";
import { annexureDocumentsFromHeads } from "./documentKinds";
import { annexureDisplayTitle, readAnnexureNotes } from "./documentPresentation";
import { normalizeManufacturerPhase } from "./phaseMapping";
import { emptyAuthorisedSignatory } from "./signatoryDefaults";
import type {
  AnomalyRecord,
  AutomatedCheck,
  ApplicantAccountRecord,
  AuthorisedSignatory,
  ManufacturerApplication,
  ManufacturerApplicationSummary,
  ManufacturerContact,
  ManufacturerDraft,
  ManufacturerFacility,
  ManufacturerLifecyclePhase,
  PaymentSummary,
  TimelineEvent,
} from "./types";

type BackendDraft = Record<string, unknown>;

export type BackendListItem = {
  id: string;
  reference: string;
  legalName: string;
  state: string;
  version: number;
  organisationId?: string;
  tradeLicenceUploaded?: boolean;
  permitteeNumber?: string;
  observationEndsOn?: string;
  createdAt?: string;
};

export type BackendDetail = BackendListItem & {
  draft?: BackendDraft;
  documents?: { documentKind: string; latestVersion: number; status: string; expiresOn?: string }[];
  automatedChecks?: { checkCode: string; outcome: string; checkedAt: string; detail?: string | null }[];
  lifecycle?: { eventKind: string; fromState: string | null; toState: string | null; actorRole: string; occurredAt: string; detail?: string | null }[];
  anomalies?: { raisedByRole: string; reason: string; raisedAt: string; resolution?: string | null; resolvedAt?: string | null }[];
  fee?: { amountInr: string; totalInr: string; feeRuleKey: string; feeRuleVersion: number };
  payment?: { paymentId: string; amountInr: string; receiptNumber: string; status: string; settledAt?: string };
  directorDecision?: { decision: string; note?: string | null; decidedAt: string };
  permitteeActivation?: { permitteeNumber: string; activatedAt: string };
  observation?: { startedOn: string; endsOn: string; closedAt?: string };
};

const emptyContact = (): ManufacturerContact => ({ name: "", email: "", phone: "", role: "" });

function dateToIsoStart(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function dateToIsoEnd(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCMilliseconds(d.getUTCMilliseconds() - 1);
  return d.toISOString();
}

function readAddress(draft: BackendDraft | undefined): ManufacturerDraft["registeredAddress"] {
  const raw = draft?.registeredAddress;
  if (!raw || typeof raw !== "object") {
    return { line1: "", line2: "", city: "", state: "", pincode: "" };
  }
  const a = raw as Record<string, string>;
  return {
    line1: a.line1 ?? "",
    line2: a.line2 ?? "",
    city: a.city ?? "",
    state: a.state ?? "",
    pincode: a.pincode ?? "",
  };
}

function readFacilities(draft: BackendDraft | undefined): ManufacturerFacility[] {
  const raw = draft?.facilities;
  if (!Array.isArray(raw)) return [];
  return raw.map((f, i) => {
    const row = f as Record<string, string>;
    return {
      id: row.id ?? `fac-${i + 1}`,
      name: row.name ?? "",
      addressLine: row.addressLine ?? row.line1 ?? "",
      city: row.city ?? "",
      state: row.state ?? "",
      pincode: row.pincode ?? "",
    };
  });
}

function readContact(raw: unknown): ManufacturerContact {
  if (!raw || typeof raw !== "object") return emptyContact();
  const c = raw as Record<string, string>;
  return {
    name: c.name ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    role: c.role ?? c.designation ?? "",
  };
}

function readApplicantAccount(raw: unknown): ApplicantAccountRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const username = typeof row.username === "string" ? row.username : "";
  const password = typeof row.password === "string" ? row.password : "";
  if (!username && !password) return null;
  return { username, password };
}

function readSignatory(raw: unknown): AuthorisedSignatory {
  const base = emptyAuthorisedSignatory();
  if (!raw || typeof raw !== "object") return base;
  const c = raw as Record<string, unknown>;
  const addrRaw = c.residentialAddress;
  let residentialAddress = base.residentialAddress;
  if (addrRaw && typeof addrRaw === "object") {
    const a = addrRaw as Record<string, string>;
    residentialAddress = {
      line1: a.line1 ?? "",
      line2: a.line2 ?? "",
      city: a.city ?? "",
      state: a.state ?? "",
      pincode: a.pincode ?? "",
    };
  }
  return {
    name: typeof c.name === "string" ? c.name : "",
    email: typeof c.email === "string" ? c.email : "",
    phone: typeof c.phone === "string" ? c.phone : "",
    role: typeof c.role === "string" ? c.role : typeof c.designation === "string" ? c.designation : "",
    pan: typeof c.pan === "string" ? c.pan : "",
    aadhaar: typeof c.aadhaar === "string" ? c.aadhaar : "",
    fatherName: typeof c.fatherName === "string" ? c.fatherName : typeof c.fathersName === "string" ? c.fathersName : "",
    din: typeof c.din === "string" ? c.din : "",
    residentialAddress,
  };
}

function mapDraft(body: BackendDetail): ManufacturerDraft {
  const draft = body.draft;
  const notes = readAnnexureNotes(draft?.annexureNotes);
  const documents = annexureDocumentsFromHeads(body.documents).map((d) => ({
    ...d,
    kind: annexureDisplayTitle(d.id, notes),
    customLabel: notes[d.id] ?? "",
  }));
  return {
    legalName: body.legalName ?? "",
    cin: typeof draft?.cin === "string" ? draft.cin : "",
    gstin: typeof draft?.gstin === "string" ? draft.gstin : "",
    registeredAddress: readAddress(draft),
    facilities: readFacilities(draft),
    contacts: Array.isArray(draft?.contacts) ? draft.contacts.map((c) => readContact(c)) : [],
    authorisedSignatory: readSignatory(draft?.authorisedSignatory),
    annexureDocuments: documents,
    annexureNotes: notes,
    applicantAccount: readApplicantAccount(draft?.applicantAccount),
    declarationAccepted: draft?.declarationAccepted === true,
    agreementAccepted: draft?.agreementAccepted === true,
  };
}

const CHECK_LABELS: Record<string, string> = {
  trade_licence_present: "Trade licence upload",
  annexure_complete: "Annexure 1 document completeness",
  eligibility_rules: "Eligibility rules (demonstration ruleset)",
  cin_format: "CIN format",
};

function mapChecks(checks: BackendDetail["automatedChecks"]): AutomatedCheck[] {
  return (checks ?? []).map((c) => ({
    id: c.checkCode,
    label: CHECK_LABELS[c.checkCode] ?? c.checkCode.replace(/_/g, " "),
    outcome: c.outcome === "pass" ? "pass" : c.outcome === "fail" ? "fail" : "pending",
    completedAt: c.checkedAt,
    detail: c.detail ?? "",
  }));
}

const EVENT_TITLES: Record<string, string> = {
  create: "Application created",
  submit: "Registration submitted",
  payment: "Payment recorded",
  automated_checks: "Automated checks completed",
  director_decision: "Director decision",
  activate: "Manufacturer activated",
  observation_start: "Observation started",
  raise_anomaly: "Anomaly raised",
  resolve_anomaly: "Anomaly resolved",
  patch: "Draft saved",
};

function mapTimeline(events: BackendDetail["lifecycle"]): TimelineEvent[] {
  return (events ?? []).map((e, i) => ({
    id: `lc-${i}-${e.eventKind}`,
    at: e.occurredAt,
    title: EVENT_TITLES[e.eventKind] ?? e.eventKind.replace(/_/g, " "),
    detail: e.detail ?? `${e.fromState ?? "—"} → ${e.toState ?? "—"} (${e.actorRole})`,
    icon: "history",
  }));
}

function mapAnomalies(rows: BackendDetail["anomalies"]): AnomalyRecord[] {
  return (rows ?? []).map((a, i) => ({
    id: `an-${a.raisedAt}-${i}`,
    raisedAt: a.raisedAt,
    raisedByRole: a.raisedByRole as AnomalyRecord["raisedByRole"],
    summary: a.reason,
    holdAppliedAt: a.raisedAt,
    resolvedAt: a.resolution === "cleared" ? a.resolvedAt ?? null : null,
    resolutionNote: a.resolution === "cleared" ? a.reason : null,
    revokedAt: a.resolution === "revoked" ? a.resolvedAt ?? null : null,
    revokeReason: a.resolution === "revoked" ? a.reason : null,
  }));
}

function mapPayment(body: BackendDetail): PaymentSummary {
  const feeAmount = body.fee?.amountInr ?? body.payment?.amountInr ?? PROVISIONAL_COMPANY_REGISTRATION_FEE_INR;
  return {
    feeLabel: PROVISIONAL_COMPANY_REGISTRATION_FEE_LABEL,
    amountInr: feeAmount,
    currency: "INR",
    gatewayMode: "simulated_demo",
    receiptNumber: body.payment?.receiptNumber ?? null,
    verifiedAt: body.payment?.settledAt ?? (body.payment?.status === "paid" ? body.payment?.settledAt ?? null : null),
  };
}

function observationInstants(body: BackendDetail): { started: string | null; ends: string | null } {
  if (body.observation) {
    return {
      started: dateToIsoStart(body.observation.startedOn),
      ends: dateToIsoEnd(body.observation.endsOn),
    };
  }
  if (body.observationEndsOn) {
    return { started: null, ends: dateToIsoEnd(body.observationEndsOn) };
  }
  return { started: null, ends: null };
}

export function mapBackendSummary(item: BackendListItem): ManufacturerApplicationSummary {
  const phase = normalizeManufacturerPhase(item.state) as ManufacturerLifecyclePhase;
  return {
    id: item.id,
    reference: item.reference,
    phase,
    version: item.version,
    legalName: item.legalName,
    draft: { ...mapDraft({ ...item, draft: {} }), legalName: item.legalName },
    registrationNumber: item.permitteeNumber ?? null,
    syntheticDemo: true,
  };
}

export function mapBackendDetail(body: BackendDetail): ManufacturerApplication {
  const phase = normalizeManufacturerPhase(body.state) as ManufacturerLifecyclePhase;
  const obs = observationInstants(body);
  const director = body.directorDecision;
  const permittee = body.permitteeActivation?.permitteeNumber ?? body.permitteeNumber ?? null;
  return {
    id: body.id,
    reference: body.reference,
    version: body.version,
    syntheticDemo: true,
    companyCode: permittee?.split("/")[0] ?? "—",
    phase,
    draft: mapDraft(body),
    payment: mapPayment(body),
    automatedChecks: mapChecks(body.automatedChecks),
    timeline: mapTimeline(body.lifecycle),
    directorDecisionAt: director?.decidedAt ?? null,
    directorDecisionNote: director?.note ?? (director?.decision === "reject" ? director?.note ?? null : director?.note ?? null),
    registrationNumber: permittee,
    activatedAt: body.permitteeActivation?.activatedAt ?? director?.decidedAt ?? null,
    observationStartedAt: obs.started,
    observationEndsAt: obs.ends,
    anomalies: mapAnomalies(body.anomalies),
    applicantAccountId: "",
  };
}

export function toBackendDraft(draft: ManufacturerDraft): Record<string, unknown> {
  return {
    cin: draft.cin,
    gstin: draft.gstin,
    declarationAccepted: draft.declarationAccepted,
    agreementAccepted: draft.agreementAccepted,
    registeredAddress: {
      line1: draft.registeredAddress.line1,
      line2: draft.registeredAddress.line2,
      city: draft.registeredAddress.city,
      state: draft.registeredAddress.state,
      pincode: draft.registeredAddress.pincode,
    },
    authorisedSignatory: {
      name: draft.authorisedSignatory.name,
      email: draft.authorisedSignatory.email,
      phone: draft.authorisedSignatory.phone,
      designation: draft.authorisedSignatory.role,
      pan: draft.authorisedSignatory.pan,
      aadhaar: draft.authorisedSignatory.aadhaar,
      fatherName: draft.authorisedSignatory.fatherName,
      din: draft.authorisedSignatory.din,
      residentialAddress: {
        line1: draft.authorisedSignatory.residentialAddress.line1,
        line2: draft.authorisedSignatory.residentialAddress.line2,
        city: draft.authorisedSignatory.residentialAddress.city,
        state: draft.authorisedSignatory.residentialAddress.state,
        pincode: draft.authorisedSignatory.residentialAddress.pincode,
      },
    },
    facilities: draft.facilities.map(({ name, addressLine, city, state, pincode }) => ({
      name,
      addressLine,
      city,
      state,
      pincode,
    })),
    contacts: draft.contacts,
    annexureNotes: draft.annexureNotes,
    ...(draft.applicantAccount
      ? {
          applicantAccount: {
            username: draft.applicantAccount.username,
            password: draft.applicantAccount.password,
          },
        }
      : {}),
  };
}
