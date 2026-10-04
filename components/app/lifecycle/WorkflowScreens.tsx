"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Card, FakeTable, ScreenChrome, Status, WARN, BAD, INFO } from "@/components/app/ScreenScaffold";
import { useLifecycle } from "@/components/app/LifecycleStore";
import { useRole } from "@/components/app/RoleContext";
import { Module, Screen } from "@/lib/screens";

const PR_TONE: Record<string, string> = { High: BAD, Medium: WARN, Low: INFO };

/** Personal inbox & team queue. */
export function WorkflowInbox({ module, screen, scope }: { module: Module; screen: Screen; scope: "personal" | "team" }) {
  const { tasks } = useLifecycle();
  const { role } = useRole();
  const [filter, setFilter] = useState<"all" | "overdue" | "returned">("all");

  // Personal inbox = only the tasks THIS role owns (can act on). The team queue
  // keeps the full shared list. Counts below derive from `mine`, so the tabs and
  // the empty state always match what is shown.
  const mine = scope === "personal" ? tasks.filter((t) => t.ownerRoles.includes(role)) : tasks;
  const shown = mine.filter((t) =>
    filter === "all" ? true : filter === "overdue" ? t.overdue : t.priority === "High"
  );

  return (
    <ScreenChrome module={module} screen={screen} subtitle={scope === "personal" ? "Tasks you can act on" : "Shared team queue"}>
      <div className="space-y-space-md">
        <div className="flex items-center gap-space-sm">
          {([
            ["all", `All (${mine.length})`],
            ["overdue", `Overdue (${mine.filter((t) => t.overdue).length})`],
            ["returned", `High priority (${mine.filter((t) => t.priority === "High").length})`],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} className={`px-space-md py-1.5 rounded-lg font-label-md text-label-md ${filter === k ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface"}`}>
              {label}
            </button>
          ))}
        </div>
        <Card>
          {shown.length === 0 ? (
            <div className="py-space-lg text-center">
              <Icon name="inbox" size={28} className="text-outline" />
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                {scope === "personal"
                  ? mine.length === 0
                    ? "No tasks are currently assigned to your role."
                    : "No tasks match this filter."
                  : "No tasks in this view."}
              </p>
            </div>
          ) : (
            <FakeTable
              columns={["Task", "Reference", "Queue", "Priority", "Due", ""]}
              rows={shown.map((t) => [
                <span key="t" className="font-medium text-on-surface">{t.title}</span>,
                <span key="r" className="font-mono">{t.appId}</span>,
                t.queue,
                <Status key="p" label={t.priority} tone={PR_TONE[t.priority]} />,
                <span key="d" className={t.overdue ? "text-error font-semibold" : ""}>{t.overdue ? "Overdue" : t.due}</span>,
                <Link key="o" href={`/app/${t.actionModule}/${t.actionScreen}?id=${t.appId}`} className="text-primary hover:underline font-label-sm text-label-sm inline-flex items-center gap-1">
                  Action <Icon name="arrow_forward" size={14} />
                </Link>,
              ])}
            />
          )}
        </Card>
      </div>
    </ScreenChrome>
  );
}
