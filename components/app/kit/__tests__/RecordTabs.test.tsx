import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { RecordTabs, type RecordTabDef } from "@/components/app/kit/RecordTabs";

const TABS: RecordTabDef[] = [
  { id: "a", label: "Tab A", render: () => <p data-testid="panel-a">A content</p> },
  { id: "b", label: "Tab B", render: () => <p data-testid="panel-b">B content</p> },
  { id: "c", label: "Tab C", render: () => <p data-testid="panel-c">C content</p> },
];

function Harness({ initial = "a" }: { initial?: string }) {
  const [active, setActive] = useState(initial);
  return (
    <RecordTabs
      tabs={TABS}
      activeTabId={active}
      onTabChange={setActive}
      tabListTestId="tabs"
      tabTestId={(id) => `tab-${id}`}
      panelTestId={(id) => `tabpanel-${id}`}
    />
  );
}

describe("RecordTabs", () => {
  it("shows the active panel and switches on click", () => {
    cleanup();
    render(<Harness />);
    expect(screen.getByTestId("panel-a")).toBeTruthy();
    expect(screen.queryByTestId("panel-b")).toBeNull();
    fireEvent.click(screen.getByTestId("tab-b"));
    expect(screen.getByTestId("panel-b")).toBeTruthy();
  });

  it("moves focus with Arrow, Home, and End keys", () => {
    cleanup();
    render(<Harness />);
    const tablist = screen.getByTestId("tabs");
    screen.getByTestId("tab-a").focus();
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByTestId("tab-b"));
    fireEvent.keyDown(tablist, { key: "End" });
    expect(document.activeElement).toBe(screen.getByTestId("tab-c"));
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByTestId("tab-a"));
  });
});
