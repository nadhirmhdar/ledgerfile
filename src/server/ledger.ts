import type { Tx } from "./db";
import { audit as log, getEngagement, listAccounts, type Session } from "./repo";
import { requireAudit } from "./audit";
import type { LedgerLine } from "../domain/ledger-parse";
import { FLAGS, flagEntries, reconcileLedger, type Flag, type Reconciliation } from "../domain/journal-risk";

export interface LedgerEntryRow {
  entryNo: string;
  date: string;
  postedBy: string | null;
  description: string | null;
  totalMinor: number;
  lineCount: number;
  flags: Flag[];
  /** null when the entry has not been selected for testing. */
  test: { status: "selected" | "tested"; workDone: string | null; conclusion: string | null; testedBy: string | null } | null;
}

export interface LedgerOverview {
  listing: { fileName: string; lineCount: number; entryCount: number; importedBy: string; importedAt: string; from: string; to: string } | null;
  users: string[];
  /** How many entries show each flag. */
  flagCounts: Record<string, number>;
  reconciliation: Reconciliation | null;
  /** Flagged entries, or those matching the filter, most flags first. Capped; see `matching`. */
  entries: LedgerEntryRow[];
  matching: number;
  selected: number;
  tested: number;
}

const ENTRY_LIMIT = 200;
const parseFlags = (text: string): Flag[] => (text ? (text.split(",") as Flag[]) : []);

/**
 * Replace the engagement's journal listing. Refused once any entry has been tested, so that
 * recorded conclusions always refer to the listing they were reached on.
 */
export async function importLedger(tx: Tx, s: Session, engagementId: string, fileName: string, lines: LedgerLine[]): Promise<{ lines: number; entries: number; flagged: number }> {
  await requireAudit(tx, engagementId);
  const engagement = (await getEngagement(tx, engagementId))!;
  if (lines.length === 0) throw new Error("The listing has no journal lines.");
  const tested = await tx.query("select 1 from journal_tests where engagement_id = $1 and tested_at is not null limit 1", [engagementId]);
  if (tested.rows.length > 0) throw new Error("Journal entries from the current listing have been tested, so it cannot be replaced.");

  const accounts = await listAccounts(tx, engagementId);
  const entries = flagEntries(lines, {
    periodStart: engagement.periodStart,
    periodEnd: engagement.periodEnd,
    groupByAccount: new Map(accounts.map((a) => [a.code, a.groupCode])),
  });

  await tx.query("delete from journal_tests where engagement_id = $1", [engagementId]);
  await tx.query("delete from ledger_imports where engagement_id = $1", [engagementId]);
  const imp = await tx.query<{ id: string }>(
    "insert into ledger_imports (firm_id, engagement_id, file_name, line_count, entry_count, imported_by) values ($1, $2, $3, $4, $5, $6) returning id",
    [s.firmId, engagementId, fileName, lines.length, entries.length, s.userId],
  );
  const importId = imp.rows[0].id;

  // Insert in batches: one statement per line would be far too slow for a year's journals.
  const batch = async (table: string, columns: string[], rows: unknown[][]) => {
    const size = Math.floor(1000 / columns.length);
    for (let i = 0; i < rows.length; i += size) {
      const chunk = rows.slice(i, i + size);
      const placeholders = chunk.map((_, r) => `(${columns.map((_, c) => `$${r * columns.length + c + 1}`).join(", ")})`).join(", ");
      await tx.query(`insert into ${table} (${columns.join(", ")}) values ${placeholders}`, chunk.flat());
    }
  };
  await batch(
    "ledger_lines",
    ["firm_id", "engagement_id", "import_id", "entry_no", "entry_date", "posted_by", "description", "account_code", "account_name", "amount_minor"],
    lines.map((l) => [s.firmId, engagementId, importId, l.entryNo, l.date, l.postedBy, l.description, l.accountCode, l.accountName, l.amountMinor]),
  );
  await batch(
    "ledger_entries",
    ["firm_id", "engagement_id", "import_id", "entry_no", "entry_date", "posted_by", "description", "total_minor", "line_count", "flags"],
    entries.map((e) => [s.firmId, engagementId, importId, e.entryNo, e.date, e.postedBy, e.description, e.totalMinor, e.lineCount, e.flags.join(",")]),
  );

  const result = { lines: lines.length, entries: entries.length, flagged: entries.filter((e) => e.flags.length > 0).length };
  await log(tx, s, "import", "journal_listing", engagementId, { fileName, ...result });
  return result;
}

