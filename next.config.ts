import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM, exceljs uses Node streams and pg has optional native bindings; keep them out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "exceljs", "docx"],
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
