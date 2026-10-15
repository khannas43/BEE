"use client";

import { Suspense } from "react";
import { Module, Screen } from "@/lib/screens";
import { ScreenScaffold } from "./ScreenScaffold";
import { DEEP_SCREENS } from "./deepScreens";

/**
 * Renders a rich, interlinked implementation when one exists for this
 * module/screen, otherwise the generic archetype scaffold. Wrapped in Suspense
 * because deep screens may read search params (?id=) for the selected item.
 */
export function AppScreen({ module, screen }: { module: Module; screen: Screen }) {
  const Deep = DEEP_SCREENS[`${module.id}/${screen.id}`];
  // Insights and AI screens share the demonstration look (app/globals.css, .insights-screen).
  const wrap = (node: React.ReactNode) => (module.id === "mis-ai" ? <div className="insights-screen">{node}</div> : node);
  if (Deep) {
    return wrap(
      <Suspense fallback={<div className="p-space-lg font-body-md text-body-md text-on-surface-variant">Loading…</div>}>
        <Deep module={module} screen={screen} />
      </Suspense>,
    );
  }
  return wrap(<ScreenScaffold module={module} screen={screen} />);
}
