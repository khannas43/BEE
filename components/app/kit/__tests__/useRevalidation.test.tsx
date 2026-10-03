import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRevalidation } from "@/components/app/kit/useRuntimeRead";

const INTERVAL_MS = 1_000;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

function pageShow(persisted: boolean) {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

describe("useRevalidation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    setVisibility("visible");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401, headers: { "content-type": "application/json" } })),
    );
  });

  it("bumps the epoch on focus and when the tab becomes visible", async () => {
    const { result } = renderHook(() => useRevalidation(INTERVAL_MS));
    expect(result.current.epoch).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current.epoch).toBe(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/runtime/me");

    setVisibility("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.epoch).toBe(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.epoch).toBe(2);
    expect(result.current.restores).toBe(0);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("bumps restores on a back-forward-cache restore and ignores an ordinary pageshow", async () => {
    const { result } = renderHook(() => useRevalidation(INTERVAL_MS));

    await act(async () => {
      pageShow(false);
    });
    expect(result.current).toMatchObject({ epoch: 0, restores: 0 });

    await act(async () => {
      pageShow(true);
    });
    expect(result.current.restores).toBe(1);
    expect(result.current.epoch).toBe(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("fires the interval and clears it on unmount", async () => {
    const { result, unmount } = renderHook(() => useRevalidation(INTERVAL_MS));

    await act(async () => {
      vi.advanceTimersByTime(INTERVAL_MS);
    });
    expect(result.current.epoch).toBe(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(INTERVAL_MS * 5);
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("bumps the epoch when refresh is called", () => {
    const { result } = renderHook(() => useRevalidation(INTERVAL_MS));
    act(() => {
      result.current.refresh();
    });
    expect(result.current.epoch).toBe(1);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
