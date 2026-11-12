/**
 * Money is held as integer minor units (fils / cents): never as floating point.
 * Sign convention across the system: debits positive, credits negative.
 */

/** Parse a spreadsheet cell into minor units. Returns null for blank, NaN for unparseable. */
export function parseAmount(cell: unknown): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return NaN;
    return Math.round(cell * 100);
  }
  let s = String(cell).trim();
  if (s === "" || s === "-" || s === "–") return null;

  let negative = false;
  // Accounting notation: (1,234.56) is negative.
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  const suffix = s.match(/\s*(dr|cr)\.?$/i);
  if (suffix) {
    if (suffix[1].toLowerCase() === "cr") negative = !negative;
    s = s.slice(0, suffix.index);
  }
  s = s.replace(/[,\s]/g, "").replace(/^[A-Za-z]{3}/, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d*(\.\d+)?$/.test(s) || s === "") return NaN;

  // Decimal-string arithmetic avoids float error on values like 1234.565.
  const [whole, frac = ""] = s.split(".");
  const padded = (frac + "000").slice(0, 3);
  let minor = Number(whole || "0") * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) minor += 1;
  return negative ? -minor : minor;
}

/** Format minor units for display, with brackets for negatives: (1,234.56). */
export function formatAmount(minor: number): string {
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  const text = `${whole}.${frac}`;
  return minor < 0 ? `(${text})` : text;
}
