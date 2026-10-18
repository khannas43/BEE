import type { NextConfig } from "next";

const publicOrigin = (() => {
  const configured = process.env.BEE_WEB_ORIGIN?.trim();
  if (!configured) return null;
  try {
    return new URL(configured);
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  // A remote demo uses a reverse tunnel while Next still listens on localhost.
  // Without these allow-lists Next serves the HTML but blocks the development
  // resources that hydrate the form, leaving buttons and inputs non-interactive.
  ...(publicOrigin ? { allowedDevOrigins: [publicOrigin.hostname] } : {}),
  ...(publicOrigin ? {
    experimental: {
      serverActions: { allowedOrigins: [publicOrigin.host] },
    },
  } : {}),
  logging: {
    // Off: the dev server's request lines include raw query strings (authorization code,
    // state, returnTo, probe parameters). Every /api route writes a structured line
    // instead (lib/server/requestLog.ts, docs/wp03/request-log.schema.json).
    incomingRequests: false,
  },
};

export default nextConfig;
