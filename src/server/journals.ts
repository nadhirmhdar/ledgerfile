import type { Tx } from "./db";
import { audit, clearSignOffs, getEngagement, type Session } from "./repo";
import { canDeleteJournal, JOURNAL_DELETE_REFUSAL } from "../domain/permissions";
import { validateJournal, type JournalLineInput, type JournalType } from "../domain/journal";

export interface JournalRow {
  id: string;
  number: number;
  type: JournalType;
  description: string;
  createdAt: string;
  /** Who posted the entry. */
  createdBy: string | null;
  lines: { accountCode: string; accountName: string; amountMinor: number }[];
}

async function requireOpenEngagement(tx: Tx, engagementId: string) {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new Error("Engagement not found.");
  if (engagement.status !== "open") throw new Error("This engagement is locked.");
}

/** The lead sheets (groups) that the given accounts sit on. */
async function groupsOfAccounts(tx: Tx, accountIds: string[]): Promise<string[]> {
  const { rows } = await tx.query<{ g: string }>("select distinct group_code as g from mappings where account_id = any($1::uuid[])", [accountIds]);
  return rows.map((r) => r.g);
}

export async function createJournal(
  tx: Tx,
  s: Session,
  engagementId: string,
  entry: { type: JournalType; description: string; lines: JournalLineInput[] },
): Promise<string> {
  await requireOpenEngagement(tx, engagementId);
  const problems = validateJournal(entry.description, entry.lines);
  if (problems.length > 0) throw new Error(problems.join(" "));

  // Every line must point at an account of this engagement.
  const ids = [...new Set(entry.lines.map((l) => l.accountId))];
  const found = await tx.query("select id from accounts where engagement_id = $1 and id = any($2::uuid[])", [engagementId, ids]);
  if (found.rows.length !== ids.length) throw new Error("A line refers to an account that is not in this engagement's trial balance.");

  const next = await tx.query<{ n: number }>(
    "update engagements set last_journal_number = last_journal_number + 1 where id = $1 returning last_journal_number as n",
    [engagementId],
  );
  const { rows } = await tx.query<{ id: string }>(
    "insert into journal_entries (firm_id, engagement_id, number, type, description, created_by) values ($1, $2, $3, $4, $5, $6) returning id",
    [s.firmId, engagementId, next.rows[0].n, entry.type, entry.description.trim(), s.userId],
  );
  for (const l of entry.lines) {
    await tx.query("insert into journal_lines (firm_id, journal_entry_id, account_id, amount_minor) values ($1, $2, $3, $4)", [
      s.firmId,
      rows[0].id,
      l.accountId,
      l.amountMinor,
    ]);
  }
  await clearSignOffs(tx, s, engagementId, await groupsOfAccounts(tx, ids), "journal entry posted");
  await audit(tx, s, "create", "journal_entry", rows[0].id, { engagementId, number: next.rows[0].n, type: entry.type, lines: entry.lines });
  return rows[0].id;
}

export async function listJournals(tx: Tx, engagementId: string): Promise<JournalRow[]> {
  const { rows } = await tx.query<{
    id: string;
    number: number;
    type: JournalType;
    description: string;
    createdAt: string;
    createdBy: string | null;
    accountCode: string;
    accountName: string;
    amount: string;
  }>(
    `select j.id, j.number, j.type, j.description, to_char(j.created_at, 'YYYY-MM-DD') as "createdAt", j.created_by as "createdBy",
            a.code as "accountCode", a.name as "accountName", l.amount_minor::text as amount
     from journal_entries j
     join journal_lines l on l.journal_entry_id = j.id
     join accounts a on a.id = l.account_id
     where j.engagement_id = $1
     order by j.number, (l.amount_minor < 0), a.code`,
    [engagementId],
  );
  const byId = new Map<string, JournalRow>();
  for (const r of rows) {
    let j = byId.get(r.id);
    if (!j) {
      j = { id: r.id, number: r.number, type: r.type, description: r.description, createdAt: r.createdAt, createdBy: r.createdBy, lines: [] };
      byId.set(r.id, j);
    }
    j.lines.push({ accountCode: r.accountCode, accountName: r.accountName, amountMinor: Number(r.amount) });
  }
  return [...byId.values()];
}

export async function deleteJournal(tx: Tx, s: Session, journalId: string): Promise<void> {
  const j = await tx.query<{ engagementId: string; number: number; createdBy: string | null }>(
    'select engagement_id as "engagementId", number, created_by as "createdBy" from journal_entries where id = $1',
    [journalId],
  );
  if (j.rows.length === 0) throw new Error("Journal entry not found.");
  await requireOpenEngagement(tx, j.rows[0].engagementId);
  if (!canDeleteJournal(s.role, j.rows[0].createdBy === s.userId)) throw new Error(JOURNAL_DELETE_REFUSAL);
  const affected = await tx.query<{ id: string }>("select account_id as id from journal_lines where journal_entry_id = $1", [journalId]);
  await clearSignOffs(tx, s, j.rows[0].engagementId, await groupsOfAccounts(tx, affected.rows.map((r) => r.id)), "journal entry deleted");
  await tx.query("delete from journal_entries where id = $1", [journalId]);
  await audit(tx, s, "delete", "journal_entry", journalId, { engagementId: j.rows[0].engagementId, number: j.rows[0].number });
}
