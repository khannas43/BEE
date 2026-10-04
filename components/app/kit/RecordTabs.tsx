"use client";

import { useId, useRef } from "react";

export const RECORD_TABS_COPY = {
  tabListLabel: "Record sections",
} as const;

export type RecordTabDef = {
  id: string;
  label: string;
  render: () => React.ReactNode;
};

export type RecordTabsProps = {
  tabs: RecordTabDef[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  labels?: typeof RECORD_TABS_COPY;
  tabListTestId?: string;
  tabTestId?: (tabId: string) => string;
  panelTestId?: (tabId: string) => string;
};

function clampTabIndex(tabs: RecordTabDef[], index: number): number {
  if (tabs.length === 0) return 0;
  return Math.min(Math.max(0, index), tabs.length - 1);
}

export function RecordTabs({
  tabs,
  activeTabId,
  onTabChange,
  labels = RECORD_TABS_COPY,
  tabListTestId,
  tabTestId,
  panelTestId,
}: RecordTabsProps) {
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeTabId),
  );
  const activeTab = tabs[activeIndex] ?? tabs[0];

  function focusTab(index: number) {
    const i = clampTabIndex(tabs, index);
    tabRefs.current[i]?.focus();
    onTabChange(tabs[i]!.id);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (tabs.length === 0) return;
    const { key } = event;
    if (key === "ArrowRight") {
      event.preventDefault();
      focusTab(activeIndex + 1);
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      focusTab(activeIndex - 1);
    } else if (key === "Home") {
      event.preventDefault();
      focusTab(0);
    } else if (key === "End") {
      event.preventDefault();
      focusTab(tabs.length - 1);
    }
  }

  if (tabs.length === 0) return null;

  return (
    <div>
      <div
        role="tablist"
        aria-label={labels.tabListLabel}
        className="flex gap-space-sm border-b border-border-subtle mb-space-md"
        data-testid={tabListTestId}
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === activeTab?.id;
          const tabId = `${baseId}-tab-${tab.id}`;
          const panelId = `${baseId}-panel-${tab.id}`;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={tabId}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              className={`px-space-md py-2 font-label-md text-label-md border-b-2 -mb-px ${
                selected
                  ? "border-primary text-on-surface font-semibold"
                  : "border-transparent text-on-surface-variant hover:text-on-surface"
              }`}
              data-testid={tabTestId?.(tab.id)}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {activeTab ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${activeTab.id}`}
          aria-labelledby={`${baseId}-tab-${activeTab.id}`}
          tabIndex={0}
          data-testid={panelTestId?.(activeTab.id)}
        >
          {activeTab.render()}
        </div>
      ) : null}
    </div>
  );
}
