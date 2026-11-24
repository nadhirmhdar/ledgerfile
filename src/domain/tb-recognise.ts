import { splitCombined, type Cell, type TbAccount } from "./tb-parse";
import type { Layout, Role } from "./tb-layout";

/**
 * Recognising the shape of a trial balance export, with a confidence. Pure; runs inside the app and nothing else.
 *
 * It is the step after the plain detection (domain/tb-parse.ts), which is untouched: it only runs on a file that detection could not read. It looks at
 * every sheet, finds the heading (one row, or two rows when a heading spans them), gives each column a role from one table of words (English and
 * Arabic header words; account names pass through as text), then reads the rows: skipping blank, heading, total and subtotal rows with a reason each,
 * splitting "1100 - Debtors" into a code and a name, reading Dr/Cr markers, brackets, trailing minus, currency marks and either separator convention
 * (decided once per file from the evidence, never per cell), and leaving out a parent line that only repeats the sub-accounts below it.
 *
 * Confidence is high only when the heading is clear, no role is ambiguous and the rows balance. Whenever it had to guess, it is low, and low means ask:
 * the caller opens the chooser, filled in with what was found, and imports nothing.
 */

export type Confidence = "high" | "medium" | "low";
export type ColumnRole = Role | "codename" | "drcr" | "ignore";

export interface Recognition {
  sheetIndex: number;
  sheetName: string;
  sheetsSeen: number;
  /** The heading rows (0-based). They differ when a heading spans two rows. */
  header: { start: number; end: number };
  roles: Record<number, ColumnRole>;
  /** Columns left out on purpose (opening and movement sets, a second year), with why. */
  ignoredColumns: { column: number; reason: string }[];
  /** Rows not imported, numbered as in the sheet (1-based), with the reason. Blank rows are not listed. */
  skipped: { row: number; reason: string }[];
  accounts: TbAccount[];
  differenceMinor: number;
  balanced: boolean;
  separator: "us" | "eu";
  confidence: { level: Confidence; reasons: string[] };
  /** What the chooser can show of this reading (it cannot show a combined code and name, or a Dr/Cr column). */
  prefill: Layout;
}

export interface Sheet {
  name: string;
  rows: Cell[][];
}

// --- Words --------------------------------------------------------------------------------------------------------------------------------

/** One table of header words. Compared after the text is lower-cased, punctuation and currency marks are gone, and the qualifier is taken out. */
const WORDS: Record<Exclude<ColumnRole, "ignore">, string[]> = {
  code: ["code", "account code", "a c", "a c code", "a c no", "a c number", "ac", "ac code", "n c", "nominal", "nominal code", "account id", "account ref", "main account", "acc code", "acc no", "account no", "account number", "number", "no", "gl code", "gl account", "gl no", "ledger code", "رقم الحساب", "كود الحساب", "رمز الحساب", "الرمز", "كود"],
  name: ["name", "account name", "account", "description", "account description", "account title", "name of account", "name of ledger", "title", "particulars", "ledger", "ledger name", "ledger head", "اسم الحساب", "الحساب", "البيان", "اسم"],
  codename: ["account", "accounts", "ledger", "ledger account", "chart of accounts"],
  debit: ["debit", "debits", "dr", "debit balance", "debit amount", "debit amt", "dr amt", "مدين", "المدين"],
  credit: ["credit", "credits", "cr", "credit balance", "credit amount", "credit amt", "cr amt", "دائن", "الدائن"],
  balance: ["balance", "net balance", "amount", "net", "closing balance", "current year", "cy", "this year", "ytd", "الرصيد", "رصيد", "الرصيد الختامي"],
  prior: ["prior year", "previous year", "last year", "py", "comparative", "prior period", "previous period", "prior", "السنة السابقة"],
  drcr: ["dr cr", "dr/cr", "debit credit", "debit/credit", "type", "side", "d c", "مدين دائن"],
};
const OPENING = /\b(opening|open|o b|b f|brought forward|beginning|initial)\b|افتتاح|الافتتاحي|رصيد أول المدة/;
const MOVEMENT = /\b(movement|movements|net change|activity|period|transactions|turnover|during|accu|accumulated)\b|حركة|الحركة/;
const ADJUSTING = /\b(adj|adjusted|adjusting|adjustment|adjustments)\b/;
const ADJUSTING_REASON = "The sheet has adjusting columns beside the balances, so it is not clear which balance is wanted.";
const CLOSING = /\b(closing|ending|end|c f|carried forward|final|ytd|year to date)\b|ختامي|الختامي|رصيد آخر المدة/;
const CURRENCY = /\b(aed|sar|usd|eur|gbp|qar|kwd|bhd|omr|inr|dhs?)\b|[$€£]|د\.إ/gi;
const TOTAL = /^(grand\s+)?totals?\b|^sub\s*-?\s*totals?\b|^net$|^total\b|^الإجمالي|^الاجمالي|^المجموع|^إجمالي/i;

