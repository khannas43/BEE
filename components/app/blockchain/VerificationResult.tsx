"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Stars } from "@/components/ui/Stars";
import { VerifyScenario, maskHash, maskTx, SIM_LABEL_TEXT } from "@/lib/mock/certificate";

/* ================================================================== *
 * Shared verification result with ledger proof (sections 9 & 11).
 * Used by public label verification (masked) and authenticated
 * certificate verification (full values).
 * ================================================================== */

type Tone = "positive" | "warn" | "bad" | "neutral";
const BANNER: Record<Tone, string> = {
  positive: "bg-success text-on-success",
  warn: "bg-solar-gold-light text-solar-gold-dark",
  bad: "bg-error-container text-on-error-container",
  neutral: "bg-surface-container text-on-surface",
};

function verdict(s: VerifyScenario): { tone: Tone; icon: string; title: string; sub: string } {
  switch (s.id) {
    case "active": return { tone: "positive", icon: "verified", title: "Verified: the current certificate hash matches the ledger record.", sub: "The certificate is genuine and currently active." };
    case "expired": return { tone: "warn", icon: "schedule", title: "Certificate expired", sub: "Genuine certificate, but its validity period has ended." };
    case "suspended": return { tone: "warn", icon: "pause_circle", title: "Certificate suspended", sub: "Genuine, but temporarily suspended — not currently valid." };
    case "revoked": return { tone: "bad", icon: "gpp_bad", title: "Certificate revoked — do not trust this certificate.", sub: "The label has been revoked by BEE. Its ledger record is retained for history." };
    case "superseded": return { tone: "warn", icon: "layers", title: "Superseded by a newer version", sub: `A newer certificate version exists${s.supersededBy ? ` — ${s.supersededBy}` : ""}.` };
    case "mismatch": return { tone: "bad", icon: "gpp_bad", title: "Verification failed: the current certificate does not match the ledger record. Do not trust this certificate.", sub: "The computed hash differs from the anchored hash — possible tampering." };
    case "ledger-down": return { tone: "neutral", icon: "cloud_off", title: "Verification could not be completed. Please retry later.", sub: "The ledger is temporarily unavailable." };
    case "pending": return { tone: "warn", icon: "hourglass_top", title: "Verification pending — certificate not yet anchored", sub: "This registration exists, but its certificate has not yet been confirmed on the blockchain ledger. Authenticity cannot be confirmed at this time — please check again later." };
    case "not-found": return { tone: "bad", icon: "search_off", title: "Registration not found", sub: "This ID is not in the BEE register. Do not trust the label." };
  }
}

