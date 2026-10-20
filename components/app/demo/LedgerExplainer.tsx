"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/Icon";

/**
 * "How the ledger works": a short explanation with a worked example the viewer can change. The example builds the same kind of text the
 * ledger fingerprints (previous hash, certificate details, kind, sequence) and shows its SHA-256 live, so changing one detail visibly
 * changes the whole code. Local demonstration: the example values are made up and are not read from a record.
 */

const GENESIS = "0".repeat(64);
const BASE = { prev: GENESIS, reg: "BEE/RAC/2026/10901", org: "Nova Cool Appliances Pvt Ltd", brand: "Nova Cool", model: "NC-RAC-S2A", category: "RAC", iseer: "4.05", validFrom: "2026-10-01", kind: "issue", seq: "1" };

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const line = (stars: string, validTo: string) => [BASE.prev, BASE.reg, BASE.org, BASE.brand, BASE.model, BASE.category, stars, BASE.iseer, BASE.validFrom, validTo, BASE.kind, BASE.seq].join("|");
const ORIGINAL = { stars: "4", validTo: "2029-09-30" };

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#14315E] text-[13px] font-bold text-white">{n}</span>
      <div><div className="text-[15px] font-bold text-[#14315E]">{title}</div><div className="mt-1 text-[13px] leading-5 text-[#334155]">{children}</div></div>
    </div>
  );
}

