import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM and exceljs uses Node streams; keep both out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "exceljs", "docx"],
  experimental: {
    serverActions: {
      // Trial balance uploads can exceed the 1MB default.
      bodySizeLimit: "10mb",
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
