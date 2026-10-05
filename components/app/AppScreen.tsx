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
  if (Deep) {
    return (
      <Suspense fallback={<div className="p-space-lg font-body-md text-body-md text-on-surface-variant">Loading…</div>}>
        <Deep module={module} screen={screen} />
      </Suspense>
    );
  }
  return <ScreenScaffold module={module} screen={screen} />;
}
