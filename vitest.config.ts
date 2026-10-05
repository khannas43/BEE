import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors tsconfig paths: "@/*" -> "./*". Matches "@/…" only, not "@scope/…" packages.
      "@": root,
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "components/app/kit/__tests__/**/*.test.tsx",
      "components/app/lifecycle/__tests__/**/*.test.tsx",
      "components/app/workflow/__tests__/**/*.test.{ts,tsx}",
      "components/app/admin/__tests__/**/*.test.tsx",
      "components/app/__tests__/**/*.test.tsx",
      "components/i18n/__tests__/**/*.test.tsx",
      "components/public/__tests__/**/*.test.tsx",
      "lib/client/__tests__/**/*.test.tsx",
    ],
    setupFiles: ["components/app/kit/__tests__/setup.ts"],
  },
});
