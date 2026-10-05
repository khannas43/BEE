"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Stars } from "@/components/ui/Stars";
import { Card, ScreenChrome, Status, WARN } from "@/components/app/ScreenScaffold";
import { useLifecycle } from "@/components/app/LifecycleStore";
import { useRole } from "@/components/app/RoleContext";
import { Module, Screen } from "@/lib/screens";
import { ModelApplication, Stage, computeStars } from "@/lib/mock/lifecycle";
import { ApplicationSummary, StageBadge, StageStepper, Timeline, useActor } from "./shared";

export type StageVariant = "fee" | "iame" | "bee" | "approval" | "rating" | "label";

const VARIANT_STAGE: Record<StageVariant, Stage> = {
  fee: "fee_due",
  iame: "iame_scrutiny",
  bee: "bee_scrutiny",
  approval: "approval",
  rating: "rating",
  label: "label",
};

const VARIANT_COPY: Record<StageVariant, { subtitle: string; primary: string; icon: string; note: string }> = {
  fee: { subtitle: "Confirm application fee", primary: "Confirm fee received", icon: "payments", note: "Reconciliation is authoritative for settlement." },
  iame: { subtitle: "IAME technical scrutiny", primary: "Recommend & forward to BEE", icon: "fact_check", note: "Checklist, test evidence and technical note are captured." },
  bee: { subtitle: "BEE scrutiny", primary: "Clear & forward to approval", icon: "verified", note: "Confirms IAME recommendation and evidence completeness." },
  approval: { subtitle: "Director / Secretary approval", primary: "Approve", icon: "approval", note: "Maker cannot approve own controlled action. eSign / DSC captured." },
  rating: { subtitle: "Compute the star rating", primary: "Compute & apply rating", icon: "calculate", note: "All inputs and intermediate results retained as evidence." },
  label: { subtitle: "Generate label & allocate QR", primary: "Generate label & QR batch", icon: "qr_code_2", note: "Label artwork is hashed and versioned; QR batch bound to the permission." },
};

