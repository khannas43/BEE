"use client";

import { createContext, startTransition, useContext, useEffect, useMemo, useReducer, useState } from "react";
import {
  ModelApplication,
  SEED_APPLICATIONS,
  Stage,
  WorkflowTask,
  computeStars,
  deriveTasks,
  feeForCategory,
  makeAppId,
  makeRegId,
  nextStage,
} from "@/lib/mock/lifecycle";

const KEY = "bee-lifecycle-v1";

type Action =
  | { type: "HYDRATE"; apps: ModelApplication[] }
  | { type: "CREATE"; draft: NewApplicationDraft }
  | { type: "PAY_FEE"; id: string; actor: string }
  | { type: "ADVANCE"; id: string; note: string; actor: string }
  | { type: "RETURN"; id: string; reason: string; actor: string }
  | { type: "REJECT"; id: string; reason: string; actor: string }
  | { type: "SET_RATING"; id: string; actor: string }
  | { type: "GENERATE_LABEL"; id: string; actor: string }
  | { type: "RESET" };

export interface NewApplicationDraft {
  brand: string;
  model: string;
  family: string;
  category: string;
  capacityW: number;
  powerInputW: number;
  declaredIseer: number;
  standard: string;
  lab: string;
  testDate: string;
}

function now(): string {
  return new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + ", " +
    new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function addEvent(a: ModelApplication, label: string, actor: string): ModelApplication {
  return { ...a, updatedAt: now(), timeline: [...a.timeline, { at: now(), label, actor }] };
}

function reducer(state: ModelApplication[], action: Action): ModelApplication[] {
  switch (action.type) {
    case "HYDRATE":
      return action.apps;
    case "RESET":
      return SEED_APPLICATIONS;
    case "CREATE": {
      const seq = state.length + 1;
      const d = action.draft;
      const app: ModelApplication = {
        id: makeAppId(seq),
        brand: d.brand || "New Applicant",
        model: d.model || "New Model",
        family: d.family || d.model || "New Family",
        category: d.category || "Room ACs",
        capacityW: d.capacityW || 5000,
        powerInputW: d.powerInputW || 1000,
        declaredIseer: d.declaredIseer || 5.0,
        standard: d.standard || "IS 1391",
        lab: d.lab || "NABL-DEL-002",
        testDate: d.testDate || now(),
        stage: "fee_due",
        returned: false,
        createdAt: now(),
        updatedAt: now(),
        fee: feeForCategory(),
        feePaid: false,
        labelGenerated: false,
        findings: [{ text: "Awaiting fee confirmation", ok: false }],
        documents: [{ name: "Test report.pdf", version: "v1", scan: "scanning" }],
        timeline: [{ at: now(), label: "Application submitted", actor: d.brand || "Applicant" }],
      };
      return [app, ...state];
    }
    case "PAY_FEE":
      return state.map((a) =>
        a.id === action.id
          ? addEvent({ ...a, feePaid: true, stage: "iame_scrutiny", returned: false }, "Fee confirmed, assigned to IAME", action.actor)
          : a
      );
    case "ADVANCE":
      return state.map((a) => {
        if (a.id !== action.id) return a;
        const ns = nextStage(a.stage);
        return addEvent({ ...a, stage: ns, returned: false }, action.note, action.actor);
      });
    case "RETURN":
      return state.map((a) =>
        a.id === action.id ? addEvent({ ...a, returned: true }, `Returned: ${action.reason}`, action.actor) : a
      );
    case "REJECT":
      return state.map((a) =>
        a.id === action.id ? addEvent({ ...a, stage: "rejected" }, `Rejected: ${action.reason}`, action.actor) : a
      );
    case "SET_RATING":
      return state.map((a) => {
        if (a.id !== action.id) return a;
        const stars = computeStars(a.declaredIseer);
        return addEvent(
          { ...a, rating: stars, ratingIseer: a.declaredIseer, stage: nextStage(a.stage) },
          `Rating computed ${stars}★`,
          action.actor
        );
      });
    case "GENERATE_LABEL":
      return state.map((a) => {
        if (a.id !== action.id) return a;
        const seq = state.indexOf(a) + 1;
        return addEvent(
          { ...a, labelGenerated: true, stage: "active", qrBatch: `QB-2026-${(240 + seq).toString().padStart(4, "0")}`, regId: makeRegId(seq) },
          "Label generated & QR batch allocated", action.actor
        );
      });
    default:
      return state;
  }
}

interface Ctx {
  apps: ModelApplication[];
  tasks: WorkflowTask[];
  ready: boolean;
  create: (d: NewApplicationDraft) => void;
  payFee: (id: string, actor: string) => void;
  advance: (id: string, note: string, actor: string) => void;
  returnApp: (id: string, reason: string, actor: string) => void;
  reject: (id: string, reason: string, actor: string) => void;
  setRating: (id: string, actor: string) => void;
  generateLabel: (id: string, actor: string) => void;
  reset: () => void;
  appsAtStage: (stage: Stage) => ModelApplication[];
  byId: (id: string | null | undefined) => ModelApplication | undefined;
}

const LifecycleCtx = createContext<Ctx | null>(null);

export function LifecycleProvider({ children }: { children: React.ReactNode }) {
  const [apps, dispatch] = useReducer(reducer, SEED_APPLICATIONS);
  const [ready, setReady] = useState(false);

  // Hydrate from localStorage after mount.
  useEffect(() => {
    startTransition(() => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as ModelApplication[];
          if (Array.isArray(parsed) && parsed.length) dispatch({ type: "HYDRATE", apps: parsed });
        }
      } catch {
        /* ignore */
      }
      setReady(true);
    });
  }, []);

  // Persist on change — but only after hydration, so the initial SEED render
  // never clobbers previously-saved state.
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(apps));
    } catch {
      /* ignore */
    }
  }, [apps, ready]);

  const value = useMemo<Ctx>(() => {
    const tasks = deriveTasks(apps);
    return {
      apps,
      tasks,
      ready,
      create: (d) => dispatch({ type: "CREATE", draft: d }),
      payFee: (id, actor) => dispatch({ type: "PAY_FEE", id, actor }),
      advance: (id, note, actor) => dispatch({ type: "ADVANCE", id, note, actor }),
      returnApp: (id, reason, actor) => dispatch({ type: "RETURN", id, reason, actor }),
      reject: (id, reason, actor) => dispatch({ type: "REJECT", id, reason, actor }),
      setRating: (id, actor) => dispatch({ type: "SET_RATING", id, actor }),
      generateLabel: (id, actor) => dispatch({ type: "GENERATE_LABEL", id, actor }),
      reset: () => dispatch({ type: "RESET" }),
      appsAtStage: (stage) => apps.filter((a) => a.stage === stage),
      byId: (id) => apps.find((a) => a.id === id),
    };
  }, [apps, ready]);

  return <LifecycleCtx.Provider value={value}>{children}</LifecycleCtx.Provider>;
}

export function useLifecycle(): Ctx {
  const ctx = useContext(LifecycleCtx);
  if (!ctx) throw new Error("useLifecycle must be used within LifecycleProvider");
  return ctx;
}
