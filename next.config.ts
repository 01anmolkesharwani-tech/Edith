import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Do not leak internal URLs (contact/draft ids) to external sites opened from the app.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Every page reads per-profile data from the local database; nothing is worth caching.
  cacheComponents: false,
  poweredByHeader: false,
  // Native / Node-only packages are loaded at runtime rather than bundled.
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3", "pdf-parse", "imapflow", "nodemailer"],
  experimental: {
    serverActions: { bodySizeLimit: "6mb" }, // résumé uploads (max 5 MB) + CSV imports
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
