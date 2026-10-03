import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useRuntimeRead, type Revalidation } from "@/components/app/kit/useRuntimeRead";
import { deferredFetches, installDeferredFetch } from "./deferredFetch";

type SampleRead = { ok: true; id: string; n: number };

const clock = (epoch: number, restores = 0): Revalidation => ({ epoch, restores, refresh() {} });

/** Stable loader: the hook treats `load` as an effect dependency. */
function load(target: string): Promise<SampleRead> {
  return fetch(`/api/read/${target}`).then((res) => res.json() as Promise<SampleRead>);
}

describe("useRuntimeRead", () => {
  beforeEach(() => {
    installDeferredFetch();
  });

  it("returns null while loading, then the read", async () => {
    const { result } = renderHook(() => useRuntimeRead("a", load, clock(0)));
    expect(result.current).toBeNull();
    expect(deferredFetches().map((call) => call.url)).toEqual(["/api/read/a"]);

    await act(async () => {
      deferredFetches()[0].resolve({ ok: true, id: "a", n: 1 });
    });
    expect(result.current).toEqual({ ok: true, id: "a", n: 1 });
  });

  it("reads nothing when the target is null", () => {
    const { result } = renderHook(() => useRuntimeRead(null, load, clock(0)));
    expect(result.current).toBeNull();
    expect(deferredFetches()).toHaveLength(0);
  });

  it("forgets a closed target's read and shows loading on reopen", async () => {
    const { result, rerender } = renderHook(({ target }: { target: string | null }) => useRuntimeRead(target, load, clock(0)), {
      initialProps: { target: "a" as string | null },
    });
    await act(async () => {
      deferredFetches()[0].resolve({ ok: true, id: "a", n: 1 });
    });
    expect(result.current).toEqual({ ok: true, id: "a", n: 1 });

    rerender({ target: null });
    expect(result.current).toBeNull();
    expect(deferredFetches()).toHaveLength(1);

    rerender({ target: "a" });
    // The previous record must not flash while the same target is read again (BL-076).
    expect(result.current).toBeNull();
    expect(deferredFetches()).toHaveLength(2);

    await act(async () => {
      deferredFetches()[1].resolve({ ok: true, id: "a", n: 2 });
    });
    expect(result.current).toEqual({ ok: true, id: "a", n: 2 });
  });

  it("ignores a late response for a previous target", async () => {
    const { result, rerender } = renderHook(({ target }: { target: string }) => useRuntimeRead(target, load, clock(0)), {
      initialProps: { target: "a" },
    });
    rerender({ target: "b" });
    expect(deferredFetches().map((call) => call.url)).toEqual(["/api/read/a", "/api/read/b"]);

    await act(async () => {
      deferredFetches()[0].resolve({ ok: true, id: "a", n: 1 });
    });
    expect(result.current).toBeNull();

    await act(async () => {
      deferredFetches()[1].resolve({ ok: true, id: "b", n: 2 });
    });
    expect(result.current).toEqual({ ok: true, id: "b", n: 2 });
  });

  it("re-reads on a revalidation tick and keeps the current read until the new one arrives", async () => {
    const { result, rerender } = renderHook(({ epoch }: { epoch: number }) => useRuntimeRead("a", load, clock(epoch)), {
      initialProps: { epoch: 0 },
    });
    await act(async () => {
      deferredFetches()[0].resolve({ ok: true, id: "a", n: 1 });
    });

    rerender({ epoch: 1 });
    expect(result.current).toEqual({ ok: true, id: "a", n: 1 });
    expect(deferredFetches()).toHaveLength(2);

    await act(async () => {
      deferredFetches()[1].resolve({ ok: true, id: "a", n: 2 });
    });
    expect(result.current).toEqual({ ok: true, id: "a", n: 2 });
  });

  it("drops the current read when a back-forward-cache restore bumps restores", async () => {
    const { result, rerender } = renderHook(
      ({ restores }: { restores: number }) => useRuntimeRead("a", load, clock(0, restores)),
      { initialProps: { restores: 0 } },
    );
    await act(async () => {
      deferredFetches()[0].resolve({ ok: true, id: "a", n: 1 });
    });

    rerender({ restores: 1 });
    expect(result.current).toBeNull();

    await act(async () => {
      deferredFetches()[1].resolve({ ok: true, id: "a", n: 2 });
    });
    expect(result.current).toEqual({ ok: true, id: "a", n: 2 });
  });
});
