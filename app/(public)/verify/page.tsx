"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Icon } from "@/components/ui/Icon";
import { APPLIANCES, Appliance } from "@/lib/mock/appliances";
import { VerificationResult } from "@/components/app/blockchain/VerificationResult";
import { VERIFY_SCENARIOS, VerifyScenario, VerifyOutcome, PRIMARY_CERT, pendingScenarioForReg } from "@/lib/mock/certificate";
import { readCertState } from "@/components/app/blockchain/CertificateStore";

/** Live scenario for the demo certificate from the shared store (reflects amend/revoke/ledger status). */
function scenarioFromStore(): VerifyScenario {
  const st = readCertState();
  const base = { regId: PRIMARY_CERT.regId, manufacturer: PRIMARY_CERT.manufacturer, model: PRIMARY_CERT.model, stars: PRIMARY_CERT.stars, validFrom: PRIMARY_CERT.validFrom, validTo: PRIMARY_CERT.validTo };
  if (!st.ledgerAvailable) return { id: "ledger-down", label: "Ledger unavailable", ...base };
  const cur = st.versions.find((v) => v.version === st.currentVersion);
  if (!cur || st.issuance !== "ACTIVE" && st.versions.length === 0) return { id: "not-found", label: "Not issued", regId: PRIMARY_CERT.regId };
  if (!cur) return { id: "not-found", label: "Not issued", regId: PRIMARY_CERT.regId };
  const outcome: VerifyOutcome =
    cur.status === "Revoked" ? "revoked" : cur.status === "Superseded" ? "superseded" :
    cur.status === "Suspended" ? "suspended" : cur.status === "Expired" ? "expired" : "active";
  return {
    ...base, id: outcome, label: cur.status, status: cur.status, version: cur.version,
    currentHash: cur.hash, ledgerHash: cur.hash,
    tx: { txId: cur.txId, blockNumber: cur.block, timestamp: cur.ledgerTs, status: "Confirmed" },
  };
}

/** deterministic 64-hex pseudo-hash so appliance matches also show ledger proof */
function pseudoHash(seed: string): string {
  let h = 2166136261;
  let out = "";
  for (let i = 0; i < 64; i++) {
    h ^= seed.charCodeAt(i % seed.length) + i * 131;
    h = Math.imul(h, 16777619);
    out += ((h >>> (i % 28)) & 15).toString(16);
  }
  return out;
}

function fromAppliance(a: Appliance): VerifyScenario {
  const h = pseudoHash(a.regId);
  return {
    id: "active", label: "Active", regId: a.regId, manufacturer: a.brand, model: a.model, stars: a.stars,
    status: "Active", validFrom: a.validFrom, validTo: a.validTo, version: 1,
    currentHash: h, ledgerHash: h,
    tx: { txId: pseudoHash(a.regId + "-tx"), blockNumber: 180000 + (a.regId.length * 37), timestamp: "2026-02-01T08:30:00Z", status: "Confirmed" },
  };
}

