"use client";

import { createContext, startTransition, useContext, useEffect, useMemo, useReducer, useState } from "react";
import {
  QRBatch,
  SEED_BATCHES,
  makeBatchId,
  makeQrId,
} from "@/lib/mock/qr";
import { useLifecycle } from "./LifecycleStore";
import { ModelApplication } from "@/lib/mock/lifecycle";

const KEY = "bee-qr-v1";

type Action =
  | { type: "HYDRATE"; batches: QRBatch[] }
  | { type: "REQUEST"; app: ModelApplication; quantity: number; period: string }
  | { type: "ALLOCATE"; id: string }
  | { type: "BIND"; id: string; count: number; duplicates: number }
  | { type: "RESET" };

function reducer(state: QRBatch[], action: Action): QRBatch[] {
  switch (action.type) {
    case "HYDRATE":
      return action.batches;
    case "RESET":
      return SEED_BATCHES;
    case "REQUEST": {
      const seq = state.length + 1;
      const a = action.app;
      const batch: QRBatch = {
        id: makeBatchId(seq),
        appId: a.id,
        brand: a.brand,
        model: a.model,
        regId: a.regId ?? "pending",
        rating: a.rating ?? 5,
        quantity: action.quantity,
        period: action.period,
        status: "requested",
        allocatedIds: [],
        boundSerials: 0,
        duplicates: 0,
        createdAt: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
      };
      return [batch, ...state];
    }
    case "ALLOCATE":
      return state.map((b) =>
        b.id === action.id && b.status === "requested"
          ? { ...b, status: "allocated", allocatedIds: Array.from({ length: 8 }, makeQrId) }
          : b
      );
    case "BIND":
      return state.map((b) =>
        b.id === action.id
          ? { ...b, status: "bound", boundSerials: b.boundSerials + action.count, duplicates: b.duplicates + action.duplicates }
          : b
      );
    default:
      return state;
  }
}

interface Ctx {
  batches: QRBatch[];
  activeModels: ModelApplication[];
  request: (app: ModelApplication, quantity: number, period: string) => void;
  allocate: (id: string) => void;
  bind: (id: string, count: number, duplicates: number) => void;
  reset: () => void;
  byId: (id: string | null | undefined) => QRBatch | undefined;
}

const QRCtx = createContext<Ctx | null>(null);

export function QRProvider({ children }: { children: React.ReactNode }) {
  const { apps } = useLifecycle();
  const [batches, dispatch] = useReducer(reducer, SEED_BATCHES);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    startTransition(() => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as QRBatch[];
          if (Array.isArray(parsed)) dispatch({ type: "HYDRATE", batches: parsed });
        }
      } catch {
        /* ignore */
      }
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(batches));
    } catch {
      /* ignore */
    }
  }, [batches, ready]);

  const value = useMemo<Ctx>(() => ({
    batches,
    activeModels: apps.filter((a) => a.stage === "active"),
    request: (app, quantity, period) => dispatch({ type: "REQUEST", app, quantity, period }),
    allocate: (id) => dispatch({ type: "ALLOCATE", id }),
    bind: (id, count, duplicates) => dispatch({ type: "BIND", id, count, duplicates }),
    reset: () => dispatch({ type: "RESET" }),
    byId: (id) => batches.find((b) => b.id === id),
  }), [batches, apps]);

  return <QRCtx.Provider value={value}>{children}</QRCtx.Provider>;
}

export function useQR(): Ctx {
  const ctx = useContext(QRCtx);
  if (!ctx) throw new Error("useQR must be used within QRProvider");
  return ctx;
}
