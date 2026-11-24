import { detectHeader, NO_HEADER, parseWithHeader, text, type Cell, type TbParseResult } from "./tb-parse";

/**
 * Which column of a trial balance sheet is which. Pure.
 *
 * Reading a sheet tries, in order: the columns the user has just chosen, the headings remembered for this client, the automatic detection that has
 * always been there, and if none of them reads the sheet, a chooser. A layout is the heading row and, for each role, a column (both 0-based).
 */

export type Role = "code" | "name" | "debit" | "credit" | "balance" | "prior";
export const ROLES: Role[] = ["code", "name", "debit", "credit", "balance", "prior"];
export const ROLE_LABEL: Record<Role, string> = { code: "Account code", name: "Account name", debit: "Debit", credit: "Credit", balance: "Balance", prior: "Prior year" };

export type LayoutSource = "remembered" | "detected" | "chosen" | "recognised";
export const SOURCE_SENTENCE: Record<LayoutSource, string> = {
  remembered: "Columns as remembered for this client",
  detected: "Columns detected",
  chosen: "Columns you chose",
  recognised: "Columns recognised from the layout of the sheet",
};

export interface Layout {
  headerRow: number;
  columns: Partial<Record<Role, number>>;
}

/** What is kept on the client: the heading text for each role (the way to find it again), and where it was (the fallback). */
export interface SavedLayout {
  headings: Partial<Record<Role, string>>;
  columns: Partial<Record<Role, number>>;
  headerRow: number;
}

export interface Preview {
  /** The first non-empty rows of the sheet, each with its row number in the sheet (0-based). */
  rows: { index: number; cells: string[] }[];
  columnCount: number;
  /** The row to start with as the heading row. */
  headerRow: number;
}

export const PREVIEW_ROWS = 10;
const MAX_COLUMNS = 20;
const SEARCH_ROWS = 20;

/** Case, spacing and years do not matter: "Closing  Dr", "closing dr", and "CY 2025" and "CY 2026" are the same heading. */
export const headingKey = (value: unknown): string =>
  text(value as Cell)
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The messages for a layout that cannot be read, in plain words. Empty when it is usable. */
export function validateLayout(layout: Layout, rowCount: number): string[] {
  const errors: string[] = [];
  const c = layout.columns;
  if (!Number.isInteger(layout.headerRow) || layout.headerRow < 0 || layout.headerRow >= rowCount) errors.push("Choose the heading row from the rows shown.");
  if (c.code === undefined && c.name === undefined) errors.push("Choose which column is the account code or the account name.");
  const hasDebit = c.debit !== undefined;
  const hasCredit = c.credit !== undefined;
  if (hasDebit !== hasCredit) errors.push("Choose both a Debit and a Credit column, or use one Balance column.");
  else if (!hasDebit && c.balance === undefined) errors.push("Choose a Debit and a Credit column, or one Balance column.");
  const used = Object.values(c).filter((x): x is number => x !== undefined);
  if (used.some((x) => !Number.isInteger(x) || x < 0 || x >= MAX_COLUMNS)) errors.push("Choose columns from the ones shown.");
  if (new Set(used).size !== used.length) errors.push("Each column can have one role only.");
  return errors;
}

/**
 * The layout the user chose, from the form: `headerRow` and `role_<column>` entries. Roles the form does not know, and "ignore", are left out.
 * `clashes` names any role chosen for more than one column (a role is one column).
 */
export function chosenFromEntries(entries: Record<string, string>): { layout: Layout; clashes: Role[] } {
  const columns: Partial<Record<Role, number>> = {};
  const duplicate = new Set<Role>();
  for (const [key, value] of Object.entries(entries)) {
    const m = /^role_(\d{1,2})$/.exec(key);
    if (!m || !(ROLES as string[]).includes(value)) continue;
    const role = value as Role;
    if (columns[role] !== undefined) duplicate.add(role);
    columns[role] = Number(m[1]);
  }
  return { layout: { headerRow: Number(entries.headerRow), columns }, clashes: [...duplicate] };
}

/** The headings to remember for a layout that was read from this sheet. */
export function savedFrom(rows: Cell[][], layout: Layout): SavedLayout {
  const headings: Partial<Record<Role, string>> = {};
  for (const role of ROLES) {
    const col = layout.columns[role];
    if (col !== undefined) headings[role] = text(rows[layout.headerRow]?.[col]);
  }
  return { headings, columns: { ...layout.columns }, headerRow: layout.headerRow };
}