function VerifyInner() {
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("reg") ?? "");
  const [scenario, setScenario] = useState<VerifyScenario | null>(null);

  const [dynamic, setDynamic] = useState<Appliance[]>([]);

  const resolve = useCallback((q: string) => {
    const norm = q.trim().toLowerCase();
    if (!norm) { setScenario(null); return; }
    // the live demo certificate reflects the shared store (amend / revoke / ledger status)
    if (norm === PRIMARY_CERT.regId.toLowerCase()) { setScenario(scenarioFromStore()); return; }
    // other reg ids → static demonstration scenarios
    const sc = VERIFY_SCENARIOS.find((s) => s.regId.toLowerCase() === norm && s.id !== "revoked" && s.id !== "ledger-down");
    if (sc) { setScenario(sc); return; }
    // appliance / dynamic model match → synthesise an active result
    const all = [...APPLIANCES, ...dynamic];
    const a = all.find((x) => x.regId.toLowerCase() === norm);
    if (a) { setScenario(fromAppliance(a)); return; }
    // registration exists but its certificate is not yet anchored → pending
    // (same reconciliation fixture the monitoring view reads), never "not found"
    const pending = pendingScenarioForReg(norm);
    if (pending) { setScenario(pending); return; }
    setScenario({ id: "not-found", label: "Not found", regId: q });
  }, [dynamic]);

  useEffect(() => {
    startTransition(() => {
      try {
        const life = JSON.parse(localStorage.getItem("bee-lifecycle-v1") || "[]");
        setDynamic(
          life
            .filter((a: { stage: string; regId?: string }) => a.stage === "active" && a.regId)
            .map((a: { brand: string; model: string; regId: string; rating?: number; declaredIseer: number; capacityW: number }): Appliance => ({
              regId: a.regId, brand: a.brand, model: a.model, category: "Room ACs", stars: a.rating ?? 5,
              iseer: a.declaredIseer, annualKwh: Math.round((a.capacityW / (a.declaredIseer || 5)) * 1600 / 1000),
              capacityW: a.capacityW, validFrom: "Jan 2026", validTo: "Dec 2028", features: [],
            })),
        );
      } catch {
        /* ignore */
      }
    });
  }, []);

  useEffect(() => {
    const reg = params.get("reg");
    if (reg) startTransition(() => resolve(reg));
  }, [params, resolve]);

  function pickScenario(s: VerifyScenario) { setQuery(s.regId); setScenario(s); }

  return (
    <div className="max-w-4xl mx-auto px-gutter py-space-2xl">
      <div className="text-center mb-space-xl">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-forest-light text-forest-dark font-label-sm text-label-sm uppercase tracking-wider mb-space-sm">
          <Icon name="verified_user" size={16} fill /> Public Authenticity Check
        </div>
        <h1 className="font-headline-xl text-headline-xl text-on-surface">Verify a BEE Star Label</h1>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-2 max-w-2xl mx-auto">
          Scan the QR or enter the BEE Registration ID. We confirm the model, star rating and certificate validity, and compare the certificate against the blockchain ledger record.
        </p>
      </div>

      <div className="bg-surface-card rounded-xl shadow-md p-space-lg">
        <div className="flex flex-col sm:flex-row gap-space-sm">
          <div className="flex-1 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-outline"><Icon name="qr_code_scanner" /></div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && resolve(query)}
              placeholder="Enter Registration ID e.g. BEE/RAC/2026/10016"
              aria-label="BEE Registration ID"
              className="w-full pl-10 pr-4 py-3 rounded-lg bg-surface-container-low font-body-md text-body-md outline-none focus:bg-surface-card shadow-inner"
            />
          </div>
          <button onClick={() => resolve(query)} type="button" className="bg-primary text-on-primary px-space-lg py-3 rounded-lg font-label-lg text-label-lg flex items-center justify-center gap-2 hover:bg-forest-dark transition-all">
            <Icon name="search" size={18} /> Verify
          </button>
        </div>

        {/* Demo scenario chips */}
        <div className="mt-space-md">
          <div className="font-label-sm text-label-sm text-on-surface-variant mb-1.5">Try a demonstration scenario:</div>
          <div className="flex flex-wrap gap-1.5">
            {VERIFY_SCENARIOS.map((s) => (
              <button key={s.id} type="button" onClick={() => pickScenario(s)}
                className={`px-2.5 py-1 rounded-full font-label-sm text-label-sm border transition-colors ${scenario?.id === s.id && scenario?.regId === s.regId ? "bg-primary text-on-primary border-primary" : "bg-surface-container-low text-on-surface border-border-subtle hover:bg-forest-light"}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {scenario && (
        <div className="mt-space-lg">
          <VerificationResult scenario={scenario} mode="public" />
        </div>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="max-w-4xl mx-auto px-gutter py-space-2xl">Loading…</div>}>
      <VerifyInner />
    </Suspense>
  );
}
