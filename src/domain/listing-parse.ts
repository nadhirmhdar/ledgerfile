import { parseAmount } from "./money";
import { parseCsv } from "./tb-parse";
import { MAX_SCHEDULE_LINES } from "./test-schedule";

/** One line of a client's listing, ready to put on a schedule. */
export interface ListingLine {
  description: string;
  docRef: string | null;
  /** Minor units, as listed (no sign is changed). */
  amountMinor: number;
}

export interface ListingRejected {
  /** Row number in the file or paste, counting from 1. */
  row: number;
  reason: string;
}

export interface ListingParseResult {
  lines: ListingLine[];
  /** Rows that could not be read. The rest are still returned, unlike the trial balance import. */
  rejected: ListingRejected[];
  /** Why nothing can be imported at all (no recognisable columns, too many lines); empty when something can. */
  errors: string[];
  layout: Record<string, number>;
  totalMinor: number;
}

type Cell = unknown;
const text = (cell: Cell) => (cell === null || cell === undefined ? "" : String(cell).trim());

const HEADER_PATTERNS: [string, RegExp][] = [
  ["amount", /^(closing\s*|outstanding\s*|net\s*|total\s*)?(amount|balance|value|cost|outstanding)(\s*\(?[a-z]{3}\)?)?$|^amount\b/i],
  ["docRef", /^(invoice|document|doc|voucher|reference|ref|account|a\/?c|gl|code)(\s*(no\.?|number|#|code|ref(erence)?))?$|^(no\.?|number|#)$/i],
  ["description", /^(description|details?|particulars|narration|name|supplier|vendor|customer|client|party|payee|item|asset|account name|related party)$/i],
];

function detectHeader(rows: Cell[][]): { index: number; layout: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const layout: Record<string, number> = {};
    rows[i].forEach((cell, col) => {
      const t = text(cell);
      if (!t) return;
      for (const [key, pattern] of HEADER_PATTERNS) {
        if (!(key in layout) && !Object.values(layout).includes(col) && pattern.test(t)) {
          layout[key] = col;
          break;
        }
      }
    });
    if ("description" in layout && "amount" in layout) return { index: i, layout };
  }
  return null;
}

/**
 * Read a client's listing from a grid of cells (an Excel or CSV file, or a paste). It finds the description and amount columns
 * by their headings, takes a reference column if there is one, skips blank and total rows, and reports each row it could not read
 * without dropping the rows it could.
 */
export function parseListing(rows: Cell[][], cap: number = MAX_SCHEDULE_LINES): ListingParseResult {
  const result: ListingParseResult = { lines: [], rejected: [], errors: [], layout: {}, totalMinor: 0 };
  const header = detectHeader(rows);
  if (!header) {
    result.errors.push("Could not find the columns. The listing needs a heading row with a description column (such as Description, Name or Supplier) and an amount column (such as Amount or Balance).");
    return result;
  }
  const { layout } = header;
  result.layout = layout;

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 1;
    const description = text(row[layout.description]);
    const cellAmount = row[layout.amount];
    const blank = text(cellAmount) === "";
    if (!description && blank) continue;
    if (/^(grand\s*)?totals?\b/i.test(description)) continue;
    if (!description) {
      result.rejected.push({ row: line, reason: "has an amount but no description" });
      continue;
    }
    if (blank) {
      // A heading within the list has no amount; it is skipped quietly. A line with a description and no amount is reported.
      result.rejected.push({ row: line, reason: "has no amount" });
      continue;
    }
    const amount = parseAmount(cellAmount);
    if (amount === null || Number.isNaN(amount)) {
      result.rejected.push({ row: line, reason: "amount is not a number" });
      continue;
    }
    if (description.length > 500) {
      result.rejected.push({ row: line, reason: "description is longer than 500 characters" });
      continue;
    }
    const docRef = "docRef" in layout ? text(row[layout.docRef]) : "";
    result.lines.push({ description, docRef: docRef ? docRef.slice(0, 100) : null, amountMinor: amount });
  }
  if (result.lines.length > cap) {
    result.errors.push(`The listing has ${result.lines.length.toLocaleString("en-US")} lines; a schedule holds at most ${cap.toLocaleString("en-US")}. Split it across schedules.`);
    result.lines = [];
  }
  result.totalMinor = result.lines.reduce((s, l) => s + l.amountMinor, 0);
  return result;
}

/**
 * Turn pasted text into a grid. A paste from Excel is tab-separated, so tabs are tried first and amounts such as 1,234.56
 * are not split at the comma; text with no tabs is read as CSV.
 */
export function gridFromText(pasted: string): string[][] {
  const clean = pasted.replace(/\r\n?/g, "\n");
  if (clean.includes("\t")) return clean.split("\n").map((l) => l.split("\t"));
  return parseCsv(clean).map((r) => r.map((c) => String(c ?? "")));
}