const squash = (value: unknown): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(CURRENCY, " ")
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
const clean = (value: unknown): string => squash(value).replace(/ \/ /g, " ").trim();

interface Label {
  roles: ColumnRole[];
  set: "opening" | "movement" | "closing" | "adjusting" | null;
}

/** What a heading says about its column: a role (or two it could be) and which set (opening, movement, closing) it belongs to. */
function readLabel(text: string): Label | null {
  const raw = squash(text);
  if (raw === "") return null;
  const set = ADJUSTING.test(raw) ? "adjusting" : OPENING.test(raw) ? "opening" : MOVEMENT.test(raw) ? "movement" : CLOSING.test(raw) ? "closing" : null;
  let base = raw;
  for (const q of [ADJUSTING, OPENING, MOVEMENT, CLOSING]) base = base.replace(new RegExp(q.source, "g"), " ");
  base = base.replace(/\s+/g, " ").replace(/ \/ /g, " ").trim();
  const slashed = raw.replace(/\b(closing|opening)\b/g, "").replace(/\s+/g, " ").trim();
  const find = (b: string) => (Object.keys(WORDS) as (keyof typeof WORDS)[]).filter((role) => WORDS[role].some((w) => clean(w) === b || (w.includes("/") && squash(w) === slashed)));
  let roles = find(base);
  // "Balance Debit" and "Debit Balance" are a debit column.
  if (roles.length === 0) roles = find(base.replace(/^(net )?balance /, "")).filter((r) => r === "debit" || r === "credit");
  if (roles.length === 0 && set !== null && base === "") roles.push("balance");
  return roles.length > 0 ? { roles, set } : null;
}

// --- Numbers ------------------------------------------------------------------------------------------------------------------------------

type Convention = "us" | "eu";
interface Amount {
  minor: number | null;
  side: "dr" | "cr" | null;
  bad: boolean;
}

