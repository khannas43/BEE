import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentsDemo } from "@/components/app/demo/PaymentsDemo";
import { LedgerDemo } from "@/components/app/demo/LedgerDemo";
import { QrDemo } from "@/components/app/demo/QrDemo";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const BOM = "\uFEFF";

const tx = (over: object = {}) => ({
  id: "t1", certificateId: "c1", registrationId: "BEE/RAC/2026/10001", blockNo: 7, seq: 1, attempt: 1, kind: "issue", state: "pending",
  prevHash: "0".repeat(64), hash: "a".repeat(64), validTo: "2029-09-30", reason: null, failureReason: null, submittedBy: "BEE Secretary", decidedBy: null,
  seededNote: null, createdAt: "2026-10-15T10:00:00Z", committedAt: null, ...over,
});

function payments(n: number, reference: string) {
  return {
    id: `p${n}`, applicationId: `a${n}`, applicationReference: reference, organisationCode: "NOVA", amountInr: "11800.00", status: "paid" as const,
    gatewayRef: reference.includes("SKIP") ? "SIMGW-OTHER0001" : `SIMGW-KEEP${String(n).padStart(4, "0")}`, receiptNumber: `SIMRCPT-${n}`, feeConfirmed: false, createdAt: "2026-10-01T10:00:00Z",
  };
}

function certificate(n: number, brandName: string) {
  return {
    certificateId: `c${n}`, registrationId: `BEE/RAC/2026/${20000 + n}`, manufacturer: "Nova", brandName, modelNumber: n === 12 ? "ONLY-ON-PAGE-TWO" : "X",
    validTo: "2029-09-30", ledgerValidTo: "2029-09-30", ledgerStatus: "active", pendingKind: null, lastTx: tx({ id: `t${n}`, certificateId: `c${n}` }),
  };
}

function batch(n: number, brandName: string) {
  return {
    id: `b${n}`, reference: `BATCH-${n}`, brandName, modelNumber: n === 12 ? "ONLY-ON-PAGE-TWO" : "RAC-1", organisation: "Nova",
    registrationId: `BEE/RAC/2026/${30000 + n}`, quantity: 100, status: "open", createdAt: "2026-10-05T00:00:00Z", allocated: 10, bound: 20, void: 0, remaining: 70,
  };
}

function captureDownload() {
  const blobs: Blob[] = [];
  const names: string[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return "blob:csv";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  return { blobs, names };
}

async function exported(button: HTMLElement) {
  const captured = captureDownload();
  fireEvent.click(button);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  const bytes = new Uint8Array(await captured.blobs[0].arrayBuffer());
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  return { text, name: captured.names[0], bytes };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CSV exports", () => {
  it("downloads every payment row, and only the rows the search matches", async () => {
    const rows = [...Array.from({ length: 12 }, (_, i) => payments(i + 1, `DEMO-PAY-KEEP-${i + 1}`)), payments(13, "DEMO-PAY-SKIP")];
    vi.stubGlobal("fetch", vi.fn(async () => json({ view: "applicant", payments: rows, feeDue: [] })));
    render(<PaymentsDemo />);
    const button = await screen.findByTestId("list-export");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.textContent).toContain("Download CSV");
    const all = await exported(button);
    expect([...all.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(all.text.startsWith(`${BOM}Application,Organisation,Brand,Model,Amount INR,Status,Gateway reference,Receipt,Created`)).toBe(true);
    expect(all.name.startsWith("payments-")).toBe(true);
    expect(all.name.endsWith(".csv")).toBe(true);
    vi.restoreAllMocks();
    fireEvent.change(screen.getByTestId("list-search"), { target: { value: "KEEP" } });
    const filtered = await exported(screen.getByTestId("list-export"));
    expect(filtered.text).toContain("DEMO-PAY-KEEP-12");
    expect(filtered.text).not.toContain("DEMO-PAY-SKIP");
    expect(filtered.text.split("DEMO-PAY-KEEP-").length - 1).toBe(12);
  });

  it("downloads the certificate list, including matches past the first page", async () => {
    const certificates = [...Array.from({ length: 12 }, (_, i) => certificate(i + 1, "Harbor")), certificate(13, "Zephyr")];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url.endsWith("/transactions") ? { transactions: [tx()] } : url.endsWith("/c1") ? { ...certificates[0], stars: 4, validFrom: "2026-10-01", transactions: [tx()], events: [], verification: { result: "MATCH", firstBadSeq: null, detail: "ok", transactions: 1 }, actions: [] } : { certificates, readOnly: false };
      return json(body);
    }));
    render(<LedgerDemo />);
    await waitFor(() => expect(screen.getAllByTestId("list-export").length).toBeGreaterThan(0));
    const button = screen.getAllByTestId("list-export")[0];
    expect((button as HTMLButtonElement).disabled).toBe(false);
    const all = await exported(button);
    expect(all.text.startsWith(`${BOM}Registration ID,Brand,Model,Manufacturer,Ledger status,Valid to,Last transaction`)).toBe(true);
    expect(all.name.startsWith("ledger-certificates-")).toBe(true);
    expect(all.name.endsWith(".csv")).toBe(true);
    vi.restoreAllMocks();
    fireEvent.change(screen.getAllByTestId("list-search")[0], { target: { value: "Harbor" } });
    const filtered = await exported(screen.getAllByTestId("list-export")[0]);
    expect(filtered.text).toContain("ONLY-ON-PAGE-TWO");
    expect(filtered.text).toContain("BEE/RAC/2026/20012");
    expect(filtered.text).not.toContain("Zephyr");
  });

  it("downloads the QR batch list, including matches past the first page", async () => {
    const items = [...Array.from({ length: 12 }, (_, i) => batch(i + 1, "Lumen")), batch(13, "Zephyr")];
    vi.stubGlobal("fetch", vi.fn(async () => json({ canWrite: false, items, eligible: [] })));
    render(<QrDemo />);
    const button = await screen.findByTestId("list-export");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    const all = await exported(button);
    expect(all.text.startsWith(`${BOM}Reference,Brand,Model,Registration ID,Organisation,Quantity,Allocated,Bound,Void,Status,Created`)).toBe(true);
    expect(all.name.startsWith("qr-batches-")).toBe(true);
    expect(all.name.endsWith(".csv")).toBe(true);
    vi.restoreAllMocks();
    fireEvent.change(screen.getByTestId("list-search"), { target: { value: "Lumen" } });
    const filtered = await exported(screen.getByTestId("list-export"));
    expect(filtered.text).toContain("ONLY-ON-PAGE-TWO");
    expect(filtered.text).toContain("BEE/RAC/2026/30012");
    expect(filtered.text).not.toContain("Zephyr");
  });
});
