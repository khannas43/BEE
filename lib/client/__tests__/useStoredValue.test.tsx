import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStoredValue, writeStoredValue } from "@/lib/client/useStoredValue";

function Probe({ storageKey }: { storageKey: string }) {
  const value = useStoredValue(storageKey);
  return <span data-testid="value">{value ?? "null"}</span>;
}

describe("useStoredValue", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when the key is missing", () => {
    render(<Probe storageKey="bee-missing" />);
    expect(screen.getByTestId("value").textContent).toBe("null");
  });

  it("returns a stored value", () => {
    localStorage.setItem("bee-test", "hello");
    render(<Probe storageKey="bee-test" />);
    expect(screen.getByTestId("value").textContent).toBe("hello");
  });

  it("returns null when storage throws", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Probe storageKey="bee-test" />);
    expect(screen.getByTestId("value").textContent).toBe("null");
    getItem.mockRestore();
  });

  it("updates when another tab fires storage", () => {
    render(<Probe storageKey="bee-test" />);
    act(() => {
      localStorage.setItem("bee-test", "from-tab");
      window.dispatchEvent(new StorageEvent("storage", { key: "bee-test", newValue: "from-tab" }));
    });
    expect(screen.getByTestId("value").textContent).toBe("from-tab");
  });

  it("updates when writeStoredValue runs in the same tab", () => {
    render(<Probe storageKey="bee-test" />);
    act(() => {
      writeStoredValue("bee-test", "same-tab");
    });
    expect(screen.getByTestId("value").textContent).toBe("same-tab");
  });
});
