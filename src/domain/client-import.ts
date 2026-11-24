/**
 * Importing a client list from a spreadsheet: finding the column of names, cleaning each name, and saying what would happen to each row.
 * Pure. The server classifies the names again against the database when the import is confirmed; this is only ever the preview's reading.
 *
 * A name is plain text: one that begins with =, +, - or @ is kept exactly as typed and never evaluated by anything.
 */

import { checkTrn, cleanAddress, MAX_ADDRESS, MAX_AUTHORITY, MAX_LICENCE, parseYearEndText, type ClientDetails } from "./client-details";

export const MAX_IMPORT_ROWS = 1000;
/** The limits of the Add client form. */
export const MIN_NAME = 2;
export const MAX_NAME = 200;

/** Heading words that mark the column of names, compared in lower case. */
export const NAME_HEADINGS = ["client name", "client", "name", "company", "entity"] as const;

/** Optional extra columns, found by their heading in the same row as the names (any case). A row still needs only a name. */
export const DETAIL_HEADINGS = {
  licenceNumber: ["licence number", "license number", "licence no", "license no", "trade licence", "trade license", "trade licence number", "licence", "license"],
  licensingAuthority: ["licensing authority", "licence authority", "license authority", "issuing authority"],
  taxRegistrationNumber: ["trn", "tax registration number", "tax registration no", "tax reg no", "tax registration"],
  yearEnd: ["year end", "year-end", "yearend", "financial year end", "financial year-end", "fye"],
  address: ["address", "registered address"],
} as const;
export type ImportDetailKey = keyof typeof DETAIL_HEADINGS;

/** The details an import row can carry, each already checked: one that did not pass is left out and named in the notes of its row. */
export type ImportDetails = Partial<Pick<ClientDetails, ImportDetailKey>>;

export type RowStatus = "add" | "existing" | "repeated" | "too_long" | "too_short";

export interface ImportRow {
  /** The number of the row in the file, as the user sees it. */
  line: number;
  name: string;
  status: RowStatus;
  /** The extra details read from this row (a row to be added only). */
  details?: ImportDetails;
  /** What was left out of the details of this row, and why. */
  notes?: string[];
}

/** A client to add: its name and the details that came with it. */
export interface ImportEntry {
  name: string;
  details: ImportDetails;
}

/** Check each extra value on its own, so one bad cell costs only that detail and never the client. */
export function readDetails(raw: Partial<Record<ImportDetailKey, unknown>>, line: number): { details: ImportDetails; notes: string[] } {
  const details: ImportDetails = {};
  const notes: string[] = [];
  const text = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  const licence = text(raw.licenceNumber);
  if (licence) {
    if (licence.length > MAX_LICENCE) notes.push(`Row ${line}: the licence number is longer than ${MAX_LICENCE} characters and was left out.`);
    else details.licenceNumber = licence;
  }
  const authority = text(raw.licensingAuthority);
  if (authority) {
    if (authority.length > MAX_AUTHORITY) notes.push(`Row ${line}: the licensing authority is longer than ${MAX_AUTHORITY} characters and was left out.`);
    else details.licensingAuthority = authority;
  }
  const trn = checkTrn(raw.taxRegistrationNumber);
  if (trn.ok) {
    if (trn.value) details.taxRegistrationNumber = trn.value;
  } else notes.push(`Row ${line}: the TRN does not have 15 digits and was left out.`);
  if (text(raw.yearEnd)) {
    const ye = parseYearEndText(raw.yearEnd);
    if (ye) details.yearEnd = ye;
    else notes.push(`Row ${line}: the year-end could not be read as a day and month (such as 31 March) and was left out.`);
  }
  const address = cleanAddress(raw.address);
  if (address) {
    if (address.length > MAX_ADDRESS) notes.push(`Row ${line}: the address is longer than ${MAX_ADDRESS} characters and was left out.`);
    else details.address = address;
  }
  return { details, notes };
}

/** An import item from the browser (a bare name, or a name with details) as checked details. Anything that does not pass is dropped, never trusted. */
export function entryFromItem(item: unknown, line: number): { name: unknown; details: ImportDetails } {
  if (typeof item === "string") return { name: item, details: {} };
  const o = (item && typeof item === "object" ? item : {}) as { name?: unknown; details?: Partial<Record<ImportDetailKey, unknown>> };
  return { name: o.name, details: readDetails(o.details ?? {}, line).details };
}

