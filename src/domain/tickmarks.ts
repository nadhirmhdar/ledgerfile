/**
 * The standard tickmarks: short marks an auditor puts against a line to say what was done to it. A line can carry several.
 * The meanings are written for this product. Firm-defined tickmarks are not supported yet.
 */
export interface Tickmark {
  /** Stored against the line. Never changes once released. */
  code: string;
  /** What is shown beside the line and in the legend. */
  symbol: string;
  meaning: string;
}

export const TICKMARKS: Tickmark[] = [
  { code: "doc", symbol: "✓", meaning: "Agreed to the supporting document (invoice, contract, statement or similar)." },
  { code: "gl", symbol: "L", meaning: "Agreed to the client's ledger or trial balance." },
  { code: "py", symbol: "P", meaning: "Agreed to the prior-year file or financial statements." },
  { code: "recalc", symbol: "R", meaning: "Recalculated, and the result agrees." },
  { code: "conf", symbol: "C", meaning: "Confirmed directly by a third party." },
  { code: "subs", symbol: "S", meaning: "Agreed to a receipt or payment after the period end." },
  { code: "na", symbol: "N/A", meaning: "Not applicable to this line." },
  { code: "nm", symbol: "NM", meaning: "Not material, so not tested further." },
  { code: "ms", symbol: "M", meaning: "Difference found and taken to the summary of misstatements." },
];

export const TICKMARK_CODES = new Set(TICKMARKS.map((t) => t.code));
export const TICKMARK_BY_CODE = new Map(TICKMARKS.map((t) => [t.code, t]));

/** Keep only known codes, once each, in the standard order. */
export function normaliseTickmarks(codes: unknown): string[] {
  const given = new Set(Array.isArray(codes) ? codes.filter((c): c is string => typeof c === "string") : []);
  return TICKMARKS.filter((t) => given.has(t.code)).map((t) => t.code);
}