export function StageScreen({ module, screen, variant, bare = false }: { module: Module; screen: Screen; variant: StageVariant; bare?: boolean }) {
  const stage = VARIANT_STAGE[variant];
  const { apps, appsAtStage, byId, payFee, advance, returnApp, reject, setRating, generateLabel } = useLifecycle();
  const { role } = useRole();
  const actor = useActor();
  const params = useSearchParams();
  const idParam = params.get("id");

  // Fee receipt is a BEE Finance action — never available to the payer or any
  // non-Finance role. Guards the button AND the action itself (the "API").
  const canConfirmFee = variant !== "fee" || role === "finance";

  const queue = appsAtStage(stage);
  const selected = byId(idParam) ?? queue[0] ?? apps[0];
  const copy = VARIANT_COPY[variant];

  const [note, setNote] = useState("");

  function doPrimary(a: ModelApplication) {
    if (variant === "fee") { if (!canConfirmFee) return; return payFee(a.id, actor); }
    if (variant === "rating") return setRating(a.id, actor);
    if (variant === "label") return generateLabel(a.id, actor);
    const msg =
      variant === "iame" ? "IAME recommended, forwarded to BEE scrutiny"
      : variant === "bee" ? "BEE scrutiny cleared, forwarded for approval"
      : "Approved, forwarded for rating";
    advance(a.id, note.trim() ? `${msg} — ${note.trim()}` : msg, actor);
    setNote("");
  }

  const atStage = selected && selected.stage === stage && selected.stage !== "rejected";

  const inner = (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-md">
        {/* Queue */}
        <Card title={`Queue (${queue.length})`}>
          {queue.length === 0 ? (
            <p className="font-body-sm text-body-sm text-on-surface-variant">Nothing waiting at this stage right now.</p>
          ) : (
            <div className="space-y-space-xs">
              {queue.map((a) => {
                const isSel = selected?.id === a.id;
                return (
                  <a
                    key={a.id}
                    href={`/app/model-label/${screen.id}?id=${a.id}`}
                    className={`block p-space-sm rounded-lg transition-all ${isSel ? "bg-forest-light" : "bg-surface-container-low hover:bg-surface-container"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-title-lg text-title-lg text-on-surface">{a.brand}</span>
                      {a.returned && <Icon name="undo" size={16} className="text-solar-gold-dark" />}
                    </div>
                    <div className="font-label-sm text-label-sm text-on-surface-variant">{a.model} · {a.id}</div>
                  </a>
                );
              })}
            </div>
          )}
        </Card>

        {/* Detail + action */}
        <div className="lg:col-span-2 space-y-space-md">
          {!selected ? (
            <Card><p className="font-body-md text-body-md text-on-surface-variant">No applications available.</p></Card>
          ) : (
            <>
              <Card>
                <div className="flex items-center justify-between mb-space-sm">
                  <div>
                    <h3 className="font-headline-sm text-headline-sm text-on-surface">{selected.brand}</h3>
                    <div className="font-label-sm text-label-sm text-on-surface-variant">{selected.model} · {selected.id}</div>
                  </div>
                  <StageBadge app={selected} />
                </div>
                <StageStepper app={selected} />
                <div className="mt-space-md">
                  <ApplicationSummary app={selected} />
                </div>
              </Card>

              {variant === "rating" ? (
                <RatingPanel app={selected} />
              ) : variant === "label" ? (
                <LabelPanel app={selected} />
              ) : (
                <Card title="Checklist & findings">
                  <ul className="space-y-space-sm">
                    {selected.findings.map((f, i) => (
                      <li key={i} className="flex items-center gap-space-sm font-body-sm text-body-sm">
                        <Icon name={f.ok ? "check_circle" : "error"} size={18} fill className={f.ok ? "text-primary" : "text-solar-gold-dark"} />
                        <span className="text-on-surface">{f.text}</span>
                        {!f.ok && <span className="ml-auto"><Status label="Needs clarification" tone={WARN} /></span>}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {/* Action panel */}
              <Card title="Action">
                {variant === "fee" && !canConfirmFee ? (
                  <div className="flex items-start gap-space-sm bg-surface-container-low rounded-lg p-space-sm">
                    <Icon name="lock" size={18} className="text-on-surface-variant shrink-0 mt-0.5" />
                    <p className="font-body-sm text-body-sm text-on-surface">Confirming receipt of a fee is reserved for the <span className="font-semibold">BEE Finance</span> workflow. This role can view fee and reconciliation status but cannot confirm settlement.</p>
                  </div>
                ) : atStage ? (
                  <>
                    {(variant === "iame" || variant === "bee" || variant === "approval") && (
                      <>
                        <label className="font-label-sm text-label-sm text-on-surface-variant block mb-1">
                          {variant === "approval" ? "Decision reason" : "Scrutiny note"}
                        </label>
                        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional note recorded on the timeline…" className="w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm text-body-sm outline-none mb-space-sm" />
                      </>
                    )}
                    <div className="flex flex-wrap items-center gap-space-sm">
                      <button onClick={() => doPrimary(selected)} className="px-space-md py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md flex items-center gap-1.5 hover:bg-forest-dark shadow-sm">
                        <Icon name={copy.icon} size={18} /> {copy.primary}
                      </button>
                      {(variant === "iame" || variant === "bee" || variant === "approval") && (
                        <button onClick={() => { returnApp(selected.id, note.trim() || "Clarification required", actor); setNote(""); }} className="px-space-md py-2.5 rounded-lg bg-surface-container text-on-surface font-label-md text-label-md flex items-center gap-1.5 hover:bg-surface-container-high">
                          <Icon name="undo" size={18} /> Return
                        </button>
                      )}
                      {variant === "approval" && (
                        <button onClick={() => reject(selected.id, note.trim() || "Rejected on scrutiny", actor)} className="px-space-md py-2.5 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md flex items-center gap-1.5 hover:bg-error hover:text-on-error">
                          <Icon name="cancel" size={18} /> Reject
                        </button>
                      )}
                    </div>
                    <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-sm">{copy.note} Acting as {actor}.</p>
                  </>
                ) : (
                  <div className="flex items-center gap-space-sm font-body-sm text-body-sm text-on-surface-variant">
                    <Icon name="info" size={18} className="text-secondary" />
                    This application is at <StageBadge app={selected} />. Open its current-stage screen to act on it.
                  </div>
                )}
              </Card>

              <Card title="Timeline">
                <Timeline app={selected} />
              </Card>
            </>
          )}
        </div>
      </div>
  );
  return bare ? inner : <ScreenChrome module={module} screen={screen} subtitle={copy.subtitle}>{inner}</ScreenChrome>;
}

function RatingPanel({ app }: { app: ModelApplication }) {
  const projected = computeStars(app.declaredIseer);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
      <Card title="Inputs & formula">
        <dl className="space-y-2 font-body-sm text-body-sm">
          <Row k="Cooling capacity" v={`${app.capacityW} W`} />
          <Row k="Power input" v={`${app.powerInputW} W`} />
          <Row k="Declared ISEER" v={app.declaredIseer.toFixed(2)} />
          <Row k="Formula version" v="RAC-2026-v4" />
        </dl>
      </Card>
      <Card title={app.rating ? "Applied rating" : "Projected rating"}>
        <div className="text-center py-space-sm">
          <Stars value={app.rating ?? projected} size={26} className="justify-center" />
          <div className="font-display-lg text-display-lg font-bold text-primary leading-none mt-1">{app.rating ?? projected}★</div>
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
            {app.rating ? "Rating applied and retained as calculation evidence." : "Press compute to apply and advance to label generation."}
          </p>
        </div>
      </Card>
    </div>
  );
}

function LabelPanel({ app }: { app: ModelApplication }) {
  return (
    <Card title={app.labelGenerated ? "Generated label" : "Label preview"}>
      <div className="flex flex-col sm:flex-row items-center gap-space-lg">
        {/* Stylised BEE star label */}
        <div className="w-56 shrink-0 rounded-lg overflow-hidden border border-border-strong">
          <div className="bg-primary text-on-primary text-center py-1 font-label-sm text-label-sm font-bold tracking-wide">BEE STAR LABEL</div>
          <div className="bg-surface-card p-space-sm">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-on-surface-variant">ENERGY</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">{app.declaredIseer.toFixed(2)} ISEER</span>
            </div>
            <div className="flex justify-center my-2">
              <Stars value={app.rating ?? computeStars(app.declaredIseer)} size={22} />
            </div>
            <div className="text-center font-label-sm text-label-sm text-on-surface-variant">{app.brand}</div>
            <div className="text-center font-body-sm text-body-sm font-semibold text-on-surface">{app.model}</div>
            <div className="mt-space-sm flex items-center justify-between">
              <div className="w-10 h-10 bg-navy-dark rounded grid place-items-center">
                <Icon name="qr_code_2" size={26} className="text-on-primary" />
              </div>
              <div className="text-right font-label-sm text-label-sm text-on-surface-variant">
                <div>Valid till Dec 2028</div>
                <div className="font-mono">{app.regId ?? "pending"}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex-1">
          {app.labelGenerated ? (
            <div className="space-y-space-sm">
              <div className="flex items-center gap-space-sm font-body-sm text-body-sm"><Icon name="tag" size={18} className="text-primary" /> Registration ID: <strong>{app.regId}</strong></div>
              <div className="flex items-center gap-space-sm font-body-sm text-body-sm"><Icon name="qr_code_2" size={18} className="text-primary" /> QR batch: <strong>{app.qrBatch}</strong></div>
              <div className="flex items-center gap-space-sm font-body-sm text-body-sm"><Icon name="verified" size={18} className="text-primary" /> Certificate hash anchored on the ledger</div>
            </div>
          ) : (
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Render the approved bilingual label template, hash and version the artefact, and allocate a QR batch bound to this permission.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-on-surface-variant">{k}</dt>
      <dd className="font-semibold text-on-surface">{v}</dd>
    </div>
  );
}
