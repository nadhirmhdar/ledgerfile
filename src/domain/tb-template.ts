import { parseAmount } from "./money";
import { text, type Cell, type TbParseResult } from "./tb-parse";

/**
 * The LedgerFile trial balance template: its fixed headings, how a file is recognised as the template, and how a filled template is read. Pure.
 *
 * A file with the hidden marker sheet, or with exactly these six headings in a row near the top, is read as the template with certainty: no guessing and no
 * chooser. Rows whose name ends in "(sample)" are the template's examples and are ignored on import (and listed as left out), so a person who forgets to
 * delete them gets no wrong accounts.
 */

export const TEMPLATE_URL = "/trial-balance-template.xlsx";
export const TEMPLATE_FILE_NAME = "ledgerfile-trial-balance-template.xlsx";
export const TEMPLATE_LINK_TEXT = "Download our template";
export const TEMPLATE_SHEET = "Trial balance";
export const INSTRUCTIONS_SHEET = "Instructions";
export const MARKER_SHEET = "_ledgerfile";
export const MARKER_TEXT = "LedgerFile trial balance template";
export const TEMPLATE_VERSION = 1;

export const TEMPLATE_HEADINGS = ["Account code", "Account name", "Debit", "Credit", "Prior year debit", "Prior year credit"] as const;
export type TemplateHeading = (typeof TEMPLATE_HEADINGS)[number];

/** The totals row sits below this many account rows, so it is not in the way of the accounts. */
export const TEMPLATE_ACCOUNT_ROWS = 500;
export const SAMPLE_MARK = "(sample)";

/** The example rows: they balance, and are ignored on import. Amounts in whole units. */
export const SAMPLE_ROWS: { code: string; name: string; debit?: number; credit?: number }[] = [
  { code: "1000", name: `Cash at bank ${SAMPLE_MARK}`, debit: 1000 },
  { code: "3000", name: `Share capital ${SAMPLE_MARK}`, credit: 600 },
  { code: "4000", name: `Sales ${SAMPLE_MARK}`, credit: 400 },
];

export const INSTRUCTIONS: string[] = [
  "How to fill in this trial balance",
  "Use one line for each account.",
  "Enter an amount in Debit or in Credit, not in both on the same line.",
  "The prior year columns are optional. Fill them in only if you have last year's balances.",
  "Leave the headings in the first row as they are. If you change or delete one, the file is read like any other spreadsheet, and you may be asked which column is which.",
  `A line whose account name ends in ${SAMPLE_MARK} is an example. It is ignored when you upload, so you may leave it or delete it.`,
  "The Total line is optional. It is skipped when you upload.",
  "The trial balance must balance: total debits equal total credits.",
  "Save the file as .xlsx (or .csv) and upload it on the trial balance page.",
];

const norm = (value: unknown): string => text(value as Cell).toLowerCase().replace(/\s+/g, " ");
const WANTED = TEMPLATE_HEADINGS.map((h) => norm(h));
const SEARCH_ROWS = 20;

export interface SheetGrid {
  name: string;
  rows: unknown[][];
}

export type TemplateReading =
  | { kind: "template"; sheetIndex: number; headerRow: number; columns: Record<TemplateHeading, number> }
  | { kind: "edited"; sheetIndex: number; changed: TemplateHeading[] };

/** The sentence when the file is the template but a heading was changed. */
export const headingsChangedMessage = (changed: string[]): string => `This looks like the LedgerFile template, but a heading was changed: ${changed.join(", ")}.`;

function columnsIn(row: unknown[]): Partial<Record<TemplateHeading, number>> {
  const found: Partial<Record<TemplateHeading, number>> = {};
  const taken = new Set<number>();
  TEMPLATE_HEADINGS.forEach((heading, n) => {
    const col = row.findIndex((cell, c) => !taken.has(c) && norm(cell) === WANTED[n]);
    if (col >= 0) {
      found[heading] = col;
      taken.add(col);
    }
  });
  return found;
}

/**
 * Is this workbook the template? Exactly the six headings in one of the opening rows of a sheet says yes, whether or not the marker sheet is there. The
 * marker sheet without all the headings says it is the template with a heading changed or a column deleted, and which. Anything else is not the template.
 */
