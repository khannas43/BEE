"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { confirmPay, errorText, getCaptcha, startPay, verifyPay, type Captcha, type PayResult } from "@/lib/client/agencyRegistration";
import { PAYMENT_METHOD_LABELS, inr } from "@/lib/manufacturer-onboarding/sopDefaults";

/** Pay Registration Fee (SOP 1.1, option B): Reference ID and captcha, a 3-minute verification code, the payment, then the sign-in details. Local demonstration. */
type Summary = Awaited<ReturnType<typeof verifyPay>> extends infer R ? (R extends { ok: true; value: infer V } ? V : never) : never;
type Method = keyof typeof PAYMENT_METHOD_LABELS;
const box = "rounded-2xl border border-border-subtle bg-surface-container-lowest p-space-lg space-y-3";
const input = "mt-1 block w-full max-w-xs rounded-lg border border-outline-variant px-3 py-2 text-sm";
const primary = "rounded-lg !bg-primary px-6 py-2.5 font-label-md font-semibold !text-on-primary disabled:opacity-60";

export default function PayRegistrationFeePage() {
  const [reference, setReference] = useState("");
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [answer, setAnswer] = useState("");
  const [shownCode, setShownCode] = useState<{ code: string; until: number } | null>(null);
  const [code, setCode] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [method, setMethod] = useState<Method>("billdesk");
  const [transfer, setTransfer] = useState({ bank: "", transactionId: "", paymentDate: "", remarks: "" });
  const [result, setResult] = useState<PayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => { const r = await getCaptcha(); if (r.ok) { setCaptcha(r.value); setAnswer(""); } }, []);
  useEffect(() => { let live = true; void getCaptcha().then((r) => { if (live && r.ok) setCaptcha(r.value); }); return () => { live = false; }; }, []);
  useEffect(() => { if (!shownCode) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [shownCode]);

  async function start() {
    if (!captcha) return;
    setError(null); setBusy(true);
    const r = await startPay(reference.trim(), { id: captcha.id, answer });
    setBusy(false);
    if (!r.ok) { setError(errorText(r.error)); void refresh(); return; }
    setShownCode({ code: r.value.code, until: Date.now() + r.value.validSeconds * 1000 });
    setNow(Date.now());
  }
  async function verify() {
    setError(null); setBusy(true);
    const r = await verifyPay(reference.trim(), code);
    setBusy(false);
    if (!r.ok) {
      const left = (r.detail as { attemptsLeft?: number } | null)?.attemptsLeft;
      setError(errorText(r.error) + (typeof left === "number" ? ` ${left} attempt${left === 1 ? "" : "s"} left.` : ""));
      if (r.error === "locked" || r.error === "code_expired") setShownCode(null);
      return;
    }
    setSummary(r.value);
  }
  async function pay(outcome: "success" | "failed") {
    if (!summary) return;
    setError(null); setBusy(true);
    const r = await confirmPay(summary.payToken, method, outcome, method === "direct_transfer" ? transfer : undefined);
    setBusy(false);
    if (!r.ok) return setError(errorText(r.error));
    setResult(r.value);
  }

  const secondsLeft = shownCode ? Math.max(0, Math.ceil((shownCode.until - now) / 1000)) : 0;
  return (
    <main className="mx-auto max-w-2xl space-y-space-md p-space-md lg:p-space-lg" data-testid="agency-pay">
      <div role="heading" aria-level={1} className="text-2xl font-extrabold text-on-surface">Pay Registration Fee</div>

      {result ? (
        result.status === "failed" ? (
          <div className={box} data-testid="pay-failed"><p className="font-bold text-error">The payment did not go through.</p><p className="text-sm">Nothing was charged. You can try again.</p><button type="button" className={primary} onClick={() => setResult(null)}>Try again</button></div>
        ) : result.status === "checks_failed" ? (
          <div className={box} data-testid="pay-checks-failed"><p className="font-bold text-error">Payment recorded, but BEE&apos;s automatic checks found problems.</p><ul className="list-disc pl-5 text-sm">{result.failed.map((f) => <li key={f}>{f}</li>)}</ul></div>
        ) : (
          <div className={box} data-testid="pay-done">
            <p className="text-lg font-bold text-[#14532d]">{result.status === "paid" ? "Payment received" : "Transfer details recorded; BEE confirms it on receipt"}</p>
            <p className="text-sm">{result.firm} · Reference <b className="font-mono">{result.reference}</b></p>
            <ul className="text-sm">{result.lines.map((l) => <li key={l.label} className="flex justify-between border-b border-border-subtle py-1"><span>{l.label}</span><b>{inr(l.amountInr)}</b></li>)}</ul>
            <p className="text-sm">Registration charge receipt <b className="font-mono">{result.chargeReceipt}</b> · Deposit receipt <b className="font-mono">{result.depositReceipt}</b></p>
            <div className="rounded-lg bg-surface-container p-3 text-sm" data-testid="pay-credentials">
              <p className="font-semibold">Your sign-in details (shown here because nothing is emailed in this local demonstration)</p>
              <p>User name <b className="font-mono" data-testid="cred-username">{result.credentials.username}</b></p>
              <p>Password <b className="font-mono" data-testid="cred-password">{result.credentials.password}</b></p>
            </div>
            <Link href="/login" className={`${primary} inline-block`}>Sign in</Link>
          </div>
        )
      ) : summary ? (
        <div className={box} data-testid="pay-summary">
          <p className="text-sm">{summary.firm} · {summary.equipment} · Reference <b className="font-mono">{summary.reference}</b></p>
          <ul className="text-sm">{summary.lines.map((l) => <li key={l.label} className="flex justify-between border-b border-border-subtle py-1"><span>{l.label}</span><b>{inr(l.amountInr)}</b></li>)}</ul>
          <p className="flex justify-between text-sm font-bold"><span>Total</span><span data-testid="pay-total">{inr(summary.total)}</span></p>
          <fieldset className="space-y-1 text-sm"><legend className="font-semibold">Payment method</legend>
            {(Object.keys(PAYMENT_METHOD_LABELS) as Method[]).map((m) => <label key={m} className="mr-4 inline-flex items-center gap-1"><input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} data-testid={`method-${m}`} /> {PAYMENT_METHOD_LABELS[m]}</label>)}
          </fieldset>
          {method === "direct_transfer" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {([["bank", "Bank"], ["transactionId", "Transaction ID"], ["paymentDate", "Payment date"], ["remarks", "Remarks"]] as const).map(([k, label]) => (
                <label key={k} className="block text-sm">{label}<input type={k === "paymentDate" ? "date" : "text"} className={input} value={transfer[k]} onChange={(e) => setTransfer({ ...transfer, [k]: e.target.value })} data-testid={`transfer-${k}`} /></label>
              ))}
            </div>
          ) : <p className="text-xs text-on-surface-variant">Simulated gateway: no real payment is made.</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={busy} className={primary} onClick={() => void pay("success")} data-testid="pay-now">{method === "direct_transfer" ? "Record transfer" : "Pay now"}</button>
            {method !== "direct_transfer" ? <button type="button" disabled={busy} className="rounded-lg border border-outline-variant px-4 py-2.5 text-sm font-semibold" onClick={() => void pay("failed")} data-testid="pay-fail">Simulate a failed payment</button> : null}
          </div>
        </div>
      ) : (
        <div className={box}>
          <label className="block text-sm">Reference ID<input value={reference} onChange={(e) => setReference(e.target.value)} className={input} placeholder="MOB/2026/00001" data-testid="pay-reference" /></label>
          {!shownCode ? (
            <div className="flex flex-wrap items-end gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {captcha ? <img src={captcha.image} alt="Characters to type" width={150} height={44} className="rounded border border-outline-variant" /> : null}
              <button type="button" onClick={() => void refresh()} className="text-sm font-semibold text-primary underline">New picture</button>
              <label className="block text-sm">Type the characters<input value={answer} onChange={(e) => setAnswer(e.target.value)} autoComplete="off" className={input} data-testid="pay-captcha" /></label>
              <button type="button" disabled={busy || !reference.trim() || !answer.trim()} className={primary} onClick={() => void start()} data-testid="pay-start">Get verification code</button>
            </div>
          ) : (
            <div className="space-y-3" data-testid="pay-code-box">
              <p className="rounded-lg bg-surface-container p-3 text-sm">Verification code (shown here because nothing is sent in this local demonstration): <b className="font-mono text-lg" data-testid="pay-code-shown">{shownCode.code}</b><br />{secondsLeft > 0 ? `Valid for ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : "The code has expired. Start again."}</p>
              <label className="block text-sm">Enter the code<input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} className={input} data-testid="pay-code" /></label>
              <button type="button" disabled={busy || code.length < 6} className={primary} onClick={() => void verify()} data-testid="pay-verify">Verify</button>
            </div>
          )}
        </div>
      )}
      {error ? <p role="alert" className="text-sm font-semibold text-error" data-testid="pay-error">{error}</p> : null}
    </main>
  );
}
