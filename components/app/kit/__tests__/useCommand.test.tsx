import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCommand } from "@/components/app/kit/CommandPanel";
import type { CommandResult } from "@/lib/client/runtimeHttp";
import { deferredFetches, idempotencyKey, installDeferredFetch } from "./deferredFetch";

type Payload = { id: string };
type Value = { id: string };

const signature = (payload: Payload) => ({ id: payload.id });

function run(payload: Payload, key: string): Promise<CommandResult<Value>> {
  return fetch("/api/commands/example", {
    method: "POST",
    headers: { "Idempotency-Key": key, "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then((res) => res.json() as Promise<CommandResult<Value>>);
}

const unavailable: CommandResult<Value> = {
  ok: false,
  replayed: false,
  failure: { kind: "unavailable", message: "The service is temporarily unavailable. Try again later." },
};

const inProgress: CommandResult<Value> = {
  ok: false,
  replayed: false,
  failure: { kind: "conflict", code: "idempotency_in_progress", message: "A request with this Idempotency-Key is still in progress." },
};

const refused: CommandResult<Value> = {
  ok: false,
  replayed: false,
  failure: { kind: "validation", code: "validation_failed", message: "The request could not be accepted." },
};

const succeeded: CommandResult<Value> = { ok: true, value: { id: "a" }, replayed: false };

async function settle(result: CommandResult<Value>) {
  const call = deferredFetches().at(-1);
  if (!call) throw new Error("expected a fetch");
  call.resolve(result);
}

describe("useCommand", () => {
  beforeEach(() => {
    installDeferredFetch();
  });

  it("runs one command at a time", async () => {
    const { result } = renderHook(() => useCommand(run, signature));
    let second: CommandResult<Value> | null | undefined;
    await act(async () => {
      void result.current.execute({ id: "a" });
      second = await result.current.execute({ id: "a" });
    });
    expect(second).toBeNull();
    expect(deferredFetches()).toHaveLength(1);
    expect(result.current.state.phase).toBe("busy");

    await act(async () => {
      await settle(unavailable);
    });
    expect(result.current.state).toEqual({ phase: "failed", failure: unavailable.failure });
  });

  it("reuses the key after an unavailable outcome and after idempotency_in_progress", async () => {
    const { result } = renderHook(() => useCommand(run, signature));

    await act(async () => {
      const done = result.current.execute({ id: "a" });
      await settle(unavailable);
      await done;
    });
    await act(async () => {
      const done = result.current.execute({ id: "a" });
      await settle(unavailable);
      await done;
    });
    const reused = idempotencyKey(deferredFetches()[0]);
    expect(reused).toMatch(/^[A-Za-z0-9-]{16,64}$/);
    expect(idempotencyKey(deferredFetches()[1])).toBe(reused);

    await act(async () => {
      const done = result.current.execute({ id: "a" });
      await settle(inProgress);
      await done;
    });
    await act(async () => {
      const done = result.current.execute({ id: "a" });
      await settle(inProgress);
      await done;
    });
    expect(idempotencyKey(deferredFetches()[2])).toBe(reused);
    expect(idempotencyKey(deferredFetches()[3])).toBe(reused);

    await act(async () => {
      const done = result.current.execute({ id: "other" });
      await settle(unavailable);
      await done;
    });
    expect(idempotencyKey(deferredFetches()[4])).not.toBe(reused);
  });

  it("starts the next send with a new key after success or a definite refusal", async () => {
    const { result } = renderHook(() => useCommand(run, signature));

    await act(async () => {
      const done = result.current.execute({ id: "a" });
      await settle(succeeded);
      await done;
    });
    expect(result.current.state).toEqual({ phase: "done", value: { id: "a" }, replayed: false });
    await act(async () => {
      const done = result.current.execute({ id: "a" });
      await settle(succeeded);
      await done;
    });
    const first = idempotencyKey(deferredFetches()[0]);
    const second = idempotencyKey(deferredFetches()[1]);
    expect(second).not.toBe(first);

    await act(async () => {
      const done = result.current.execute({ id: "a" });
      await settle(refused);
      await done;
    });
    await act(async () => {
      const done = result.current.execute({ id: "a" });
      await settle(refused);
      await done;
    });
    expect(result.current.state).toEqual({ phase: "failed", failure: refused.failure });
    const third = idempotencyKey(deferredFetches()[2]);
    const fourth = idempotencyKey(deferredFetches()[3]);
    expect(third).not.toBe(second);
    expect(fourth).not.toBe(third);
  });
});