export async function getLedgerOverview(tx: Tx, engagementId: string, filter: { flag?: string; user?: string } = {}): Promise<LedgerOverview | null> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) return null;
  const imp = await tx.query<NonNullable<LedgerOverview["listing"]>>(
    `select i.file_name as "fileName", i.line_count as "lineCount", i.entry_count as "entryCount", u.name as "importedBy",
            to_char(i.imported_at, 'YYYY-MM-DD') as "importedAt",
            (select to_char(min(entry_date), 'YYYY-MM-DD') from ledger_entries where engagement_id = $1) as "from",
            (select to_char(max(entry_date), 'YYYY-MM-DD') from ledger_entries where engagement_id = $1) as "to"
     from ledger_imports i join users u on u.id = i.imported_by where i.engagement_id = $1`,
    [engagementId],
  );
  const tests = await tx.query<{ n: number; tested: number }>(
    "select count(*)::int as n, count(tested_at)::int as tested from journal_tests where engagement_id = $1",
    [engagementId],
  );
  const empty: LedgerOverview = { listing: null, users: [], flagCounts: {}, reconciliation: null, entries: [], matching: 0, selected: tests.rows[0].n, tested: tests.rows[0].tested };
  if (imp.rows.length === 0) return empty;

  const all = await tx.query<{ flags: string; postedBy: string | null }>('select flags, posted_by as "postedBy" from ledger_entries where engagement_id = $1', [engagementId]);
  const flagCounts: Record<string, number> = Object.fromEntries(FLAGS.map((f) => [f.code, 0]));
  for (const r of all.rows) for (const f of parseFlags(r.flags)) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
  const users = [...new Set(all.rows.map((r) => r.postedBy).filter((u): u is string => !!u))].sort();

  // The flag filter is matched against the stored list by exact code, never by pattern.
  const flag = FLAGS.some((f) => f.code === filter.flag) ? filter.flag! : null;
  const user = filter.user && users.includes(filter.user) ? filter.user : null;
  const where = `e.engagement_id = $1
    and ($2::text is null or $2 = any(string_to_array(e.flags, ',')))
    and ($3::text is null or e.posted_by = $3)
    and (e.flags <> '' or $3::text is not null or t.id is not null)`;
  const rows = await tx.query<{
    entryNo: string;
    date: string;
    postedBy: string | null;
    description: string | null;
    total: number;
    lineCount: number;
    flags: string;
    selected: boolean;
    testedAt: string | null;
    workDone: string | null;
    conclusion: string | null;
    testedBy: string | null;
    matching: number;
  }>(
    `select e.entry_no as "entryNo", to_char(e.entry_date, 'YYYY-MM-DD') as date, e.posted_by as "postedBy", e.description,
            e.total_minor::float8 as total, e.line_count as "lineCount", e.flags, (t.id is not null) as selected,
            t.tested_at::text as "testedAt", t.work_done as "workDone", t.conclusion, u.name as "testedBy",
            count(*) over ()::int as matching
     from ledger_entries e
     left join journal_tests t on t.engagement_id = e.engagement_id and t.entry_no = e.entry_no
     left join users u on u.id = t.tested_by
     where ${where}
     order by (t.id is not null) desc, array_length(string_to_array(e.flags, ','), 1) desc nulls last, e.total_minor desc, e.entry_no
     limit ${ENTRY_LIMIT}`,
    [engagementId, flag, user],
  );

  const lines = await tx.query<{ accountCode: string; amount: number }>(
    // Only lines dated within the period: see reconcileLedger.
    'select account_code as "accountCode", sum(amount_minor)::float8 as amount from ledger_lines where engagement_id = $1 and entry_date between $2::date and $3::date group by account_code',
    [engagementId, engagement.periodStart, engagement.periodEnd],
  );
  const accounts = await listAccounts(tx, engagementId);
  const reconciliation = reconcileLedger(
    lines.rows.map((l) => ({ entryNo: "", date: engagement.periodEnd, postedBy: null, description: null, accountCode: l.accountCode, accountName: null, amountMinor: l.amount })),
    accounts,
    { start: engagement.periodStart, end: engagement.periodEnd },
  );

  return {
    listing: imp.rows[0],
    users,
    flagCounts,
    reconciliation,
    entries: rows.rows.map((r) => ({
      entryNo: r.entryNo,
      date: r.date,
      postedBy: r.postedBy,
      description: r.description,
      totalMinor: r.total,
      lineCount: r.lineCount,
      flags: parseFlags(r.flags),
      test: r.selected ? { status: r.testedAt ? "tested" : "selected", workDone: r.workDone, conclusion: r.conclusion, testedBy: r.testedBy } : null,
    })),
    matching: rows.rows[0]?.matching ?? 0,
    selected: tests.rows[0].n,
    tested: tests.rows[0].tested,
  };
}

