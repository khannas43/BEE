import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: {
    // The callback query carries the one-time authorization code and state.
    incomingRequests: { ignore: [/\/api\/auth\/callback/] },
  },
};

export default nextConfig;
