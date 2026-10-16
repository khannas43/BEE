"use client";

import { useEffect, useState } from "react";

/** "on" when demo sign-in is enabled (BEE_DEMO_LOGIN=1 on the web process). Unknown or failed lookups count as "off" once settled. */
export function useDemoMode(): "unknown" | "on" | "off" {
  const [demo, setDemo] = useState<"unknown" | "on" | "off">("unknown");
  useEffect(() => {
    let live = true;
    fetch("/api/runtime/demo/login", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => live && setDemo(b && b.enabled === true ? "on" : "off"))
      .catch(() => live && setDemo("off"));
    return () => { live = false; };
  }, []);
  return demo;
}