/** The headings the client was last read with, found again in this sheet: within the opening rows, wherever the columns have moved to. */
export function matchRemembered(rows: Cell[][], saved: SavedLayout): Layout | null {
  const wanted = (Object.entries(saved.headings) as [Role, string][]).filter(([, h]) => headingKey(h) !== "");
  if (wanted.length === 0) return null;
  for (let i = 0; i < Math.min(rows.length, SEARCH_ROWS); i++) {
    const columns: Partial<Record<Role, number>> = {};
    const taken = new Set<number>();
    for (const [role, heading] of wanted) {
      const col = rows[i].findIndex((cell, c) => !taken.has(c) && headingKey(cell) === headingKey(heading));
      if (col >= 0) {
        columns[role] = col;
        taken.add(col);
      }
    }
    if (Object.keys(columns).length === wanted.length) return { headerRow: i, columns };
  }
  // The headings were not found. Try the place they were in: the same row, with words in the same columns.
  const row = rows[saved.headerRow];
  const placed = (Object.entries(saved.columns) as [Role, number][]).filter(([, col]) => col !== undefined);
  if (row && placed.length > 0 && placed.every(([, col]) => text(row[col]) !== "" && !/^[\d\s,.()-]+$/.test(text(row[col]))) && placed.some(([role, col]) => headingKey(row[col]) === headingKey(saved.headings[role]))) {
    return { headerRow: saved.headerRow, columns: { ...saved.columns } };
  }
  return null;
}

/** The first rows with something in them, trimmed for showing, and a guess at the heading row (the first with text in the most columns). */
export function buildPreview(rows: Cell[][]): Preview {
  const shown = rows
    .map((row, index) => ({ index, cells: row.slice(0, MAX_COLUMNS).map((c) => text(c).slice(0, 40)) }))
    .filter((r) => r.cells.some((c) => c !== ""))
    .slice(0, PREVIEW_ROWS);
  const filled = (cells: string[]) => cells.filter((c) => c !== "").length;
  const best = shown.reduce((b, r) => (filled(r.cells) > filled(b.cells) ? r : b), shown[0] ?? { index: 0, cells: [] });
  return { rows: shown, columnCount: Math.max(0, ...shown.map((r) => r.cells.length)), headerRow: best.index };
}

export type Reading =
  | { kind: "parsed"; source: LayoutSource; layout: Layout; result: TbParseResult }
  | { kind: "choose"; preview: Preview; reason: string };

const asRecord = (c: Partial<Record<Role, number>>): Record<string, number> => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) as Record<string, number>;

/**
 * Read a sheet. `chosen` is what the user has just picked; `remembered` is what was kept for the client; `ask` shows the chooser whatever else works.
 * Anything that reads the sheet gives the same accounts it would give today: automatic detection is untouched and still the third step.
 */
export function readTrialBalance(rows: Cell[][], options: { chosen?: Layout | null; remembered?: SavedLayout | null; ask?: boolean } = {}): Reading {
  const choose = (reason: string): Reading => ({ kind: "choose", preview: buildPreview(rows), reason });
  if (options.chosen) {
    const errors = validateLayout(options.chosen, rows.length);
    if (errors.length > 0) return choose(errors.join(" "));
    return { kind: "parsed", source: "chosen", layout: options.chosen, result: parseWithHeader(rows, options.chosen.headerRow, asRecord(options.chosen.columns)) };
  }
  if (options.ask) return choose("Say which column is which.");
  const remembered = options.remembered ? matchRemembered(rows, options.remembered) : null;
  if (remembered && validateLayout(remembered, rows.length).length === 0) {
    return { kind: "parsed", source: "remembered", layout: remembered, result: parseWithHeader(rows, remembered.headerRow, asRecord(remembered.columns)) };
  }
  const detected = detectHeader(rows);
  if (detected) return { kind: "parsed", source: "detected", layout: { headerRow: detected.index, columns: detected.layout as Partial<Record<Role, number>> }, result: parseWithHeader(rows, detected.index, detected.layout) };
  return choose(NO_HEADER);
}