/** One cell as an amount in minor units. Brackets, a leading or trailing minus, Dr/Cr, currency marks and the file's separator convention are read. */
function amount(cell: Cell, convention: Convention): Amount {
  if (cell === null || cell === undefined) return { minor: null, side: null, bad: false };
  if (typeof cell === "number") return Number.isFinite(cell) ? { minor: Math.round(cell * 100), side: null, bad: false } : { minor: null, side: null, bad: true };
  let s = String(cell).replace(CURRENCY, " ").replace(/[   ' ]/g, "").replace(/[−–]/g, "-");
  if (s === "" || /^[-–]+$/.test(s)) return { minor: null, side: null, bad: false };
  let negative = false;
  let side: "dr" | "cr" | null = null;
  const marker = /(dr|cr)\.?$/i.exec(s) ?? /^(dr|cr)\.?/i.exec(s);
  if (marker) {
    side = marker[1].toLowerCase() as "dr" | "cr";
    s = s.replace(marker[0], "");
  }
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  s = convention === "eu" ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  if (!/^\d*(\.\d+)?$/.test(s) || s === "") return { minor: null, side, bad: true };
  const [whole, frac = ""] = s.split(".");
  const padded = (frac + "000").slice(0, 3);
  let minor = Number(whole || "0") * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) minor += 1;
  if (side === "cr") negative = !negative;
  return { minor: negative ? -minor : minor, side, bad: false };
}

/** Decide the separator convention once for the file, from the amount cells that show it. "unclear" means no cell could tell. */
function convention(cells: Cell[]): { value: Convention; evidence: "us" | "eu" | "none" | "mixed" } {
  let us = 0;
  let eu = 0;
  for (const cell of cells) {
    if (typeof cell !== "string") continue;
    const s = cell.replace(CURRENCY, " ").replace(/[^\d.,]/g, "");
    if (/\d{1,3}(,\d{3})+\.\d{1,2}$/.test(s) || /^\d+\.\d{1,2}$/.test(s)) us++;
    else if (/\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) eu++;
  }
  if (us > 0 && eu > 0) return { value: us >= eu ? "us" : "eu", evidence: "mixed" };
  if (eu > 0) return { value: "eu", evidence: "eu" };
  if (us > 0) return { value: "us", evidence: "us" };
  return { value: "us", evidence: "none" };
}

// --- Reading one sheet --------------------------------------------------------------------------------------------------------------------

const text = (cell: Cell): string => (cell === null || cell === undefined ? "" : String(cell).trim());
const SEARCH_ROWS = 30;
const MAX_COLUMNS = 30;

interface HeaderFound {
  start: number;
  end: number;
  labels: (Label | null)[];
  /** The account column had no heading and was found from its cells. */
  blankName: boolean;
}

/** Labels for a heading made of one row, or of two (the upper heading carried across the blank cells to its right). */
function labelsOf(rows: Cell[][], start: number, end: number, width: number): (Label | null)[] {
  const out: (Label | null)[] = [];
  let carried = "";
  for (let c = 0; c < width; c++) {
    const lower = text(rows[end]?.[c]);
    const upper = end > start ? text(rows[start]?.[c]) : "";
    if (end === start) {
      out.push(readLabel(lower));
      continue;
    }
    // The upper heading runs across the blank cells to its right, but only fills a column whose own upper cell is blank.
    carried = upper !== "" ? upper : lower === "" ? "" : carried;
    // The words on the lower row win ("Debit" under "Closing Balance" is a debit column); the upper heading only says which set it is.
    const own = readLabel(lower);
    const set = readLabel(carried)?.set ?? null;
    out.push(own ? { roles: own.roles, set: own.set ?? set } : readLabel(`${carried} ${lower}`.trim()));
  }
  return out;
}

const usable = (labels: (Label | null)[]): boolean => {
  const has = (role: ColumnRole) => labels.some((l) => l?.roles.includes(role));
  return (has("code") || has("name") || has("codename")) && (has("balance") || (has("debit") && has("credit")));
};

/** A heading row with no word over the account column (some systems leave it blank): the first blank column left of the amounts whose cells are text is the account. */
function fillBlankName(labels: (Label | null)[], rows: Cell[][], end: number): (Label | null)[] | null {
  const has = (role: ColumnRole) => labels.some((l) => l?.roles.includes(role));
  if (has("code") || has("name") || has("codename") || !(has("balance") || (has("debit") && has("credit")))) return null;
  const firstAmount = labels.findIndex((l) => l?.roles.some((r) => r === "debit" || r === "credit" || r === "balance"));
  for (let c = 0; c < firstAmount; c++) {
    if (labels[c]) continue;
    const cells = rows.slice(end + 1, end + 11).map((r) => text(r[c])).filter((v) => v !== "");
    if (cells.length >= 2 && cells.filter((v) => !/^[\d\s,.()$€£-]+$/.test(v)).length / cells.length >= 0.8) {
      const next = [...labels];
      next[c] = { roles: ["codename"], set: null };
      return next;
    }
  }
  return null;
}

function findHeader(rows: Cell[][]): HeaderFound | null {
  const width = Math.min(MAX_COLUMNS, Math.max(0, ...rows.slice(0, SEARCH_ROWS + 1).map((r) => r.length)));
  const consider = (labels: (Label | null)[], start: number, end: number): HeaderFound | null => {
    if (usable(labels)) return { start, end, labels, blankName: false };
    const filled = fillBlankName(labels, rows, end);
    return filled && usable(filled) ? { start, end, labels: filled, blankName: true } : null;
  };
  for (let i = 0; i < Math.min(rows.length, SEARCH_ROWS); i++) {
    if (!rows[i].some((c) => text(c) !== "")) continue;
    const one = labelsOf(rows, i, i, width);
    const two = i + 1 < rows.length ? labelsOf(rows, i, i + 1, width) : null;
    // The heading spans both rows when the next row holds Debit and Credit words of its own AND the row above is a heading too: it has a word of its own, or
    // it stands over an amount column (a date over Debit and Credit). A title or company line above the heading is not part of it.
    const lower = i + 1 < rows.length ? labelsOf(rows, i + 1, i + 1, width) : [];
    const lowerAmounts = lower.some((l) => l?.roles.some((r) => r === "debit" || r === "credit"));
    const upperIsHeading = rows[i].some((cell, c) => text(cell) !== "" && (readLabel(text(cell)) !== null || lower[c]?.roles.some((r) => r === "debit" || r === "credit" || r === "balance")));
    const spans = two && lowerAmounts && upperIsHeading ? consider(two, i, i + 1) : null;
    if (spans) return spans;
    const single = consider(one, i, i);
    if (single) return single;
  }
  // Only when no single row works: a heading over two rows whose upper row is not obviously one (a last resort, never a title line taken for a heading).
  for (let i = 0; i < Math.min(rows.length - 1, SEARCH_ROWS); i++) {
    if (!rows[i].some((c) => text(c) !== "")) continue;
    const fallback = consider(labelsOf(rows, i, i + 1, width), i, i + 1);
    if (fallback) return fallback;
  }
  return null;
}

interface Row {
  line: number;
  code: string;
  name: string;
  closing: number | null;
  prior: number | null;
  hadAmount: boolean;
  /** How far the name is indented (leading spaces), for a group line with its accounts indented below it. */
  indent: number;
}

function recogniseSheet(rows: Cell[][], index: number, name: string, sheetsSeen: number): Recognition | null {
  const header = findHeader(rows);
  if (!header) return null;
  const reasons: string[] = [];
  let guessed = false;
  const ignoredColumns: Recognition["ignoredColumns"] = [];
  const roles: Record<number, ColumnRole> = {};

  // Each column's role: the closing set when sets are given, the first of two equal sets when not (and that is a guess).
  const wantSet = header.labels.some((l) => l?.set === "closing") ? "closing" : null;
  const isAmount = (l: Label) => l.roles.some((r) => r === "debit" || r === "credit" || r === "balance");
  const hasOpening = header.labels.some((l) => l?.set === "opening");
  const plainBalance = header.labels.some((l) => l && l.set === null && l.roles.includes("balance"));
  const taken = new Map<ColumnRole, number>();
  const order: ColumnRole[] = ["codename", "code", "name", "debit", "credit", "balance", "prior", "drcr"];
  // Columns marked as the closing set are placed first, so a plain "Debit" beside "Debit YTD" does not take the role.
  const columns = header.labels.map((_, c) => c).sort((a, b) => (header.labels[a]?.set === "closing" ? 0 : 1) - (header.labels[b]?.set === "closing" ? 0 : 1) || a - b);
  for (const col of columns) {
    const label = header.labels[col];
    if (!label) continue;
    if (label.set === "adjusting" && isAmount(label)) {
      ignoredColumns.push({ column: col, reason: "Adjusting entries (not used)" });
      guessed = true;
      if (!reasons.includes(ADJUSTING_REASON)) reasons.push(ADJUSTING_REASON);
      continue;
    }
    if (label.set === "opening" || label.set === "movement") {
      ignoredColumns.push({ column: col, reason: label.set === "opening" ? "Opening balance (not used as the prior year)" : "Movement for the period" });
      continue;
    }
    // Beside a closing set, or beside an opening balance and a balance column, plain Debit and Credit columns are the period's movement.
    if (isAmount(label) && label.set === null && !label.roles.includes("balance") && (wantSet || (hasOpening && plainBalance))) {
      ignoredColumns.push({ column: col, reason: "Movement for the period" });
      continue;
    }
    if (wantSet && label.set !== wantSet && label.set !== null && isAmount(label)) continue;
    // A heading that fits two roles ("Account" can be a name or a combined code and name) takes the first role in order that is still free.
    const role = order.find((r) => label.roles.includes(r) && !taken.has(r));
    if (!role) {
      if (label.roles.some((r) => r === "debit" || r === "credit" || r === "balance")) {
        guessed = true;
        ignoredColumns.push({ column: col, reason: "A second column with the same heading (the first was used)" });
        reasons.push("Two columns have the same heading, so the first was used.");
      }
      continue;
    }
    taken.set(role, col);
    roles[col] = role;
  }
  ignoredColumns.sort((a, b) => a.column - b.column);
  // "Account" alone is a name; it is a combined code and name only when most of its cells look like one.
  const dataStart = header.end + 1;
  const body = rows.slice(dataStart);
  if (taken.has("codename") && !taken.has("name")) {
    const col = taken.get("codename")!;
    const filled = body.map((r) => text(r[col])).filter((v) => v !== "");
    const combined = filled.filter((v) => splitCombined(v) !== null).length;
    if (!taken.has("code") && filled.length > 0 && combined / filled.length >= 0.6) {
      reasons.push("The account code and name are in one column and were split.");
    } else {
      roles[col] = "name";
      taken.delete("codename");
      taken.set("name", col);
    }
  } else if (taken.has("codename")) {
    delete roles[taken.get("codename")!];
    taken.delete("codename");
  }
  const has = (r: ColumnRole) => taken.has(r);
  const col = (r: ColumnRole) => taken.get(r)!;
  const split = has("codename");
  if (!(has("code") || has("name") || split) || !(has("balance") || (has("debit") && has("credit")))) return null;
  // A Dr/Cr marker column is only a marker when its cells say Dr or Cr.
  if (has("drcr")) {
    const cells = body.map((r) => text(r[col("drcr")]).toLowerCase()).filter((v) => v !== "");
    if (cells.length === 0 || cells.filter((v) => /^(dr|cr|debit|credit|d|c|مدين|دائن)\.?$/.test(v)).length / cells.length < 0.8) {
      delete roles[col("drcr")];
      taken.delete("drcr");
    }
  }

  const amountColumns = ["debit", "credit", "balance", "prior"].filter((r) => has(r as ColumnRole)).map((r) => col(r as ColumnRole));
  const conv = convention(body.flatMap((r) => amountColumns.map((c) => r[c])));
  if (conv.evidence === "none" && body.some((r) => amountColumns.some((c) => typeof r[c] === "string" && /\d[.,]\d{3}\b/.test(String(r[c]))))) {
    guessed = true;
    reasons.push("No amount shows which separator is the decimal point, so 1,234 was read as one thousand two hundred and thirty-four.");
  }
  if (conv.evidence === "mixed") {
    guessed = true;
    reasons.push("Amounts use both separator conventions.");
  }

  const skipped: Recognition["skipped"] = [];
  const kept: Row[] = [];
  let sawSuffix = false;
  let sawCombinedSplit = false;
  body.forEach((row, i) => {
    const line = dataStart + i + 1;
    if (row.every((c) => text(c) === "")) return;
    let code = has("code") ? text(row[col("code")]) : "";
    let label = has("name") ? text(row[col("name")]) : "";
    if (split) {
      const joined = text(row[col("codename")]);
      const parts = splitCombined(joined);
      if (parts) {
        code = parts.code;
        label = parts.name;
        sawCombinedSplit = true;
      } else label = joined;
    }
    if (!code && !label) return;
    if (TOTAL.test(label.trim()) || TOTAL.test(code.trim())) return void skipped.push({ row: line, reason: "A total row" });

    const side = has("drcr") ? /^(cr|credit|c|دائن)\.?$/i.test(text(row[col("drcr")])) ? "cr" : "dr" : null;
    let closing: number | null = null;
    let bad = false;
    if (has("debit") && has("credit")) {
      const dr = amount(row[col("debit")], conv.value);
      const cr = amount(row[col("credit")], conv.value);
      bad = dr.bad || cr.bad;
      if (dr.minor !== null || cr.minor !== null) closing = (dr.minor ?? 0) - (cr.minor ?? 0);
    } else {
      const b = amount(row[col("balance")], conv.value);
      bad = b.bad;
      if (b.side) sawSuffix = true;
      if (b.minor !== null) closing = side === "cr" ? -Math.abs(b.minor) : side === "dr" ? Math.abs(b.minor) : b.minor;
    }
    const prior = has("prior") ? amount(row[col("prior")], conv.value) : { minor: null, bad: false };
    if (bad) return void skipped.push({ row: line, reason: "An amount that is not a number" });
    if (closing === null && prior.minor === null) return void skipped.push({ row: line, reason: "A heading row with no amounts" });
    const rawName = String(row[has("name") ? col("name") : split ? col("codename") : col("code")] ?? "");
    kept.push({ line, code, name: label, closing, prior: prior.minor, hadAmount: closing !== null, indent: /^\s*/.exec(rawName)![0].length });
  });

  // Subtotals and parent lines: a row that only repeats the rows next to it must not be counted twice.
  const alive = new Set(kept.map((r) => r.line));
  // A row with no code hints at a subtotal only on a sheet where most accounts have a code.
  const codeShare = kept.length === 0 ? 0 : kept.filter((r) => r.code !== "").length / kept.length;
  const value = (r: Row) => r.closing ?? 0;
  kept.forEach((r, i) => {
    if (value(r) === 0 || !r.hadAmount) return;
    const above = kept.slice(0, i).filter((k) => alive.has(k.line));
    const looksTotal = /total|sub/i.test(r.name) || (r.code === "" && codeShare >= 0.6);
    let sum = 0;
    for (let k = 1; k <= Math.min(above.length, 60) && looksTotal; k++) {
      sum += value(above[above.length - k]);
      if (k >= 2 && sum === value(r)) {
        alive.delete(r.line);
        skipped.push({ row: r.line, reason: "A subtotal (it equals the rows above it)" });
        return;
      }
    }
    // A group line with its accounts indented below it, whose amount is the sum of those lines, is a parent (whichever side the amount is on).
    const below: Row[] = [];
    for (const next of kept.slice(i + 1)) {
      if (next.indent > r.indent) below.push(next);
      else break;
    }
    if (below.length > 0) {
      const direct = below.filter((b) => b.indent === Math.min(...below.map((x) => x.indent)));
      const sum = (list: Row[]) => list.reduce((a, c) => a + value(c), 0);
      if (sum(direct) === value(r) || sum(below) === value(r)) {
        alive.delete(r.line);
        skipped.push({ row: r.line, reason: "A group line (it equals the lines indented below it)" });
        return;
      }
    }
    // A parent line comes before its sub-accounts, whose codes begin with its own.
    if (r.code !== "" && /^\d/.test(r.code)) {
      const children: Row[] = [];
      for (const next of kept.slice(i + 1)) {
        if (alive.has(next.line) && next.code.length > r.code.length && next.code.startsWith(r.code)) children.push(next);
        else break;
      }
      if (children.length > 0 && children.reduce((a, c) => a + value(c), 0) === value(r)) {
        alive.delete(r.line);
        skipped.push({ row: r.line, reason: "A parent line (it equals the sub-accounts below it)" });
      }
    }
  });
  skipped.sort((a, b) => a.row - b.row);
  const accounts: TbAccount[] = [];
  const seen = new Set<string>();
  let duplicate = false;
  for (const r of kept.filter((k) => alive.has(k.line))) {
    const key = r.code || r.name;
    if (seen.has(key)) duplicate = true;
    seen.add(key);
    accounts.push({ code: key, name: r.name || r.code, closingMinor: r.closing ?? 0, priorMinor: r.prior });
  }
  const differenceMinor = accounts.reduce((s, a) => s + a.closingMinor, 0);
  const balanced = accounts.length > 0 && differenceMinor === 0;

  // Confidence. Anything that was a guess, or does not balance, is low: low means ask.
  const low: string[] = [...(guessed ? reasons : [])];
  if (accounts.length < 2) low.push("Fewer than two accounts were found.");
  if (!balanced) low.push(accounts.length === 0 ? "No accounts were found." : "The accounts do not balance, so a column or a row may have been misread.");
  if (duplicate) low.push("The same account appears twice.");
  if (has("balance") && has("debit") && has("credit")) reasons.push("Both a Balance and Debit and Credit columns were found; Debit and Credit were used.");
  const medium: string[] = [...(guessed ? [] : reasons)];
  if (header.end > header.start) medium.push("The heading spans two rows.");
  if (header.blankName) medium.push("The account column has no heading, so it was found from its cells.");
  if (sawSuffix || has("drcr")) medium.push("Debit and credit are shown with Dr and Cr markers.");
  if (sawCombinedSplit && !medium.some((m) => m.includes("one column"))) medium.push("The account code and name are in one column and were split.");
  if (skipped.some((s) => s.reason.startsWith("A subtotal") || s.reason.startsWith("A parent"))) medium.push("Subtotal or parent lines were left out so nothing is counted twice.");
  if (conv.evidence === "eu") medium.push("Amounts use a comma as the decimal point.");
  if (conv.evidence === "none" && !low.length && amountColumns.some((c) => body.some((r) => typeof r[c] === "string" && /\d/.test(String(r[c]))))) medium.push("No amount shows which separator is the decimal point.");
  if (sheetsSeen > 1) medium.push(`The sheet "${name}" was used of ${sheetsSeen}.`);
  const level: Confidence = low.length > 0 ? "low" : medium.length > 0 ? "medium" : "high";

  const prefillColumns: Partial<Record<Role, number>> = {};
  for (const [c, role] of Object.entries(roles)) {
    if (["code", "name", "codename", "debit", "credit", "balance", "prior"].includes(role)) prefillColumns[role as Role] = Number(c);
  }
  return {
    sheetIndex: index,
    sheetName: name,
    sheetsSeen,
    header: { start: header.start, end: header.end },
    roles,
    ignoredColumns,
    skipped,
    accounts,
    differenceMinor,
    balanced,
    separator: conv.value,
    confidence: { level, reasons: [...low, ...medium] },
    prefill: { headerRow: header.end, columns: prefillColumns },
  };
}

const rank = (r: Recognition, name: string): number =>
  (r.balanced ? 100000 : 0) + Math.min(r.accounts.length, 5000) * 10 + (/trial|tb|balance/i.test(name) ? 5 : 0) + (r.confidence.level === "high" ? 3 : r.confidence.level === "medium" ? 1 : 0);

/**
 * Recognise the trial balance in a workbook: the sheet that looks like one (and the others are said to be passed over), its heading, the role of each
 * column and the accounts. Null when no sheet has a heading naming an account column and an amount column.
 */
export function recogniseWorkbook(sheets: Sheet[]): Recognition | null {
  const found = sheets
    .map((s, i) => ({ r: recogniseSheet(s.rows, i, s.name, sheets.length), name: s.name }))
    .filter((x): x is { r: Recognition; name: string } => x.r !== null);
  if (found.length === 0) return null;
  found.sort((a, b) => rank(b.r, b.name) - rank(a.r, a.name) || a.r.sheetIndex - b.r.sheetIndex);
  return found[0].r;
}

const closings = (accounts: TbAccount[]): number[] => accounts.map((a) => a.closingMinor).sort((a, b) => a - b);

/**
 * Whether plain detection and the recogniser both read a sheet into balanced accounts but with different closing balances. Plain detection takes the first
 * Debit and Credit columns it finds, so an export with opening, movement and closing sets (or a year-to-date pair) can be read from the period's movement,
 * which balances too. Two balanced readings that disagree mean we do not know which columns are the closing balance, so neither is imported: the caller
 * asks. A file both read the same way is not a disagreement.
 */
export function readsDiffer(plain: TbAccount[], found: Recognition | null): found is Recognition {
  if (!found || !found.balanced) return false;
  const a = closings(plain);
  const b = closings(found.accounts);
  return a.length !== b.length || a.some((x, i) => x !== b[i]);
}