function ExplainerBody() {
  const [stars, setStars] = useState(ORIGINAL.stars);
  const [validTo, setValidTo] = useState(ORIGINAL.validTo);
  const [recorded, setRecorded] = useState("");
  const [now, setNow] = useState("");
  useEffect(() => {
    let live = true;
    void sha256(line(ORIGINAL.stars, ORIGINAL.validTo)).then((h) => { if (live) setRecorded(h); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    void sha256(line(stars, validTo)).then((h) => { if (live) setNow(h); });
    return () => { live = false; };
  }, [stars, validTo]);
  const match = recorded !== "" && now === recorded;
  const changed = stars !== ORIGINAL.stars || validTo !== ORIGINAL.validTo;
  const diffAt = recorded && now ? [...now].findIndex((c, i) => c !== recorded[i]) : -1;
  return (
    <div className="space-y-5">
      <Step n={1} title="Every certificate gets a fingerprint">
        When a certificate is put on the ledger, the system joins the certificate&apos;s details into one line of text (registration, brand, model, stars, validity and so on) and turns it into a 64-character code called a <b>hash</b>. The same details always give the same code. Change a single letter and the code becomes completely different.
      </Step>
      <Step n={2} title="Each record carries the one before it">
        The line of text also contains the <b>previous record&apos;s code</b>. So every record is tied to the one before, like links in a chain. The first record has nothing before it, so its &quot;previous hash&quot; is all zeros.
        <div className="mt-2 flex items-center gap-2 text-[11px]" aria-hidden>
          <span className="rounded-lg border border-[#c9d9f7] bg-[#f4f8ff] px-2 py-1 font-mono">Record 1<br />prev 0000…</span><span>→</span>
          <span className="rounded-lg border border-[#c9d9f7] bg-[#f4f8ff] px-2 py-1 font-mono">Record 2<br />prev = code of 1</span><span>→</span>
          <span className="rounded-lg border border-[#c9d9f7] bg-[#f4f8ff] px-2 py-1 font-mono">Record 3<br />prev = code of 2</span>
        </div>
      </Step>
      <Step n={3} title="Checking means recomputing">
        When you open a certificate, the system rebuilds the line from the details it holds now, recomputes the code and compares it with the code recorded. Same code: <b className="text-[#14532d]">MATCH</b>, nothing has changed since it was recorded. Different code, or a broken link: <b className="text-[#93000a]">MISMATCH</b>, the data is no longer what was recorded, and the screen says at which record it broke.
      </Step>

      <div className="rounded-xl border border-[#dbe6f7] bg-[#f9fbff] p-4" data-testid="ledger-explainer-example">
        <div className="text-[14px] font-bold text-[#14315E]">Try it: a worked example</div>
        <p className="mt-1 text-[12px] text-[#64748b]">Made-up certificate for this example. Change a detail and watch the code.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">Stars
            <select value={stars} onChange={(e) => setStars(e.target.value)} className="mt-1 block w-full rounded-lg border border-outline-variant bg-white px-3 py-2 text-[13px] normal-case tracking-normal" data-testid="ledger-explainer-stars">
              {["1", "2", "3", "4", "5"].map((s) => <option key={s} value={s}>{s}{s === ORIGINAL.stars ? " (as recorded)" : ""}</option>)}
            </select>
          </label>
          <label className="text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">Valid to
            <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className="mt-1 block w-full rounded-lg border border-outline-variant bg-white px-3 py-2 text-[13px] normal-case tracking-normal" data-testid="ledger-explainer-validto" />
          </label>
        </div>
        <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-[#64748b]">The line that is fingerprinted</div>
        <code className="mt-1 block break-all rounded-lg border border-[#e2e8f0] bg-white px-2 py-1.5 font-mono text-[11px] text-[#1e293b]" data-testid="ledger-explainer-line">{line(stars, validTo)}</code>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">Code recorded on the ledger</div><code className="mt-1 block break-all rounded-lg border border-[#e2e8f0] bg-white px-2 py-1.5 font-mono text-[11px]" data-testid="ledger-explainer-recorded">{recorded || "…"}</code></div>
          <div><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">Code recomputed now</div>
            <code className="mt-1 block break-all rounded-lg border border-[#e2e8f0] bg-white px-2 py-1.5 font-mono text-[11px]" data-testid="ledger-explainer-now">{now ? <>{now.slice(0, Math.max(0, diffAt))}<span className="bg-[#fdecea] text-[#93000a]">{now.slice(Math.max(0, diffAt))}</span></> : "…"}</code></div>
        </div>
        <div role="status" data-testid="ledger-explainer-verdict" className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-semibold ${match ? "border-[#b7e0c6] bg-[#e2f3e8] text-[#14532d]" : "border-[#f5c2c0] bg-[#fdecea] text-[#93000a]"}`}>
          <Icon name={match ? "verified" : "gpp_bad"} size={18} />
          {match ? "MATCH: the details are exactly as recorded." : "MISMATCH: the details changed after they were recorded, so the code no longer agrees."}
        </div>
        {changed ? <p className="mt-2 text-[12px] text-[#475569]">Only one detail changed, yet the whole code is different. That is why a quiet edit to a certificate cannot go unnoticed.</p> : <p className="mt-2 text-[12px] text-[#475569]">Now change the stars from 4 to 5, or the date, and watch the verdict.</p>}
      </div>

      <Step n={4} title="Two people, and no rewriting">
        A record is <b>submitted</b> by one person and must be <b>committed</b> by a different one. Committed records are never edited or deleted; a correction is a new record. This is a local simulation of the idea: in a real network, several organisations each keep a copy and agree on every new record.
      </Step>
    </div>
  );
}

export function LedgerExplainerButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-primary bg-white px-3 py-1.5 text-[13px] font-semibold text-primary" data-testid="ledger-how-button">
        <Icon name="help" size={16} /> How the ledger works
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <div role="dialog" aria-modal="true" aria-label="How the ledger works" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)} data-testid="ledger-how-dialog">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div><div role="heading" aria-level={2} className="text-[20px] font-extrabold text-[#14315E]">How the ledger works</div><div className="text-[12px] text-[#64748b]">A simulation of a secure evidence ledger, in plain words</div></div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-outline-variant bg-white px-3 py-1.5 text-[13px] font-semibold text-primary" data-testid="ledger-how-close" aria-label="Close">Close</button>
            </div>
            <ExplainerBody />
          </div>
        </div>, document.body) : null}
    </>
  );
}
