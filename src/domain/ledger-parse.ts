import { parseAmount } from "./money";

/** One line of the client's journal listing. Amounts are minor units; debit positive, credit negative. */
export interface LedgerLine {
  entryNo: string;
  /** YYYY-MM-DD */
  date: string;
  postedBy: string | null;
  description: string | null;
  accountCode: string;
  accountName: string | null;
  amountMinor: number;
}

export interface LedgerParseResult {
  lines: LedgerLine[];
  errors: string[];
  layout: Record<string, number>;
}

export const MAX_LEDGER_LINES = 50000;

type Cell = unknown;
const text = (cell: Cell) => (cell === null || cell === undefined ? "" : String(cell).trim());

// Checked in this order, so "Journal date" is taken as the date before "Journal" can match the entry number.
const HEADER_PATTERNS: [string, RegExp][] = [
  ["date", /^(posting|entry|journal|transaction|doc(ument)?|gl)?\s*date$/i],
  ["entry", /^(journal|entry|voucher|doc(ument)?|transaction|je|batch)\s*(entry)?\s*(no\.?|number|#|id|ref(erence)?)?$|^ref(erence)?(\s*(no\.?|number))?$/i],
  ["accountCode", /^(a\/?c|acc(ount)?|gl)\s*(code|no\.?|number|#)$|^account$/i],
  ["accountName", /^(a\/?c|acc(ount)?|gl)?\s*(name|title)$/i],
  ["description", /^(line\s*)?(description|narration|memo|particulars|details)$/i],
  ["debit", /^(debit|dr\.?)(\s*amount)?$/i],
  ["credit", /^(credit|cr\.?)(\s*amount)?$/i],
  ["amount", /^(amount|net|value)$/i],
  ["user", /^(posted|entered|created|prepared)\s*by$|^user(\s*(name|id))?$/i],
];

function detectHeader(rows: Cell[][]): { index: number; layout: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const layout: Record<string, number> = {};
    rows[i].forEach((cell, col) => {
      const t = text(cell);
      if (!t) return;
      for (const [key, pattern] of HEADER_PATTERNS) {
        if (!(key in layout) && pattern.test(t)) {
          layout[key] = col;
          break;
        }
      }
    });
    const amounts = "amount" in layout || ("debit" in layout && "credit" in layout);
    if ("date" in layout && "entry" in layout && "accountCode" in layout && amounts) return { index: i, layout };
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Read a date cell as YYYY-MM-DD. Day-first is assumed for numeric dates (31/12/2025),
 * as used in the UAE; a month-first file must be converted before upload.
 */
export function parseDate(cell: Cell): string | null {
  const t = text(cell);
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;
  if ((match = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = t.match(/^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{4})$/))) {
    d = Number(match[1]);
    m = MONTHS.indexOf(match[2].toLowerCase()) + 1;
    y = Number(match[3]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  // Rejects impossible dates such as 31 February, which Date would roll forward.
  if (m < 1 || m > 12 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Parse a journal listing from a grid of cells. Every entry must balance, or the listing is rejected. */
export function parseLedger(rows: Cell[][]): LedgerParseResult {
  const result: LedgerParseResult = { lines: [], errors: [], layout: {} };
  const header = detectHeader(rows);
  if (!header) {
    result.errors.push("Could not find a header row. The listing needs columns for date, journal or entry number, account code, and either Debit and Credit or a single Amount.");
    return result;
  }
  const { layout } = header;
  result.layout = layout;
  const fail = (message: string) => {
    if (result.errors.length < 20) result.errors.push(message);
  };

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 1;
    const entryNo = text(row[layout.entry]);
    const accountCode = text(row[layout.accountCode]);
    if (!entryNo && !accountCode) continue;
    if (/^(grand\s*)?totals?\b/i.test(entryNo) || /^(grand\s*)?totals?\b/i.test(accountCode)) continue;
    if (!entryNo) {
      fail(`Row ${line}: no journal or entry number.`);
      continue;
    }
    if (!accountCode) {
      fail(`Row ${line}: no account code.`);
      continue;
    }
    const date = parseDate(row[layout.date]);
    if (!date) {
      fail(`Row ${line}: the date "${text(row[layout.date])}" was not recognised. Use a date such as 31/12/2025 or 2025-12-31.`);
      continue;
    }
    let amount: number;
    if ("debit" in layout && "credit" in layout) {
      const dr = parseAmount(row[layout.debit]);
      const cr = parseAmount(row[layout.credit]);
      if (Number.isNaN(dr) || Number.isNaN(cr)) {
        fail(`Row ${line}: amount is not a number.`);
        continue;
      }
      amount = (dr ?? 0) - (cr ?? 0);
    } else {
      const value = parseAmount(row[layout.amount]);
      if (Number.isNaN(value)) {
        fail(`Row ${line}: amount is not a number.`);
        continue;
      }
      amount = value ?? 0;
    }
    if (amount === 0) continue;
    if (result.lines.length >= MAX_LEDGER_LINES) {
      result.errors = [`The listing has more than ${MAX_LEDGER_LINES.toLocaleString("en-US")} lines. Split it by period and import the part to be tested.`];
      return result;
    }
    result.lines.push({
      entryNo,
      date,
      postedBy: "user" in layout ? text(row[layout.user]) || null : null,
      description: "description" in layout ? text(row[layout.description]) || null : null,
      accountCode,
      accountName: "accountName" in layout ? text(row[layout.accountName]) || null : null,
      amountMinor: amount,
    });
  }

  if (result.lines.length === 0 && result.errors.length === 0) result.errors.push("No journal lines were found below the header row.");

  // A listing whose entries do not balance is incomplete or mis-read, so it is not imported.
  const totals = new Map<string, number>();
  for (const l of result.lines) totals.set(l.entryNo, (totals.get(l.entryNo) ?? 0) + l.amountMinor);
  const unbalanced = [...totals].filter(([, total]) => total !== 0);
  for (const [entryNo, total] of unbalanced.slice(0, 10)) fail(`Entry ${entryNo} does not balance: debits and credits differ by ${(Math.abs(total) / 100).toFixed(2)}.`);
  if (unbalanced.length > 10) fail(`${unbalanced.length - 10} more entries do not balance.`);
  return result;
}
