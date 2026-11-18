/**
 * Importing a client list from a spreadsheet: finding the column of names, cleaning each name, and saying what would happen to each row.
 * Pure. The server classifies the names again against the database when the import is confirmed; this is only ever the preview's reading.
 *
 * A name is plain text: one that begins with =, +, - or @ is kept exactly as typed and never evaluated by anything.
 */

export const MAX_IMPORT_ROWS = 1000;
/** The limits of the Add client form. */
export const MIN_NAME = 2;
export const MAX_NAME = 200;

/** Heading words that mark the column of names, compared in lower case. */
export const NAME_HEADINGS = ["client name", "client", "name", "company", "entity"] as const;

export type RowStatus = "add" | "existing" | "repeated" | "too_long" | "too_short";

export interface ImportRow {
  /** The row's number in the file, as the user sees it. */
  line: number;
  name: string;
  status: RowStatus;
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
  /** A heading row was found; when false, the first column was used. */
  foundHeading: boolean;
  /** A plain sentence when the file cannot be used; the rest is then empty. */
  refused: string | null;
}

const empty = (refused: string | null): ImportPreview => ({ rows: [], counts: { add: 0, existing: 0, repeated: 0, blank: 0, tooLong: 0, tooShort: 0 }, names: [], foundHeading: false, refused });

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
  return { rows, counts, names: rows.filter((r) => r.status === "add").map((r) => r.name), foundHeading, refused: null };
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