export interface ImportCounts {
  add: number;
  existing: number;
  repeated: number;
  blank: number;
  tooLong: number;
  tooShort: number;
}

/** Trim and collapse inner spaces (and tabs, and line breaks inside a cell). */
export const cleanName = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim();

/** What two names must share to be the same client: the cleaned name in lower case. */
export const nameKey = (name: string): string => cleanName(name).toLowerCase();

export const STATUS_LABEL: Record<RowStatus, string> = {
  add: "Will be added",
  existing: "Already a client",
  repeated: "Repeated in the file",
  too_long: "Too long",
  too_short: "Too short",
};

/**
 * Say what happens to each name. Blank names are skipped and only counted. A name that is already a client (the same key) is not added, nor is a
 * second copy of a name that appears earlier in the file: only the first copy is. A name over 200 characters, or under two, is not added.
 */
export function classifyNames(rows: { line: number; raw: unknown }[], existingNames: string[]): { rows: ImportRow[]; counts: ImportCounts } {
  const existing = new Set(existingNames.map(nameKey));
  const seen = new Set<string>();
  const counts: ImportCounts = { add: 0, existing: 0, repeated: 0, blank: 0, tooLong: 0, tooShort: 0 };
  const out: ImportRow[] = [];
  for (const { line, raw } of rows) {
    const name = cleanName(raw);
    if (name === "") {
      counts.blank++;
      continue;
    }
    let status: RowStatus;
    if (name.length > MAX_NAME) status = "too_long";
    else if (name.length < MIN_NAME) status = "too_short";
    else if (existing.has(nameKey(name))) status = "existing";
    else if (seen.has(nameKey(name))) status = "repeated";
    else status = "add";
    if (status === "add" || status === "repeated") seen.add(nameKey(name));
    if (status === "add") counts.add++;
    else if (status === "existing") counts.existing++;
    else if (status === "repeated") counts.repeated++;
    else if (status === "too_long") counts.tooLong++;
    else counts.tooShort++;
    out.push({ line, name, status });
  }
  return { rows: out, counts };
}

/** A cell as typed: a name wrapped in double quotes (as a spreadsheet writes one that holds a quote) is read without them, with doubled quotes as one. */
const unquote = (cell: string): string => {
  const t = cell.trim();
  return t.length >= 2 && t.startsWith("\"") && t.endsWith("\"") ? t.slice(1, -1).replace(/""/g, "\"") : cell;
};

/**
 * Pasted text as a grid of cells, for names. Pasted from Excel it has tabs: split on them. With no tab, every line is ONE name, whole: a comma is part
 * of a name ("Falcon Trading, LLC"), never a column break. A name wrapped in double quotes is read without the quotes. (The schedule listing import
 * reads pasted text another way, as it expects columns.)
 */
export function gridFromPastedNames(pasted: string): string[][] {
  const lines = pasted.replace(/\r\n?/g, "\n").split("\n");
  const tabbed = lines.some((l) => l.includes("\t"));
  return lines.map((l) => (tabbed ? l.split("\t").map(unquote) : [unquote(l)]));
}

export interface ImportPreview {
  /** The rows that were not blank, in file order. */
  rows: ImportRow[];
  counts: ImportCounts;
  /** The names that will be added, in file order. */
  names: string[];
  /** The same clients with the details that came with them, in file order. */
  entries: ImportEntry[];
  /** The extra columns found, by what they hold. */
  extraColumns: ImportDetailKey[];
  /** A heading row was found; when false, the first column was used. */
  foundHeading: boolean;
  /** A plain sentence when the file cannot be used; the rest is then empty. */
  refused: string | null;
}

const empty = (refused: string | null): ImportPreview => ({ rows: [], counts: { add: 0, existing: 0, repeated: 0, blank: 0, tooLong: 0, tooShort: 0 }, names: [], entries: [], extraColumns: [], foundHeading: false, refused });

const isBlank = (v: unknown) => cleanName(v) === "";

