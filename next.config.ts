import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM and exceljs uses Node streams; keep both out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "exceljs", "docx"],
  experimental: {
    serverActions: {
      // Trial balances and working papers can exceed the 1MB default. Files are capped at 10 MB; the rest is form overhead.
      bodySizeLimit: "12mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
