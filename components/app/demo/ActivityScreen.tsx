"use client";

import { useEffect, useState } from "react";
import { ListToolbar, ListPager, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { readActivity, roleWord, type ActivityEvent, type ActivityLog } from "@/lib/client/runtimeActivity";

/**
 * Sign-in activity: who signed in, from which address, and what each person did, with the time. A manufacturer sees the people of its own
 * organisation; BEE staff (Officer, Director, Secretary, Administrator, Auditor, Programme) see everyone in one consolidated view. Local demonstration.
 */

const card = "rounded-xl border border-[#dbe6f7] bg-white";
const th = "px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[#475569]";
const td = "px-3 py-2 align-top";
const fieldCls = "mt-1 block w-full rounded-lg border border-outline-variant bg-white px-3 py-2 text-[13px]";
const labelCls = "block text-[12px] font-semibold uppercase tracking-wide text-[#64748b]";

const stamp = (iso: string) => {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
};

function Tile({ label, value, note }: { label: string; value: number | string; note: string }) {
  return (
    <div className={`${card} p-4`}>
      <span className="block text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">{label}</span>
      <span className="block text-[26px] font-extrabold leading-8 text-[#14315E]">{value}</span>
      <span className="block text-[12px] text-[#64748b]">{note}</span>
    </div>
  );
}

export function ActivityScreen() {
  const [log, setLog] = useState<ActivityLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [org, setOrg] = useState("");
  const [kind, setKind] = useState("");
  const [person, setPerson] = useState("");
  useEffect(() => {
    let live = true;
    void readActivity().then((r) => { if (!live) return; if (r.ok) setLog(r.log); else setError(r.message); });
    return () => { live = false; };
  }, []);
  const events = (log?.events ?? []).filter((e) => (!org || e.organisationCode === org) && (!kind || e.kind === kind) && (!person || e.username === person));
  const tools = useListTools<ActivityEvent>({
    rows: events,
    text: (e) => `${e.name} ${e.username} ${roleWord(e.role)} ${e.organisation ?? ""} ${e.ip} ${e.action} ${e.target ?? ""}`,
    date: (e) => e.at.slice(0, 10),
    sortValue: (e, k) => (k === "who" ? e.name : k === "org" ? e.organisation ?? "" : k === "ip" ? e.ip : k === "action" ? e.action : e.at),
    pageSize: 12,
  });
  if (!log && !error) return <p role="status" className="p-space-md font-body-sm" data-testid="activity-loading">Loading sign-in activity…</p>;
  if (!log) return <p role="alert" className="p-space-md text-error font-body-sm" data-testid="activity-error">{error}</p>;
  const all = log.scope === "all";
  const rows = tools.visible;
  const people = [...rows.reduce((m, e) => {
    const p = m.get(e.username) ?? { username: e.username, name: e.name, role: e.role, organisation: e.organisation, logins: 0, actions: 0, lastSeen: e.at, lastIp: e.ip, ips: new Set<string>() };
    if (e.kind === "login") p.logins += 1; else p.actions += 1;
    if (e.at > p.lastSeen) { p.lastSeen = e.at; p.lastIp = e.ip; }
    p.ips.add(e.ip);
    return m.set(e.username, p);
  }, new Map<string, { username: string; name: string; role: string; organisation: string | null; logins: number; actions: number; lastSeen: string; lastIp: string; ips: Set<string> }>()).values()].sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
  const logins = rows.filter((e) => e.kind === "login").length;
  const addresses = new Set(rows.map((e) => e.ip)).size;
  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="demo-activity">
      <h1 className="flex-1 min-w-0">{all ? "Sign-in activity: all manufacturers and staff" : "Sign-in activity of your company"}</h1>
      <p className="ai-lead">{all ? "Every sign-in and recorded action, with the person, their role, the address they came from and the time. Filter by manufacturer, person or type." : "Who from your company has signed in, from which address, and what they did, with the time."}</p>

      <section className={`${card} p-4 space-y-space-sm`} data-testid="activity-filters">
        <div role="heading" aria-level={2} className="text-[16px] font-bold text-[#14315E]">Filters</div>
        <ListToolbar tools={tools} searchLabel="Search" placeholder="Person, address or action" dateLabel="Date"
          exportCsv={{ filename: "sign-in-activity", header: ["Time", "Person", "Username", "Role", "Organisation", "Address", "Type", "Action"], rows: tools.visible.map((e) => [stamp(e.at), e.name, e.username, roleWord(e.role), e.organisation ?? "BEE", e.ip, e.kind === "login" ? "Sign-in" : "Action", e.action]) }} />
        <div className="flex flex-wrap items-end gap-3">
          {all ? (
            <label className={labelCls}>Manufacturer
              <select value={org} onChange={(e) => { setOrg(e.target.value); tools.setPage(1); }} className={`${fieldCls} w-auto`} data-testid="activity-org">
                <option value="">All</option>{log.organisations.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
              </select>
            </label>
          ) : null}
          <label className={labelCls}>Type
            <select value={kind} onChange={(e) => { setKind(e.target.value); tools.setPage(1); }} className={`${fieldCls} w-auto`} data-testid="activity-kind">
              <option value="">All</option><option value="login">Sign-ins</option><option value="action">Actions</option>
            </select>
          </label>
          {person ? <button type="button" className="pb-2 text-[13px] font-semibold text-primary underline" onClick={() => setPerson("")} data-testid="activity-clear-person">Showing one person. Show everyone</button> : null}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="activity-summary">
        <Tile label="People" value={people.length} note="in the selection" />
        <Tile label="Sign-ins" value={logins} note="in the selection" />
        <Tile label="Actions" value={rows.length - logins} note="recorded changes" />
        <Tile label="Addresses" value={addresses} note="different IP addresses" />
      </div>

      <section className="space-y-2">
        <div role="heading" aria-level={2} className="text-[16px] font-bold text-[#14315E]">People</div>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-[13px]" data-testid="activity-people">
            <caption className="sr-only">People who have signed in</caption>
            <thead><tr className="bg-[#eef3fb]"><th className={th}>Person</th><th className={th}>Role</th>{all ? <th className={th}>Organisation</th> : null}<th className={th}>Sign-ins</th><th className={th}>Actions</th><th className={th}>Last seen</th><th className={th}>Last address</th></tr></thead>
            <tbody>
              {people.length === 0 ? <tr><td className={td} colSpan={7}>Nobody has signed in yet.</td></tr> : people.map((p) => (
                <tr key={p.username} className="border-t border-[#e2e8f0]">
                  <td className={td}><button type="button" className="font-semibold text-primary hover:underline" onClick={() => setPerson(person === p.username ? "" : p.username)} data-testid={`activity-person-${p.username}`}>{p.name}</button><div className="text-[12px] text-[#64748b]">{p.username}</div></td>
                  <td className={td}>{roleWord(p.role)}</td>{all ? <td className={td}>{p.organisation ?? "BEE"}</td> : null}
                  <td className={td}>{p.logins}</td><td className={td}>{p.actions}</td><td className={td}>{stamp(p.lastSeen)}</td><td className={`${td} font-mono text-[12px]`}>{p.lastIp}{p.ips.size > 1 ? ` (+${p.ips.size - 1})` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-space-sm">
        <div role="heading" aria-level={2} className="text-[16px] font-bold text-[#14315E]">Sign-ins and actions</div>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-[13px]" data-testid="activity-table">
            <caption className="sr-only">Sign-ins and actions, newest first</caption>
            <thead><tr className="bg-[#eef3fb]">
              <SortableTh tools={tools} k="at" className={th}>Time (IST)</SortableTh><SortableTh tools={tools} k="who" className={th}>Person</SortableTh><th className={th}>Role</th>
              {all ? <SortableTh tools={tools} k="org" className={th}>Organisation</SortableTh> : null}
              <SortableTh tools={tools} k="ip" className={th}>Address</SortableTh><SortableTh tools={tools} k="action" className={th}>Action</SortableTh>
            </tr></thead>
            <tbody>
              {tools.paged.pageRows.length === 0 ? <tr><td className={td} colSpan={6}>Nothing recorded for this selection.</td></tr> : tools.paged.pageRows.map((e, i) => (
                <tr key={`${e.at}-${e.username}-${i}`} className="border-t border-[#e2e8f0]">
                  <td className={`${td} whitespace-nowrap`}>{stamp(e.at)}</td>
                  <td className={td}><span className="font-semibold">{e.name}</span><div className="text-[12px] text-[#64748b]">{e.username}</div></td>
                  <td className={td}>{roleWord(e.role)}</td>{all ? <td className={td}>{e.organisation ?? "BEE"}</td> : null}
                  <td className={`${td} font-mono text-[12px]`}>{e.ip}</td>
                  <td className={td}><span className={`mr-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${e.kind === "login" ? "border-[#b7e0c6] bg-[#e2f3e8] text-[#14532d]" : "border-[#c9d9f7] bg-[#e7effb] text-[#14315E]"}`}>{e.kind === "login" ? "Sign-in" : "Action"}</span>{e.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ListPager tools={tools} />
        {log.events.length >= log.limit ? <p className="text-[12px] text-[#64748b]">The latest {log.limit} entries are shown.</p> : null}
      </section>
    </div>
  );
}
