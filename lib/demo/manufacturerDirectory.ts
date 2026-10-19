/**
 * Demonstration directory for Manufacturer 360: synthetic manufacturers with the profile an officer would look at before a decision.
 * Not a BEE record. Live company registrations from the onboarding service are merged in by the screen (see Manufacturer360Directory).
 */

export type ComplianceStatus = "Compliant" | "Under observation" | "On hold" | "Registration pending";

export interface DirectoryModel {
  reference: string;
  model: string;
  category: string;
  stars: number;
  status: "Approved" | "Under review" | "Renewal due" | "Withdrawn";
  certificate: string;
  validTo: string;
}

export interface DirectoryPayment {
  receipt: string;
  date: string;
  purpose: string;
  amountInr: string;
  status: "Verified" | "Pending" | "Reconciled";
}

export interface DirectoryDocument {
  name: string;
  status: "Verified" | "Uploaded" | "Expiring soon" | "Missing";
  date: string;
}

export interface DirectoryAnomaly {
  date: string;
  raisedBy: string;
  summary: string;
  status: "Open" | "Cleared" | "Revoked";
}

export interface DirectoryEvent {
  date: string;
  title: string;
  detail: string;
}

export interface DirectoryFlag {
  level: "Info" | "Watch" | "Attention";
  label: string;
  detail: string;
}

export interface DirectoryManufacturer {
  id: string;
  /** Matches the sign-in organisation code, so a manufacturer sees only its own profile. */
  orgCode: string;
  name: string;
  status: ComplianceStatus;
  state: string;
  city: string;
  categories: string[];
  since: string;
  permitteeNumber: string;
  cin: string;
  gstin: string;
  address: string;
  signatory: { name: string; designation: string; email: string; phone: string };
  facilities: { name: string; location: string; capacity: string }[];
  brands: { name: string; status: "Active" | "Pending" | "Suspended"; categories: string }[];
  models: DirectoryModel[];
  fees: { paid: string; outstanding: string; payments: DirectoryPayment[] };
  qr: { issued: number; bound: number; unused: number };
  production: { period: string; declared: number; bound: number }[];
  documents: DirectoryDocument[];
  observation: { start: string; end: string; daysLeft: number } | null;
  anomalies: DirectoryAnomaly[];
  flags: DirectoryFlag[];
  timeline: DirectoryEvent[];
}

const doc = (name: string, status: DirectoryDocument["status"], date: string): DirectoryDocument => ({ name, status, date });
const ANNEXURE = (date: string, over: Partial<Record<string, DirectoryDocument["status"]>> = {}): DirectoryDocument[] =>
  [
    "Trade licence",
    "Certificate of incorporation",
    "GST certificate",
    "PAN card",
    "Signatory photo ID",
    "Facility address proof",
    "Signed declaration",
    "Signed agreement",
  ].map((n) => doc(n, over[n] ?? "Verified", date));