export function VerificationResult({ scenario, mode }: { scenario: VerifyScenario; mode: "public" | "authorised" }) {
  const [proofOpen, setProofOpen] = useState(mode === "authorised");
  const v = verdict(scenario);
  const showCert = scenario.id !== "not-found" && scenario.id !== "ledger-down" && scenario.id !== "pending";
  const matched = scenario.currentHash && scenario.ledgerHash ? scenario.currentHash === scenario.ledgerHash : null;
  const showVal = (h?: string, masker?: (x: string) => string) => (h ? (mode === "public" && masker ? masker(h) : h) : "—");

  return (
    <div className="bg-surface-card rounded-xl shadow-md overflow-hidden">
      {/* Verdict banner */}
      <div className={`px-space-lg py-space-md flex items-start gap-space-sm ${BANNER[v.tone]}`}>
        <Icon name={v.icon} size={28} fill className="shrink-0" />
        <div>
          <div className="font-title-lg text-title-lg font-semibold leading-snug">{v.title}</div>
          {v.sub && <div className="font-body-sm text-body-sm opacity-90 mt-0.5">{v.sub}</div>}
        </div>
      </div>

      {scenario.id === "pending" && (
        <div className="p-space-lg">
          <div className="bg-surface-container-low rounded-lg p-space-md space-y-1.5">
            <div className="font-label-sm text-label-sm text-on-surface-variant">On record (pending anchor)</div>
            <div className="flex items-center justify-between gap-space-sm"><span className="font-label-sm text-label-sm text-on-surface-variant">Registration ID</span><span className="font-mono text-label-md text-on-surface">{scenario.regId}</span></div>
            {scenario.manufacturer && <div className="flex items-center justify-between gap-space-sm"><span className="font-label-sm text-label-sm text-on-surface-variant">Applicant</span><span className="font-label-md text-label-md text-on-surface">{scenario.manufacturer}</span></div>}
            {scenario.model && <div className="flex items-center justify-between gap-space-sm"><span className="font-label-sm text-label-sm text-on-surface-variant">Model</span><span className="font-label-md text-label-md text-on-surface">{scenario.model}</span></div>}
            <div className="flex items-center justify-between gap-space-sm"><span className="font-label-sm text-label-sm text-on-surface-variant">Ledger anchor</span><span className="font-label-md text-label-md text-solar-gold-dark">Awaiting confirmation</span></div>
          </div>
        </div>
      )}

      {showCert && (
        <div className="p-space-lg space-y-space-md">
          {/* Certificate facts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-lg">
            <div>
              <span className="font-label-sm text-label-sm text-secondary font-bold uppercase">{scenario.manufacturer}</span>
              <h2 className="font-headline-sm text-headline-sm text-on-surface">{scenario.model}</h2>
              <div className="font-label-sm text-label-sm font-mono text-on-surface-variant mt-1">{scenario.regId}</div>
              <div className="mt-space-sm flex items-center gap-space-sm">
                {scenario.stars ? <Stars value={scenario.stars} size={20} /> : null}
                <StatusChip id={scenario.id} status={scenario.status} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-space-sm">
              <Fact k="Certificate version" v={scenario.version ? `v${scenario.version}` : "—"} />
              <Fact k="Issuer" v="Bureau of Energy Efficiency" />
              <Fact k="Valid from" v={scenario.validFrom ?? "—"} />
              <Fact k="Valid to" v={scenario.validTo ?? "—"} />
            </div>
          </div>

          {/* Ledger proof (expandable) */}
          <div className="border border-border-subtle rounded-lg overflow-hidden">
            <button type="button" onClick={() => setProofOpen((o) => !o)} className="w-full flex items-center gap-space-sm px-space-md py-space-sm bg-surface-container-low hover:bg-surface-container text-left">
              <Icon name="account_tree" size={18} className="text-primary" />
              <span className="flex-1 font-label-md text-label-md text-on-surface font-semibold">View ledger proof</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">{SIM_LABEL_TEXT}</span>
              <Icon name={proofOpen ? "expand_less" : "expand_more"} size={18} className="text-on-surface-variant" />
            </button>
            {proofOpen && (
              <div className="p-space-md space-y-space-sm">
                {matched !== null && (
                  <div className={`flex items-center gap-space-sm rounded-lg p-space-sm font-label-md text-label-md font-semibold ${matched ? "bg-success-light text-success" : "bg-error-container text-on-error-container"}`}>
                    <Icon name={matched ? "check_circle" : "error"} size={18} fill /> Hash comparison: {matched ? "MATCH — current hash equals ledger hash" : "MISMATCH — current hash differs from ledger hash"}
                  </div>
                )}
                <ProofRow k="Current certificate hash (SHA-256)" v={showVal(scenario.currentHash, maskHash)} />
                <ProofRow k="Anchored ledger hash" v={showVal(scenario.ledgerHash, maskHash)} />
                <ProofRow k="Ledger transaction ID" v={scenario.tx ? (mode === "public" ? maskTx(scenario.tx.txId) : scenario.tx.txId) : "—"} />
                <ProofRow k="Block number" v={scenario.tx ? `#${scenario.tx.blockNumber.toLocaleString("en-IN")}` : "—"} />
                <ProofRow k="Ledger timestamp" v={scenario.tx ? new Date(scenario.tx.timestamp).toLocaleString("en-IN") : "—"} />
                {mode === "public" && <p className="font-label-sm text-label-sm text-on-surface-variant">Hash and transaction values are masked for public view. Authorised officers see the complete values.</p>}
                <Link href={mode === "authorised" ? "/app/registrations/record" : "/verify"} className="inline-flex items-center gap-1 font-label-sm text-label-sm text-primary hover:underline">
                  <Icon name="history" size={14} /> View version history — prior versions existed
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {scenario.id === "ledger-down" && (
        <div className="p-space-lg">
          <div className="flex items-start gap-space-sm bg-surface-container-low rounded-lg p-space-md">
            <Icon name="info" size={18} className="text-on-surface-variant shrink-0 mt-0.5" />
            <p className="font-body-sm text-body-sm text-on-surface">The certificate is <span className="font-semibold">not</span> shown as verified while the ledger cannot be reached. Please retry in a few moments.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusChip({ id, status }: { id: string; status?: string }) {
  const tone = id === "active" ? "bg-success-light text-success"
    : id === "revoked" || id === "mismatch" ? "bg-error-container text-on-error-container"
    : "bg-solar-gold-light text-solar-gold-dark";
  // A tampered certificate must never show an "Active"/verified badge.
  const label = id === "mismatch" ? "Suspected Tampering" : (status ?? id);
  return <span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm font-bold ${tone}`}>{label}</span>;
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-surface-container-low rounded-lg p-space-sm">
      <div className="font-label-sm text-label-sm text-on-surface-variant">{k}</div>
      <div className="font-title-sm text-title-sm text-on-surface font-bold">{v}</div>
    </div>
  );
}

function ProofRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-space-sm">
      <span className="font-label-sm text-label-sm text-on-surface-variant shrink-0">{k}</span>
      <span className="font-mono text-label-sm text-on-surface break-all text-right">{v}</span>
    </div>
  );
}
