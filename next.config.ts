import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: {
    // Off: the dev server's request lines include raw query strings (authorization code,
    // state, returnTo, probe parameters). Every /api route writes a structured line
    // instead (lib/server/requestLog.ts, docs/wp03/request-log.schema.json).
    incomingRequests: false,
  },
};

export default nextConfig;