export function recogniseTemplate(sheets: SheetGrid[]): TemplateReading | null {
  const marker = sheets.some((s) => s.name === MARKER_SHEET && text(s.rows[0]?.[0] as Cell) === MARKER_TEXT);
  for (const [sheetIndex, sheet] of sheets.entries()) {
    if (sheet.name === MARKER_SHEET) continue;
    for (let i = 0; i < Math.min(sheet.rows.length, SEARCH_ROWS); i++) {
      const found = columnsIn(sheet.rows[i]);
      if (TEMPLATE_HEADINGS.every((h) => found[h] !== undefined)) return { kind: "template", sheetIndex, headerRow: i, columns: found as Record<TemplateHeading, number> };
    }
  }
  if (!marker) return null;
  // The marker is there, so say which headings are missing from the template sheet: its best row in the opening rows.
  const sheetIndex = Math.max(0, sheets.findIndex((s) => s.name === TEMPLATE_SHEET));
  const rows = sheets[sheetIndex]?.rows ?? [];
  let best: Partial<Record<TemplateHeading, number>> = {};
  for (let i = 0; i < Math.min(rows.length, SEARCH_ROWS); i++) {
    const found = columnsIn(rows[i]);
    if (Object.keys(found).length > Object.keys(best).length) best = found;
  }
  return { kind: "edited", sheetIndex, changed: TEMPLATE_HEADINGS.filter((h) => best[h] === undefined) };
}

export interface TemplateSkip {
  row: number;
  reason: string;
}
export interface TemplateParse extends TbParseResult {
  /** Example rows left out, each with its row. */
  skipped: TemplateSkip[];
}

const isSample = (name: string) => name.toLowerCase().endsWith(SAMPLE_MARK);

/** Read the accounts of a template sheet. Every message names its row. */
export function parseTemplate(rows: Cell[][], headerRow: number, columns: Record<TemplateHeading, number>): TemplateParse {
  const result: TemplateParse = { accounts: [], errors: [], warnings: [], differenceMinor: 0, balanced: false, layout: {}, skipped: [] };
  const seen = new Map<string, number>();
  const amount = (row: Cell[], heading: TemplateHeading) => parseAmount(row[columns[heading]]);

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 1;
    const code = text(row[columns["Account code"]]);
    const name = text(row[columns["Account name"]]);
    if (!code && !name) continue;
    // The totals line repeats the column sums and is not an account.
    if (/^(grand\s*)?totals?\b/i.test(code) || /^(grand\s*)?totals?\b/i.test(name)) continue;
    if (isSample(name)) {
      result.skipped.push({ row: line, reason: `an example row, because its name ends in ${SAMPLE_MARK}` });
      continue;
    }

    const values = { dr: amount(row, "Debit"), cr: amount(row, "Credit"), pdr: amount(row, "Prior year debit"), pcr: amount(row, "Prior year credit") };
    const bad = (["Debit", "Credit", "Prior year debit", "Prior year credit"] as TemplateHeading[]).filter((h) => Number.isNaN(amount(row, h)));
    if (bad.length > 0) {
      result.errors.push(`Row ${line}: ${bad.join(" and ")} ${bad.length === 1 ? "is" : "are"} not a number.`);
      continue;
    }
    if (!name) {
      result.errors.push(`Row ${line}: account ${code} has no name.`);
      continue;
    }
    const both = (a: number | null, b: number | null) => a !== null && b !== null && a !== 0 && b !== 0;
    if (both(values.dr, values.cr)) {
      result.errors.push(`Row ${line}: ${code ? `account ${code}` : `"${name}"`} has both a Debit and a Credit. Use one of them.`);
      continue;
    }
    if (both(values.pdr, values.pcr)) {
      result.errors.push(`Row ${line}: ${code ? `account ${code}` : `"${name}"`} has both a Prior year debit and a Prior year credit. Use one of them.`);
      continue;
    }
    const hasPrior = values.pdr !== null || values.pcr !== null;
    if (values.dr === null && values.cr === null && !hasPrior) continue; // a heading line within the list

    const key = code || name;
    if (seen.has(key)) {
      result.errors.push(`Row ${line}: account "${key}" also appears on row ${seen.get(key)}.`);
      continue;
    }
    seen.set(key, line);
    result.accounts.push({ code: key, name, closingMinor: (values.dr ?? 0) - (values.cr ?? 0), priorMinor: hasPrior ? (values.pdr ?? 0) - (values.pcr ?? 0) : null });
  }

  if (result.accounts.length === 0 && result.errors.length === 0) {
    result.errors.push(result.skipped.length > 0 ? `Only the example rows ${SAMPLE_MARK} were found, and they are ignored. Add your accounts to the sheet.` : "No accounts were found below the heading row.");
  }
  const priorTotal = result.accounts.reduce((sum, a) => sum + (a.priorMinor ?? 0), 0);
  if (priorTotal !== 0) result.warnings.push("The prior year columns do not add to zero. Check them: comparatives may be wrong.");
  result.differenceMinor = result.accounts.reduce((sum, a) => sum + a.closingMinor, 0);
  result.balanced = result.errors.length === 0 && result.accounts.length > 0 && result.differenceMinor === 0;
  return result;
}
