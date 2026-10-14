"use client";

import { useState } from "react";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { ProposalList } from "@/components/app/admin/ProposalPanels";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import {
  type BusinessSetting,
  type BusinessSettingProposal,
  type SettingVersion,
  decideSettingSignature,
  proposeSettingSignature,
  readBusinessSettings,
  runDecideSetting,
  runProposeSetting,
} from "@/lib/client/runtimeBusinessSettings";
import { gateRead } from "@/lib/client/runtimeHttp";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

/**
 * Business-number administration (the owner's assumptions, not BEE's decisions). The screen renders whatever definitions
 * the service returns. A person who holds the business-settings permission proposes a value from a date that is not in
 * the past; a DIFFERENT person who holds it approves or rejects, and only then does the value take over from its date.
 * The proposer may withdraw their own proposal. While no version has started, the catalogue default applies and is
 * labelled as such. Spring decides who may do what and when; this screen carries the request and shows the answer.
 */
const ROUTE = "/app/administration/business-settings";
const LIST_TARGET = "list";
const loadSettings = () => readBusinessSettings();
const WHOLE = /^\d{1,10}$/;
const DECIMAL = /^\d{1,10}(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const BUSINESS_SETTINGS_COPY = {
  title: "Business settings",
  loading: "Loading business settings…",
  twoPeople: "A new value starts only after a different person approves it, and never from a date in the past.",
  provisional: "Until a version is in force, the figure shown is the owner's assumption, not a BEE rule.",
  noneScheduled: "None scheduled",
  defaultRule: "default, not a BEE rule",
  propose: "Propose a change",
  empty: "No business setting exists yet.",
} as const;

/** The calendar day after an ISO date, without a timezone shift. An unreadable date is returned unchanged. */
export function dayAfter(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return next.toISOString().slice(0, 10);
}

function scheduledInOrder(setting: BusinessSetting): SettingVersion[] {
  return [...setting.scheduled].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

function valueAccepted(raw: string, setting: BusinessSetting): boolean {
  if (!(setting.decimals === 0 ? WHOLE : DECIMAL).test(raw)) return false;
  const n = Number(raw);
  return n >= Number(setting.min) && n <= Number(setting.max);
}

function inputRequired(setting: BusinessSetting): string {
  const number = setting.decimals === 0 ? "a whole number" : "a number with up to two decimals";
  return `Enter ${number} from ${setting.min} to ${setting.max} ${setting.unit}, a start date from today, and the source and reason.`;
}

function settingDecidedSuffix(p: BusinessSettingProposal): string {
  return p.state !== "pending"
    ? ` · ${p.state}${p.decidedBy ? ` by ${p.decidedBy}` : ""}${p.applied ? " (applied)" : ""}${p.decisionNote ? ` · ${p.decisionNote}` : ""}`
    : "";
}

export function BusinessSettings({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const revalidation = useRevalidation();
  const read = gateRead(identity.status, useRuntimeRead(LIST_TARGET, loadSettings, revalidation));
  const [notice, setNotice] = useState<BusinessSettingProposal | null>(null);
  const [proposingKey, setProposingKey] = useState<string | null>(null);
  const decided = (p: BusinessSettingProposal) => {
    setNotice(p);
    revalidation.refresh();
  };

  const listProps = {
    onDone: decided,
    onReload: revalidation.refresh,
    commandPrefix: "bizsetting",
    signInReturnTo: ROUTE,
    runDecide: runDecideSetting,
    decideSignature: decideSettingSignature,
    approveLabel: "Approve and start the value",
    renderSummary: (p: BusinessSettingProposal) => (
      <>
        {p.label}: {p.valueBefore} → {p.value} from {p.effectiveFrom}
      </>
    ),
    formatDecidedSuffix: settingDecidedSuffix,
  };

  const proposing = read && read.ok ? read.admin.settings.find((s) => s.key === proposingKey) ?? null : null;

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Numbers BEE has not decided" implemented={runtimeRouteFor(ROUTE)?.implemented}>
      <div className="space-y-space-md" data-testid="bizsettings-screen">
        <IdentityStrip identity={identity} testId="bizsettings-identity" />
        <p className="font-label-sm text-label-sm text-on-surface-variant" data-testid="bizsettings-notes">
          {BUSINESS_SETTINGS_COPY.twoPeople} {BUSINESS_SETTINGS_COPY.provisional}
        </p>
        <ReadPanel
          title={BUSINESS_SETTINGS_COPY.title}
          read={read}
          loadingText={BUSINESS_SETTINGS_COPY.loading}
          loadingTestId="bizsettings-loading"
          errorTestId="bizsettings-error"
          signInReturnTo={ROUTE}
          isEmpty={(r) => r.admin.settings.length === 0}
          emptyText={BUSINESS_SETTINGS_COPY.empty}
          emptyTestId="bizsettings-empty"
        >
          {(r) => <SettingsTable settings={r.admin.settings} proposingKey={proposingKey} onPropose={setProposingKey} />}
        </ReadPanel>
        {notice ? (
          <p className="font-body-sm text-body-sm bg-surface-card rounded-xl shadow-sm p-space-md" data-testid={`bizsetting-decided-${notice.id}`}>
            {notice.state === "approved"
              ? `Approved: ${notice.label} ${notice.value} applies from ${notice.effectiveFrom}.`
              : `Proposal for ${notice.label} from ${notice.effectiveFrom}: ${notice.state}.`}
          </p>
        ) : null}
        {read && read.ok ? (
          <>
            {proposing ? <ProposeForm key={proposing.key} setting={proposing} today={read.admin.today} onDone={revalidation.refresh} /> : null}
            <ProposalList title="Waiting for a second person" testId="bizsettings-pending" proposals={read.admin.pending} decidable {...listProps} />
            <ProposalList title="Recently decided" testId="bizsettings-decided" proposals={read.admin.decided} {...listProps} />
          </>
        ) : null}
      </div>
    </ScreenChrome>
  );
}

function SettingsTable({
  settings,
  proposingKey,
  onPropose,
}: {
  settings: BusinessSetting[];
  proposingKey: string | null;
  onPropose: (key: string | null) => void;
}) {
  return (
    <table className="w-full font-body-sm text-body-sm" data-testid="bizsettings-table">
      <thead>
        <tr className="text-left text-on-surface-variant font-label-sm">
          <th className="py-1 pr-3">Setting</th>
          <th className="py-1 pr-3">Unit</th>
          <th className="py-1 pr-3">Value in force</th>
          <th className="py-1 pr-3">Scheduled</th>
          <th className="py-1" />
        </tr>
      </thead>
      <tbody>
        {settings.map((setting) => (
          <tr key={setting.key} data-testid={`bizsetting-row-${setting.key}`}>
            <td className="py-1 pr-3">{setting.label}</td>
            <td className="py-1 pr-3">{setting.unit}</td>
            <td className="py-1 pr-3" data-testid={`bizsetting-value-${setting.key}`} data-default={setting.inForceFrom === null ? "true" : "false"}>
              {setting.inForceFrom === null ? setting.defaultValue : setting.valueInForce}
              {setting.inForceFrom === null ? (
                <span className="block font-label-sm text-on-surface-variant">{BUSINESS_SETTINGS_COPY.defaultRule}</span>
              ) : (
                <span className="block font-label-sm text-on-surface-variant">from {setting.inForceFrom}</span>
              )}
            </td>
            <td className="py-1 pr-3">
              <ScheduledValues setting={setting} />
            </td>
            <td className="py-1">
              <button
                type="button"
                className="border border-primary text-primary py-1.5 px-3 rounded-lg font-label-sm"
                data-testid={`bizsetting-propose-${setting.key}`}
                aria-pressed={proposingKey === setting.key}
                onClick={() => onPropose(proposingKey === setting.key ? null : setting.key)}
              >
                {BUSINESS_SETTINGS_COPY.propose}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScheduledValues({ setting }: { setting: BusinessSetting }) {
  const versions = scheduledInOrder(setting);
  if (versions.length === 0) {
    return <span data-testid={`bizsetting-scheduled-${setting.key}`}>{BUSINESS_SETTINGS_COPY.noneScheduled}</span>;
  }
  return (
    <ul data-testid={`bizsetting-scheduled-${setting.key}`}>
      {versions.map((version) => (
        <li key={version.effectiveFrom} data-testid={`bizsetting-scheduled-${setting.key}-${version.effectiveFrom}`}>
          {version.value} {setting.unit} from {version.effectiveFrom}
        </li>
      ))}
    </ul>
  );
}

function ProposeForm({ setting, today, onDone }: { setting: BusinessSetting; today: string; onDone: () => void }) {
  const [value, setValue] = useState("");
  const [from, setFrom] = useState(dayAfter(today));
  const [source, setSource] = useState("");
  const [reason, setReason] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [done, setDone] = useState<BusinessSettingProposal | null>(null);
  const command = useCommand(runProposeSetting, proposeSettingSignature);
  const whole = setting.decimals === 0;

  async function propose() {
    const v = value.trim();
    if (!valueAccepted(v, setting) || !DATE.test(from) || from < today || !source.trim() || !reason.trim()) {
      setInputError(inputRequired(setting));
      return;
    }
    setInputError(null);
    const result = await command.execute({ settingKey: setting.key, value: v, effectiveFrom: from, sourceReference: source.trim(), reason: reason.trim() });
    if (result?.ok) {
      setDone(result.value);
      setValue("");
      setSource("");
      setReason("");
      onDone();
    }
  }

  const field = "mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm";
  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="bizsetting-propose">
      <h2 className="font-title-md text-title-md text-on-surface">Propose a change to {setting.label}</h2>
      <div className="mt-space-sm grid grid-cols-1 md:grid-cols-2 gap-space-md">
        <aside className="space-y-space-sm font-body-sm text-body-sm">
          <p data-testid="bizsetting-description">{setting.description}</p>
          {setting.warning !== null ? (
            <p className="text-on-surface-variant" data-testid="bizsetting-warning">{setting.warning}</p>
          ) : null}
          <p data-testid="bizsetting-constraints">
            <span data-testid="bizsetting-min">{setting.min}</span>
            {" to "}
            <span data-testid="bizsetting-max">{setting.max}</span>
            {" "}
            <span data-testid="bizsetting-unit">{setting.unit}</span>
          </p>
        </aside>
        <CommandPanel
          className="space-y-space-sm"
          state={command.state}
          onRun={() => void propose()}
          runLabel="Propose change"
          busyLabel="Proposing…"
          runTestId="bizsetting-propose-run"
          errorTestId="bizsetting-propose-error"
          reloadTestId="bizsetting-propose-reload"
          onReload={onDone}
          signInReturnTo={ROUTE}
        >
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Value ({setting.unit})
            <input
              inputMode={whole ? "numeric" : "decimal"}
              min={setting.min}
              max={setting.max}
              step={whole ? "1" : "0.01"}
              value={value}
              onChange={(e) => {
                const next = e.target.value;
                if (whole && next.includes(".")) return;
                setValue(next);
              }}
              className={field}
              data-testid="bizsetting-value"
              data-decimals={setting.decimals}
            />
          </label>
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Starts on
            <input type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} className={field} data-testid="bizsetting-from" />
          </label>
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Source (circular, order or note)
            <input value={source} onChange={(e) => setSource(e.target.value)} maxLength={300} className={field} data-testid="bizsetting-source" />
          </label>
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Reason
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} className={field} data-testid="bizsetting-reason" />
          </label>
        </CommandPanel>
      </div>
      {inputError ? <p className="text-error font-body-sm mt-space-sm" data-testid="bizsetting-propose-input-error">{inputError}</p> : null}
      {done ? (
        <p className="font-body-sm text-body-sm mt-space-sm" data-testid="bizsetting-propose-success">
          Proposed {done.label}: {done.valueBefore} → {done.value} from {done.effectiveFrom}. A different person must approve it before it takes effect.
        </p>
      ) : null}
    </section>
  );
}
