import type { NextConfig } from "next";

const PDFKIT_RUNTIME_FILES = ["./node_modules/pdfkit/js/standard-fonts/**/*", "./node_modules/pdfkit/js/data/sRGB_IEC61966_2_1.icc"];

// The Arabic font is read from disk when a name needs it (see src/server/pdf-arabic.ts).
const PDF_ROUTE_FILES = [...PDFKIT_RUNTIME_FILES, "./assets/fonts/noto-naskh-arabic/*"];

const nextConfig: NextConfig = {
  // PGlite ships WASM, exceljs uses Node streams and pg has optional native bindings; keep them out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "exceljs", "docx", "pdfkit"],
  // pdfkit loads its built-in Helvetica font data and its font modules through a package-internal import (#standard-fonts/*) at run time, which
  // the file tracer does not always follow. Name them, so they are in the PDF routes' deployed output on Vercel (checked after `npm run build`).
  outputFileTracingIncludes: {
    "/engagements/*/statements/pdf": PDF_ROUTE_FILES,
    "/engagements/*/audit/report/download": PDF_ROUTE_FILES,
    // The whole-file download makes the same PDFs.
    "/engagements/*/index/download-all": PDF_ROUTE_FILES,
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
