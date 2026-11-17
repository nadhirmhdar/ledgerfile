import type { NextConfig } from "next";

const PDFKIT_RUNTIME_FILES = ["./node_modules/pdfkit/js/standard-fonts/**/*", "./node_modules/pdfkit/lib/**/*", "./node_modules/pdfkit/js/data/sRGB_IEC61966_2_1.icc"];

const nextConfig: NextConfig = {
  // PGlite ships WASM, exceljs uses Node streams and pg has optional native bindings; keep them out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "exceljs", "docx", "pdfkit"],
  // pdfkit loads its built-in Helvetica font data and its #fs, #zlib and #stream helpers through package-internal imports at run time, which
  // the file tracer does not always follow. Name them, so they are in the PDF routes' deployed output on Vercel (checked after `npm run build`).
  outputFileTracingIncludes: {
    "/engagements/*/statements/pdf": PDFKIT_RUNTIME_FILES,
    "/engagements/*/audit/report/download": PDFKIT_RUNTIME_FILES,
  },
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
