import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_RUNTIME_READ_ONLY_PROVEN, adminRuntimeRoutesMissingCoverage } from "@/lib/adminMenuCoverage";

const ROOT = join(import.meta.dirname, "../../..");

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

const backendTests = walkFiles(join(ROOT, "backend/src/test/java")).filter((p) => p.endsWith(".java"));
const uiTests = walkFiles(join(ROOT, "components")).concat(walkFiles(join(ROOT, "lib"))).filter((p) => /\.test\.tsx?$/.test(p));

function backendTestSource(className: string): string {
  const file = backendTests.find((p) => p.endsWith(`/${className}.java`));
  if (!file) throw new Error(`No backend test class ${className}`);
  return readFileSync(file, "utf8");
}

function uiTestSource(fileName: string): string {
  const file = uiTests.find((p) => p.endsWith(`/${fileName}`));
  if (!file) throw new Error(`No UI test file ${fileName}`);
  return readFileSync(file, "utf8");
}

describe("Admin menu read-only coverage (Brief C3A)", () => {
  it("every Admin available runtime menu route is proven or documented in NOT_IN_MENU", () => {
    const missing = adminRuntimeRoutesMissingCoverage();
    expect(missing, `Add ADMIN_RUNTIME_READ_ONLY_PROVEN or NOT_IN_MENU for: ${missing.join(", ")}`).toEqual([]);
  });

  it("documents at least the operational routes fixed in C3A", () => {
    for (const href of [
      "/app/manufacturer/onboarding",
      "/app/registrations/requests",
      "/app/registrations/register",
      "/app/finance/finance-queue",
      "/app/workflow/personal-inbox",
    ]) {
      expect(ADMIN_RUNTIME_READ_ONLY_PROVEN[href], href).toBeTruthy();
    }
  });

  it("every coverage entry names real backend and UI tests", () => {
    const missing: string[] = [];
    for (const [href, proof] of Object.entries(ADMIN_RUNTIME_READ_ONLY_PROVEN)) {
      if (proof.backend) {
        for (const ref of proof.backend) {
          const [className, method] = ref.split(".");
          try {
            const src = backendTestSource(className);
            if (!src.includes(`void ${method}(`)) missing.push(`${href} backend ${ref}`);
          } catch {
            missing.push(`${href} backend class ${className}`);
          }
        }
      }
      for (const ref of proof.ui) {
        const [fileName, title] = ref.split(": ");
        try {
          const src = uiTestSource(fileName);
          if (!src.includes(`it("${title}"`) && !src.includes(`it('${title}'`)) missing.push(`${href} ui ${ref}`);
        } catch {
          missing.push(`${href} ui file ${fileName}`);
        }
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });
});
