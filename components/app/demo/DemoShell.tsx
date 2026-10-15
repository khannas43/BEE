import type { CSSProperties } from "react";

/** Scope for the demo screens' shared look (app/globals.css, .demo-screen). The icon is a Material Symbols name shown beside the page title. */
export function DemoShell({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="demo-screen" style={{ "--demo-icon": `"${icon}"` } as CSSProperties}>
      {children}
    </div>
  );
}

const TONES: [RegExp, string][] = [
  [/not submitted|none|draft/i, "bg-[#eef2f7] text-[#475569] border-[#d8e0ea]"],
  [/fail|revok|reject|void|mismatch|declin/i, "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]"],
  [/pending|initiated|submitted|query|amend|waiting/i, "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]"],
  [/paid|active|commit|accept|bound|open|match|valid|approved/i, "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]"],
];

/** A small coloured status label. The text is unchanged; only the colour follows it. */
export function Pill({ children }: { children: React.ReactNode }) {
  const text = typeof children === "string" ? children : "";
  const tone = TONES.find(([re]) => re.test(text))?.[1] ?? "bg-[#e7effb] text-[#14315E] border-[#c9d9f7]";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold leading-4 ${tone}`}>{children}</span>;
}
