// Test-only module resolution so node --test can import the real route handlers and
// lib/server modules (WP03.3): "server-only" is a no-op, "@/x" is the repository root,
// and extensionless relative imports resolve to .ts. Used by npm run web:test.
import { register } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (!globalThis.__beeTestResolve) {
  globalThis.__beeTestResolve = true;
  register(import.meta.url, import.meta.url);
}

const ROOT = new URL("../../", import.meta.url);

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  let spec = specifier.startsWith("@/") ? new URL(specifier.slice(2), ROOT).href : specifier;
  if ((spec.startsWith(".") || spec.startsWith("file:")) && !/\.[cm]?[jt]sx?$|\.json$/.test(spec)) {
    const base = new URL(spec, context.parentURL ?? ROOT);
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      const candidate = new URL(base.href + ext);
      if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
  }
  try {
    return await next(spec, context);
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND" && /^[a-z@][^:]*\/[^.]+$/.test(spec)) return next(`${spec}.js`, context);
    throw err;
  }
}