export interface EntryLine {
  accountCode: string;
  accountName: string | null;
  description: string | null;
  amountMinor: number;
}

/** The lines of several entries in one query, keyed by entry number. */
export async function getLinesForEntries(tx: Tx, engagementId: string, entryNos: string[]): Promise<Map<string, EntryLine[]>> {
  const map = new Map<string, EntryLine[]>();
  if (entryNos.length === 0) return map;
  const { rows } = await tx.query<EntryLine & { entryNo: string }>(
    `select entry_no as "entryNo", account_code as "accountCode", account_name as "accountName", description, amount_minor::float8 as "amountMinor"
     from ledger_lines where engagement_id = $1 and entry_no = any($2::text[]) order by entry_no, (amount_minor < 0), id`,
    [engagementId, entryNos],
  );
  for (const { entryNo, ...line } of rows) {
    const list = map.get(entryNo);
    if (list) list.push(line);
    else map.set(entryNo, [line]);
  }
  return map;
}

export async function getEntryLines(tx: Tx, engagementId: string, entryNo: string): Promise<EntryLine[]> {
  const { rows } = await tx.query<EntryLine>(
    `select account_code as "accountCode", account_name as "accountName", description, amount_minor::float8 as "amountMinor"
     from ledger_lines where engagement_id = $1 and entry_no = $2 order by (amount_minor < 0), id`,
    [engagementId, entryNo],
  );
  return rows;
}

/** Choose an entry for testing. The flags it shows now are kept with the selection. */
export async function selectForTesting(tx: Tx, s: Session, engagementId: string, entryNo: string): Promise<void> {
  await requireAudit(tx, engagementId);
  const entry = await tx.query<{ flags: string }>("select flags from ledger_entries where engagement_id = $1 and entry_no = $2", [engagementId, entryNo]);
  if (entry.rows.length === 0) throw new Error("That entry is not in the journal listing.");
  await tx.query(
    "insert into journal_tests (firm_id, engagement_id, entry_no, flags, selected_by) values ($1, $2, $3, $4, $5) on conflict (engagement_id, entry_no) do nothing",
    [s.firmId, engagementId, entryNo, entry.rows[0].flags, s.userId],
  );
  await log(tx, s, "select", "journal_test", engagementId, { entryNo });
}

/** Remove an entry from the selection. Refused once a conclusion has been recorded. */
export async function unselect(tx: Tx, s: Session, engagementId: string, entryNo: string): Promise<void> {
  await requireAudit(tx, engagementId);
  const removed = await tx.query("delete from journal_tests where engagement_id = $1 and entry_no = $2 and tested_at is null returning id", [engagementId, entryNo]);
  if (removed.rows.length === 0) throw new Error("That entry has been tested, so it stays in the selection.");
  await log(tx, s, "unselect", "journal_test", engagementId, { entryNo });
}

/** Record the work done on a selected entry and the conclusion reached. */
export async function recordJournalTest(tx: Tx, s: Session, engagementId: string, entryNo: string, input: { workDone: string; conclusion: string }): Promise<void> {
  await requireAudit(tx, engagementId);
  const workDone = input.workDone.trim();
  const conclusion = input.conclusion.trim();
  if (workDone.length < 3) throw new Error("Describe the support inspected for the entry.");
  if (conclusion.length < 3) throw new Error("Record the conclusion on the entry.");
  if (workDone.length > 5000 || conclusion.length > 5000) throw new Error("The text is too long.");
  const existing = await tx.query<{ tested: boolean }>("select (tested_at is not null) as tested from journal_tests where engagement_id = $1 and entry_no = $2", [engagementId, entryNo]);
  if (existing.rows.length === 0) throw new Error("Select the entry for testing first.");
  if (existing.rows[0].tested) throw new Error("A conclusion has already been recorded on this entry and cannot be replaced.");
  await tx.query("update journal_tests set work_done = $3, conclusion = $4, tested_by = $5, tested_at = now() where engagement_id = $1 and entry_no = $2", [
    engagementId,
    entryNo,
    workDone,
    conclusion,
    s.userId,
  ]);
  await log(tx, s, "test", "journal_test", engagementId, { entryNo });
}
