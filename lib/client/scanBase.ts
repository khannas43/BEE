"use client";

import { useEffect, useState } from "react";

/**
 * The address a label's QR code points at. A phone cannot open this laptop's 127.0.0.1, so the demonstration runs a small scan gateway
 * (`npm run demo:scan-gateway`) that serves only the public verification page on the laptop's Wi-Fi address; this asks it for that address.
 * Without it the portal's own address is used, which only this laptop can open.
 */
export type ScanBase = { base: string; viaGateway: boolean; loading: boolean };

const GATEWAY_PORT = 3101;

export function useScanBase(): ScanBase {
  const [state, setState] = useState<ScanBase>({ base: "", viaGateway: false, loading: true });
  useEffect(() => {
    let live = true;
    const own = window.location.origin;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 1500);
    fetch(`http://127.0.0.1:${GATEWAY_PORT}/__scan-info`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; base?: string } | null) => {
        if (live) setState(j?.ok && j.base ? { base: j.base, viaGateway: true, loading: false } : { base: own, viaGateway: false, loading: false });
      })
      .catch(() => { if (live) setState({ base: own, viaGateway: false, loading: false }); })
      .finally(() => window.clearTimeout(timer));
    return () => { live = false; ctrl.abort(); };
  }, []);
  return state;
}