export const DIRECTORY: readonly DirectoryManufacturer[] = [
  {
    id: "nova-cool",
    orgCode: "NOVA",
    name: "Nova Cool Appliances Ltd.",
    status: "Compliant",
    state: "Delhi",
    city: "New Delhi",
    categories: ["RAC", "Refrigerator"],
    since: "12 Mar 2024",
    permitteeNumber: "PT-2024-00117",
    cin: "U29300DL2012PLC231045",
    gstin: "07AABCN4410K1ZP",
    address: "Plot 18, Okhla Industrial Estate Phase II, New Delhi 110020",
    signatory: { name: "Meera Sethi", designation: "Managing Director", email: "meera.sethi@novacool.example", phone: "98101 22034" },
    facilities: [
      { name: "Okhla Plant 1", location: "New Delhi, Delhi", capacity: "120,000 units / year" },
      { name: "Bawal Assembly Unit", location: "Rewari, Haryana", capacity: "80,000 units / year" },
    ],
    brands: [
      { name: "Nova Cool", status: "Active", categories: "RAC" },
      { name: "Nova Breeze Line", status: "Pending", categories: "RAC" },
    ],
    models: [
      { reference: "MOD-2026-10101", model: "NC-RAC-12D", category: "RAC", stars: 5, status: "Approved", certificate: "BEE/RAC/2026/10101", validTo: "30 Sep 2029" },
      { reference: "MOD-2026-10102", model: "NC-RAC-18S", category: "RAC", stars: 4, status: "Approved", certificate: "BEE/RAC/2026/10102", validTo: "30 Sep 2029" },
      { reference: "DEMO-Q-0001", model: "NC-RAC-QDIR-1", category: "RAC", stars: 4, status: "Under review", certificate: "Not issued", validTo: "-" },
      { reference: "MOD-2024-04410", model: "NC-RF-250", category: "Refrigerator", stars: 3, status: "Renewal due", certificate: "BEE/RF/2024/04410", validTo: "14 Jan 2027" },
    ],
    fees: {
      paid: "₹1,77,000",
      outstanding: "₹11,800",
      payments: [
        { receipt: "DEMO-PAY-0001", date: "02 Oct 2026", purpose: "Model application fee", amountInr: "₹11,800", status: "Verified" },
        { receipt: "DEMO-PAY-0002", date: "21 Sep 2026", purpose: "QR label units (prepayment)", amountInr: "₹1,41,600", status: "Reconciled" },
        { receipt: "DEMO-PAY-0003", date: "28 Sep 2026", purpose: "Model application fee", amountInr: "₹11,800", status: "Verified" },
        { receipt: "DEMO-PAY-0004", date: "09 Oct 2026", purpose: "Model application fee", amountInr: "₹11,800", status: "Pending" },
      ],
    },
    qr: { issued: 1240, bound: 892, unused: 348 },
    production: [
      { period: "Q1 2026", declared: 310, bound: 305 },
      { period: "Q2 2026", declared: 402, bound: 398 },
      { period: "Q3 2026", declared: 865, bound: 892 },
    ],
    documents: ANNEXURE("14 Mar 2024", { "Trade licence": "Expiring soon" }),
    observation: null,
    anomalies: [{ date: "03 Aug 2026", raisedBy: "BEE Finance", summary: "QR label fee reconciliation variance of 27 units, Q3.", status: "Cleared" }],
    flags: [
      { level: "Watch", label: "Production above bound serials", detail: "Q3 declared 865 units against 892 bound serials; variance within tolerance but trending up." },
      { level: "Info", label: "Renewal window open", detail: "Model NC-RF-250 certificate valid to 14 Jan 2027; renewal due within 90 days." },
    ],
    timeline: [
      { date: "09 Oct 2026", title: "Model application filed", detail: "DEMO-Q-0001 (NC-RAC-QDIR-1) sent for scrutiny." },
      { date: "02 Oct 2026", title: "Application fee verified", detail: "Receipt DEMO-PAY-0001, simulated gateway." },
      { date: "30 Sep 2026", title: "Certificates issued", detail: "BEE/RAC/2026/10101 and /10102 approved." },
      { date: "03 Aug 2026", title: "Anomaly cleared", detail: "QR reconciliation variance explained and cleared by the BEE Officer." },
      { date: "12 Mar 2024", title: "Registered and activated", detail: "Permittee PT-2024-00117, 15-day observation completed." },
    ],
  },
  {
    id: "aurora-air",
    orgCode: "PIXEL",
    name: "Aurora Air Systems Pvt Ltd",
    status: "Under observation",
    state: "Maharashtra",
    city: "Pune",
    categories: ["RAC"],
    since: "28 Sep 2026",
    permitteeNumber: "PT-2026-00441",
    cin: "U29190MH2019PTC322871",
    gstin: "27AAECA9981M1ZQ",
    address: "Gat No. 214, Chakan MIDC, Pune 410501",
    signatory: { name: "Rohan Deshpande", designation: "Director", email: "rohan@auroraair.example", phone: "98220 55871" },
    facilities: [{ name: "Chakan Plant", location: "Pune, Maharashtra", capacity: "60,000 units / year" }],
    brands: [{ name: "Aurora Air", status: "Active", categories: "RAC" }],
    models: [{ reference: "DEMO-Q-0004", model: "AU-RAC-QDIR", category: "RAC", stars: 5, status: "Under review", certificate: "Not issued", validTo: "-" }],
    fees: {
      paid: "₹5,000",
      outstanding: "₹0",
      payments: [{ receipt: "SIMRCPT-20260928-0002", date: "28 Sep 2026", purpose: "Company registration fee", amountInr: "₹5,000", status: "Verified" }],
    },
    qr: { issued: 0, bound: 0, unused: 0 },
    production: [],
    documents: ANNEXURE("26 Sep 2026"),
    observation: { start: "28 Sep 2026", end: "13 Oct 2026", daysLeft: 0 },
    anomalies: [],
    flags: [{ level: "Info", label: "Newly activated", detail: "Observation window ends 13 Oct 2026; no anomaly raised." }],
    timeline: [
      { date: "13 Oct 2026", title: "Observation window closing", detail: "No anomaly raised in 15 days." },
      { date: "28 Sep 2026", title: "Activated", detail: "Approved by the BEE Officer; permittee PT-2026-00441 issued." },
      { date: "26 Sep 2026", title: "Registration submitted", detail: "Payment verified and automated checks passed." },
    ],
  },
  {
    id: "lumen-frost",
    orgCode: "SYNTH-MFG-5",
    name: "Lumen Frost Industries",
    status: "Compliant",
    state: "Maharashtra",
    city: "Pune",
    categories: ["Refrigerator", "RAC"],
    since: "05 Jun 2023",
    permitteeNumber: "PT-2023-00208",
    cin: "U29120MH2010PLC201120",
    gstin: "27AABCL2201D1ZB",
    address: "B-44, Ranjangaon MIDC, Pune 412220",
    signatory: { name: "Anita Kulkarni", designation: "CEO", email: "anita@lumenfrost.example", phone: "98900 11200" },
    facilities: [{ name: "Ranjangaon Plant", location: "Pune, Maharashtra", capacity: "200,000 units / year" }],
    brands: [{ name: "Lumen Frost", status: "Active", categories: "Refrigerator, RAC" }],
    models: [
      { reference: "SYN-MA-0049", model: "LF-RF-310", category: "Refrigerator", stars: 4, status: "Approved", certificate: "BEE/RF/2025/91049", validTo: "11 Mar 2028" },
      { reference: "SYN-MA-0069", model: "LF-RF-420", category: "Refrigerator", stars: 5, status: "Under review", certificate: "Not issued", validTo: "-" },
    ],
    fees: {
      paid: "₹2,47,500",
      outstanding: "₹0",
      payments: [
        { receipt: "SYN-RCPT-N0049", date: "11 Mar 2025", purpose: "Model application fee", amountInr: "₹27,500", status: "Reconciled" },
        { receipt: "SYN-RCPT-N0069", date: "04 Jul 2026", purpose: "Model application fee", amountInr: "₹27,500", status: "Verified" },
      ],
    },
    qr: { issued: 5200, bound: 4980, unused: 220 },
    production: [
      { period: "Q1 2026", declared: 1210, bound: 1200 },
      { period: "Q2 2026", declared: 1380, bound: 1376 },
    ],
    documents: ANNEXURE("07 Jun 2023"),
    observation: null,
    anomalies: [],
    flags: [{ level: "Info", label: "Clean record", detail: "No anomalies or discrepancies in 40 months." }],
    timeline: [
      { date: "04 Jul 2026", title: "Model application filed", detail: "SYN-MA-0069 (LF-RF-420)." },
      { date: "11 Mar 2025", title: "Certificate issued", detail: "BEE/RF/2025/91049." },
      { date: "05 Jun 2023", title: "Registered and activated", detail: "Permittee PT-2023-00208." },
    ],
  },
  {
    id: "harbor-breeze",
    orgCode: "SYNTH-MFG-4",
    name: "Harbor Breeze Appliances",
    status: "Compliant",
    state: "Tamil Nadu",
    city: "Chennai",
    categories: ["RAC"],
    since: "19 Nov 2022",
    permitteeNumber: "PT-2022-00951",
    cin: "U29190TN2015PTC101322",
    gstin: "33AAGCH5501B1Z9",
    address: "Sipcot Industrial Park, Sriperumbudur, Chennai 602105",
    signatory: { name: "K. Ramanathan", designation: "Director", email: "ramanathan@harborbreeze.example", phone: "98400 33120" },
    facilities: [{ name: "Sriperumbudur Plant", location: "Chennai, Tamil Nadu", capacity: "90,000 units / year" }],
    brands: [{ name: "Harbor Breeze", status: "Active", categories: "RAC" }],
    models: [{ reference: "SYN-MA-0004", model: "HB-RAC-15", category: "RAC", stars: 3, status: "Under review", certificate: "Not issued", validTo: "-" }],
    fees: { paid: "₹88,500", outstanding: "₹0", payments: [{ receipt: "SYN-RCPT-N0004", date: "20 Sep 2026", purpose: "Model application fee", amountInr: "₹27,500", status: "Verified" }] },
    qr: { issued: 2100, bound: 2015, unused: 85 },
    production: [{ period: "Q2 2026", declared: 640, bound: 636 }],
    documents: ANNEXURE("21 Nov 2022"),
    observation: null,
    anomalies: [],
    flags: [],
    timeline: [
      { date: "20 Sep 2026", title: "Model application filed", detail: "SYN-MA-0004 (HB-RAC-15)." },
      { date: "19 Nov 2022", title: "Registered and activated", detail: "Permittee PT-2022-00951." },
    ],
  },
  {
    id: "cinder-peak",
    orgCode: "SYNTH-MFG-6",
    name: "Cinder Peak Appliances Pvt Ltd",
    status: "On hold",
    state: "Telangana",
    city: "Hyderabad",
    categories: ["RAC"],
    since: "02 Feb 2025",
    permitteeNumber: "PT-2025-00133",
    cin: "U29190TG2017PTC118840",
    gstin: "36AAICC3380H1ZD",
    address: "Plot 9, Fab City, Maheshwaram, Hyderabad 501359",
    signatory: { name: "Imran Siddiqui", designation: "Managing Director", email: "imran@cinderpeak.example", phone: "99890 44120" },
    facilities: [{ name: "Fab City Unit", location: "Hyderabad, Telangana", capacity: "45,000 units / year" }],
    brands: [{ name: "Cinder Peak", status: "Suspended", categories: "RAC" }],
    models: [{ reference: "SYN-MA-0089", model: "CP-RAC-12", category: "RAC", stars: 3, status: "Under review", certificate: "Not issued", validTo: "-" }],
    fees: { paid: "₹56,000", outstanding: "₹27,500", payments: [{ receipt: "SYN-RCPT-N0089", date: "02 Oct 2026", purpose: "Model application fee", amountInr: "₹27,500", status: "Pending" }] },
    qr: { issued: 900, bound: 410, unused: 490 },
    production: [{ period: "Q2 2026", declared: 505, bound: 410 }],
    documents: ANNEXURE("04 Feb 2025", { "Trade licence": "Expiring soon", "Facility address proof": "Missing" }),
    observation: null,
    anomalies: [{ date: "06 Oct 2026", raisedBy: "BEE Finance", summary: "Production declared exceeds bound QR serials by 95 units; label fee not reconciled.", status: "Open" }],
    flags: [
      { level: "Attention", label: "Declared production exceeds QR serials", detail: "505 units declared against 410 bound serials in Q2." },
      { level: "Attention", label: "Facility address proof missing", detail: "Document not on file after the last facility change." },
    ],
    timeline: [
      { date: "06 Oct 2026", title: "Anomaly raised and hold applied", detail: "Registration placed on hold pending BEE Officer decision." },
      { date: "02 Oct 2026", title: "Model application filed", detail: "SYN-MA-0089 (CP-RAC-12)." },
      { date: "02 Feb 2025", title: "Registered and activated", detail: "Permittee PT-2025-00133." },
    ],
  },
  {
    id: "marigold-air",
    orgCode: "SYNTH-MFG-7",
    name: "Marigold Air Pvt Ltd",
    status: "Under observation",
    state: "Gujarat",
    city: "Ahmedabad",
    categories: ["RAC", "Ceiling fan"],
    since: "08 Oct 2026",
    permitteeNumber: "PT-2026-00462",
    cin: "U29190GJ2020PTC114052",
    gstin: "24AAGCM7712P1ZV",
    address: "Survey 77, Sanand GIDC, Ahmedabad 382110",
    signatory: { name: "Pooja Shah", designation: "Director", email: "pooja@marigoldair.example", phone: "98250 66003" },
    facilities: [{ name: "Sanand Plant", location: "Ahmedabad, Gujarat", capacity: "70,000 units / year" }],
    brands: [{ name: "Marigold Air", status: "Active", categories: "RAC, Ceiling fan" }],
    models: [],
    fees: { paid: "₹5,000", outstanding: "₹0", payments: [{ receipt: "SIMRCPT-20261006-0007", date: "06 Oct 2026", purpose: "Company registration fee", amountInr: "₹5,000", status: "Verified" }] },
    qr: { issued: 0, bound: 0, unused: 0 },
    production: [],
    documents: ANNEXURE("06 Oct 2026"),
    observation: { start: "08 Oct 2026", end: "23 Oct 2026", daysLeft: 4 },
    anomalies: [],
    flags: [{ level: "Info", label: "Observation in progress", detail: "4 days remaining; no anomaly so far." }],
    timeline: [
      { date: "08 Oct 2026", title: "Activated", detail: "Approved by the BEE Officer; permittee PT-2026-00462." },
      { date: "06 Oct 2026", title: "Registration submitted", detail: "Payment verified; 17 of 17 automated checks passed." },
    ],
  },
  {
    id: "northwind-comfort",
    orgCode: "SYNTH-MFG-8",
    name: "Northwind Comfort Technologies",
    status: "Compliant",
    state: "Karnataka",
    city: "Bengaluru",
    categories: ["RAC", "Refrigerator", "Ceiling fan"],
    since: "17 Jan 2022",
    permitteeNumber: "PT-2022-00087",
    cin: "U29300KA2009PLC050771",
    gstin: "29AAACN1189Q1ZX",
    address: "Peenya Industrial Area, 2nd Stage, Bengaluru 560058",
    signatory: { name: "Vikram Rao", designation: "Chief Executive Officer", email: "vikram@northwind.example", phone: "98450 77120" },
    facilities: [
      { name: "Peenya Plant", location: "Bengaluru, Karnataka", capacity: "150,000 units / year" },
      { name: "Hosur Unit", location: "Krishnagiri, Tamil Nadu", capacity: "100,000 units / year" },
    ],
    brands: [
      { name: "Northwind", status: "Active", categories: "RAC, Refrigerator" },
      { name: "Northwind Lite", status: "Active", categories: "Ceiling fan" },
    ],
    models: [
      { reference: "SYN-MA-0001", model: "NW-RAC-20", category: "RAC", stars: 5, status: "Approved", certificate: "BEE/RAC/2025/90011", validTo: "02 Apr 2028" },
      { reference: "SYN-MA-0002", model: "NW-RF-300", category: "Refrigerator", stars: 4, status: "Approved", certificate: "BEE/RF/2025/90012", validTo: "02 Apr 2028" },
      { reference: "SYN-MA-0003", model: "NW-CF-1200", category: "Ceiling fan", stars: 5, status: "Approved", certificate: "BEE/CF/2025/90013", validTo: "02 Apr 2028" },
    ],
    fees: {
      paid: "₹4,12,000",
      outstanding: "₹0",
      payments: [
        { receipt: "SYN-RCPT-N0001", date: "02 Apr 2025", purpose: "Model application fee", amountInr: "₹27,500", status: "Reconciled" },
        { receipt: "SYN-RCPT-N0002", date: "02 Apr 2025", purpose: "Model application fee", amountInr: "₹27,500", status: "Reconciled" },
        { receipt: "SYN-RCPT-N0003", date: "02 Apr 2025", purpose: "Model application fee", amountInr: "₹27,500", status: "Reconciled" },
      ],
    },
    qr: { issued: 12000, bound: 11620, unused: 380 },
    production: [
      { period: "Q1 2026", declared: 2800, bound: 2790 },
      { period: "Q2 2026", declared: 3150, bound: 3142 },
    ],
    documents: ANNEXURE("19 Jan 2022"),
    observation: null,
    anomalies: [],
    flags: [{ level: "Info", label: "Largest producer in the demonstration set", detail: "Three categories, three approved models, no open items." }],
    timeline: [
      { date: "02 Apr 2025", title: "Three certificates issued", detail: "NW-RAC-20, NW-RF-300 and NW-CF-1200 approved." },
      { date: "17 Jan 2022", title: "Registered and activated", detail: "Permittee PT-2022-00087." },
    ],
  },
];

export const STATUS_FILTERS: readonly ComplianceStatus[] = ["Compliant", "Under observation", "On hold", "Registration pending"];
