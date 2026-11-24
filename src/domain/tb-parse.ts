import { parseAmount } from "./money";

/** One trial balance account. Amounts are minor units; debit positive, credit negative. */
export interface TbAccount {
  code: string;
  name: string;
  closingMinor: number;
  priorMinor: number | null;
}

export interface TbParseResult {
  accounts: TbAccount[];
  errors: string[];
  warnings: string[];
  /** Sum of closing balances. Zero when the trial balance balances. */
  differenceMinor: number;
  balanced: boolean;
  /** Which columns were recognised, for showing the user what was detected. */
  layout: Record<string, number>;
  /** Rows left out, numbered as in the sheet (1-based), with the reason. Blank rows are not listed. Present when the reading reports them. */
  skipped?: { row: number; reason: string }[];
}

export type Cell = unknown;

const HEADER_PATTERNS: Record<string, RegExp> = {
  code: /^(a\/?c|acc(ount)?|gl|ledger)?\s*(code|no\.?|number|#)$|^code$/i,
  name: /^(account\s*)?(name|description|title|particulars)$|^account$/i,
  debit: /^(closing\s*)?(debit|dr\.?)(\s*(balance|amount))?$/i,
  credit: /^(closing\s*)?(credit|cr\.?)(\s*(balance|amount))?$/i,
  balance: /^(closing\s*)?(balance|amount|net)$|^(current\s*(year|period)|cy)(\s*balance)?$/i,
  prior: /^(prior|previous|last|comparative)\s*(year|period)?(\s*balance)?$|^py(\s*balance)?$|^opening(\s*balance)?$/i,
};

const COMBINED = [/^(\d[\w./-]*)\s*[-–:·•]\s*(.+)$/, /^(.+?)\s*\(\s*(\d[\w./-]*)\s*\)$/, /^(\d{3,}[\w./-]*)\s+(.+)$/];
/** An account code and name in one cell: "1100 - Debtors", "1100 Debtors" or "Debtors (1100)". Null when the cell does not look like that. */
export function splitCombined(value: string): { code: string; name: string } | null {
  const a = COMBINED[0].exec(value) ?? COMBINED[2].exec(value);
  if (a) return { code: a[1], name: a[2].trim() };
  const b = COMBINED[1].exec(value);
  return b ? { code: b[2], name: b[1].trim() } : null;
}

export function text(cell: Cell): string {
  return cell === null || cell === undefined ? "" : String(cell).trim();
}

export function detectHeader(rows: Cell[][]): { index: number; layout: Record<string, number> } | null {
  // The header is the first of the opening rows that names an account column and an amount column.
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const layout: Record<string, number> = {};
    rows[i].forEach((cell, col) => {
      const t = text(cell);
      if (!t) return;
      for (const [key, pattern] of Object.entries(HEADER_PATTERNS)) {
        if (!(key in layout) && pattern.test(t)) {
          layout[key] = col;
          break;
        }
      }
    });
    const hasAmounts = "balance" in layout || ("debit" in layout && "credit" in layout);
    if (("code" in layout || "name" in layout) && hasAmounts) return { index: i, layout };
  }
  return null;
}

/**
 * Parse a trial balance from a grid of cells (as read from Excel or CSV).
 * Accepts either Debit and Credit columns or a single signed Balance column.
 */
export function parseTrialBalance(rows: Cell[][]): TbParseResult {
  const result: TbParseResult = { accounts: [], errors: [], warnings: [], differenceMinor: 0, balanced: false, layout: {} };

  const header = detectHeader(rows);
  if (!header) {
    result.errors.push(NO_HEADER);
    return result;
  }
  return parseWithHeader(rows, header.index, header.layout);
}

export const NO_HEADER = "Could not find a header row. The sheet needs a column for account code or name, and either Debit and Credit columns or a Balance column.";

/** Read the accounts below a heading row, given which column holds what (0-based columns and row). Used for detected, remembered and chosen layouts alike. */
export function parseWithHeader(rows: Cell[][], headerIndex: number, layout: Record<string, number>): TbParseResult {
  const result: TbParseResult = { accounts: [], errors: [], warnings: [], differenceMinor: 0, balanced: false, layout: {} };
  const header = { index: headerIndex };
  result.layout = layout;
  const seen = new Map<string, number>();
  const skipped: { row: number; reason: string }[] = [];
  result.skipped = skipped;

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 1;
    let code = "code" in layout ? text(row[layout.code]) : "";
    let name = "name" in layout ? text(row[layout.name]) : "";
    if ("codename" in layout) {
      // One column holds both: split it when it can be split; otherwise the whole text is the name.
      const joined = text(row[layout.codename]);
      const split = splitCombined(joined);
      if (split) ({ code, name } = split);
      else name = joined;
    }
    if (!code && !name) continue;
    // Total lines repeat the column sums and must not be imported as accounts.
    if (/^(grand\s*)?totals?\b/i.test(code) || /^(grand\s*)?totals?\b/i.test(name)) {
      skipped.push({ row: line, reason: "A total line, not an account" });
      continue;
    }

    // An account closed during the year has no closing amount but still belongs in the comparatives.
    const priorOnly = "prior" in layout ? parseAmount(row[layout.prior]) : null;
    const hasPrior = typeof priorOnly === "number" && !Number.isNaN(priorOnly) && priorOnly !== 0;

    let closing: number;
    if ("debit" in layout && "credit" in layout) {
      const dr = parseAmount(row[layout.debit]);
      const cr = parseAmount(row[layout.credit]);
      if (Number.isNaN(dr) || Number.isNaN(cr)) {
        result.errors.push(`Row ${line}: amount is not a number.`);
        continue;
      }
      if (dr === null && cr === null && !hasPrior) {
        skipped.push({ row: line, reason: "No amount, so a heading line within the list" });
        continue;
      }
      closing = (dr ?? 0) - (cr ?? 0);
    } else {
      const bal = parseAmount(row[layout.balance]);
      if (Number.isNaN(bal)) {
        result.errors.push(`Row ${line}: amount is not a number.`);
        continue;
      }
      if (bal === null && !hasPrior) {
        skipped.push({ row: line, reason: "No amount, so a heading line within the list" });
        continue;
      }
      closing = bal ?? 0;
    }

    let prior: number | null = null;
    if ("prior" in layout) {
      const p = parseAmount(row[layout.prior]);
      if (Number.isNaN(p)) result.warnings.push(`Row ${line}: prior-year amount is not a number and was ignored.`);
      else prior = p;
    }

    const key = code || name;
    if (seen.has(key)) {
      result.errors.push(`Row ${line}: account "${key}" also appears on row ${seen.get(key)}.`);
      continue;
    }
    seen.set(key, line);
    result.accounts.push({ code: key, name: name || code, closingMinor: closing, priorMinor: prior });
  }

  if (result.accounts.length === 0 && result.errors.length === 0) {
    result.errors.push("No accounts were found below the header row.");
  }
  if ("prior" in layout) {
    const priorTotal = result.accounts.reduce((sum, a) => sum + (a.priorMinor ?? 0), 0);
    if (priorTotal !== 0) {
      result.warnings.push(
        "The Prior Year column does not add to zero. Check that credits in it are shown as negative or in brackets; comparatives may be wrong.",
      );
    }
  }
  result.differenceMinor = result.accounts.reduce((sum, a) => sum + a.closingMinor, 0);
  result.balanced = result.errors.length === 0 && result.accounts.length > 0 && result.differenceMinor === 0;
  return result;
}

/** Minimal RFC 4180 CSV reader: handles quoted fields, embedded commas and newlines. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = input.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