/**
 * Read a grid of cells (a spreadsheet, a CSV or pasted text) into the preview. The column of names is the one headed "Client name", "Client",
 * "Name", "Company" or "Entity" (any case; looked for in the first ten rows); with no such heading, it is the first column that has anything in it
 * and every row counts as a name.
 */
export function previewFromGrid(grid: unknown[][], existingNames: string[]): ImportPreview {
  let headingRow = -1;
  let column = -1;
  const searchTo = Math.min(grid.length, 10);
  search: for (let r = 0; r < searchTo; r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      if ((NAME_HEADINGS as readonly string[]).includes(nameKey(String(grid[r][c] ?? "")))) {
        headingRow = r;
        column = c;
        break search;
      }
    }
  }
  const foundHeading = headingRow >= 0;
  // The extra columns, by their headings in the same row as the names.
  const extra: Partial<Record<ImportDetailKey, number>> = {};
  if (foundHeading) {
    (grid[headingRow] ?? []).forEach((cell, c) => {
      const key = nameKey(String(cell ?? ""));
      for (const [detail, words] of Object.entries(DETAIL_HEADINGS) as [ImportDetailKey, readonly string[]][]) {
        if (extra[detail] === undefined && c !== column && words.includes(key)) extra[detail] = c;
      }
    });
  }
  if (!foundHeading) {
    // The first column with anything in it.
    let first = Infinity;
    for (const row of grid) for (let c = 0; c < row.length; c++) if (!isBlank(row[c]) && c < first) first = c;
    if (first === Infinity) return empty("The file has no names in it.");
    column = first;
  }
  const body = grid.slice(headingRow + 1).map((row, i) => ({ line: headingRow + 2 + i, raw: row?.[column] }));
  const nonBlank = body.filter((b) => !isBlank(b.raw)).length;
  if (nonBlank === 0) return empty("The file has no names under the heading.");
  if (nonBlank > MAX_IMPORT_ROWS) return empty(`The file has more than ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows of names. Split it and import it in parts.`);
  const { rows, counts } = classifyNames(body, existingNames);
  const cellsOf = new Map(body.map((b, i) => [b.line, grid[headingRow + 1 + i]]));
  for (const r of rows) {
    if (r.status !== "add") continue;
    const cells = cellsOf.get(r.line) ?? [];
    const raw = Object.fromEntries((Object.entries(extra) as [ImportDetailKey, number][]).map(([k, c]) => [k, cells[c]])) as Partial<Record<ImportDetailKey, unknown>>;
    const { details, notes } = readDetails(raw, r.line);
    r.details = details;
    if (notes.length > 0) r.notes = notes;
  }
  const added = rows.filter((r) => r.status === "add");
  return { rows, counts, names: added.map((r) => r.name), entries: added.map((r) => ({ name: r.name, details: r.details ?? {} })), extraColumns: Object.keys(extra) as ImportDetailKey[], foundHeading, refused: null };
}

const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** "12 to add, 3 already clients, 1 repeated in the file, 2 blank rows skipped." Only the parts that are not nil. */
export function importSentence(c: ImportCounts): string {
  const parts = [
    `${c.add.toLocaleString("en-US")} to add`,
    c.existing > 0 ? `${c.existing.toLocaleString("en-US")} already ${c.existing === 1 ? "a client" : "clients"}` : "",
    c.repeated > 0 ? `${c.repeated.toLocaleString("en-US")} repeated in the file` : "",
    c.tooLong > 0 ? `${c.tooLong.toLocaleString("en-US")} too long` : "",
    c.tooShort > 0 ? `${c.tooShort.toLocaleString("en-US")} too short` : "",
    c.blank > 0 ? `${n(c.blank, "blank row")} skipped` : "",
  ].filter(Boolean);
  return `${parts.join(", ")}.`;
}

/** The rows to show: those to add first, then the others, in file order within each. */
export const rowsToShow = (rows: ImportRow[]): ImportRow[] => [...rows.filter((r) => r.status === "add"), ...rows.filter((r) => r.status !== "add")];

export const confirmLabel = (count: number): string => (count === 1 ? "Add 1 client" : `Add ${count.toLocaleString("en-US")} clients`);
