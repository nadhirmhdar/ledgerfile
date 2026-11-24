import type { Tx } from "./db";
import type { TbAccount } from "../domain/tb-parse";
import { cleanName, nameKey } from "../domain/client-import";
import { proposeMappings, type MappingSource } from "../domain/mapping";
import { GROUP_BY_CODE } from "../domain/groups";
import type { MappedAccount } from "../domain/leadsheet";
import type { Role } from "../domain/signoff";
import { canCreateClient, canCreateEngagement, CLIENT_REFUSAL, ENGAGEMENT_REFUSAL } from "../domain/permissions";

export interface Session {
  firmId: string;
  userId: string;
  /** The user's role, read from the database for this request. */
  role: Role;
}

export interface ClientRow {
  id: string;
  name: string;
  framework: string;
}

export interface EngagementRow {
  id: string;
  clientId: string;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  priorEngagementId: string | null;
  /** Borrowings due within twelve months, as entered by the preparer, for each year. */
  borrowingsCurrentMinor: number;
  borrowingsCurrentPriorMinor: number;
  /** The day the file was archived (the permanent lock), or null. An archived file is also locked. */
  archivedAt: string | null;
  archivedByName: string | null;
}

export interface AccountRow extends MappedAccount {
  id: string;
  /** Net effect of journal entries on this account, in ledger sign. */
  adjustmentMinor: number;
  source: MappingSource | null;
  confidence: number | null;
  approved: boolean;
  /** The assistant's reason, when it made the suggestion. */
  reason: string | null;
}

export async function audit(tx: Tx, s: Session, action: string, entity: string, entityId: string | null, detail?: unknown) {
  await tx.query("insert into audit_log (firm_id, user_id, action, entity, entity_id, detail) values ($1, $2, $3, $4, $5, $6)", [
    s.firmId,
    s.userId,
    action,
    entity,
    entityId,
    detail === undefined ? null : JSON.stringify(detail),
  ]);
}

/**
 * Remove sign-offs on lead sheets whose figures have changed since they were signed.
 * Pass the affected group codes, or "all" when the whole trial balance changed.
 */
export async function clearSignOffs(tx: Tx, s: Session, engagementId: string, groups: (string | null)[] | "all", reason: string): Promise<void> {
  const codes = groups === "all" ? null : [...new Set(groups.filter((g): g is string => !!g))];
  if (codes && codes.length === 0) return;
  const removed = codes
    ? await tx.query<{ target: string }>("delete from sign_offs where engagement_id = $1 and target = any($2::text[]) returning target", [engagementId, codes])
    : await tx.query<{ target: string }>("delete from sign_offs where engagement_id = $1 returning target", [engagementId]);
  if (removed.rows.length > 0) {
    await audit(tx, s, "sign_offs_cleared", "engagement", engagementId, { reason, leadSheets: [...new Set(removed.rows.map((r) => r.target))] });
  }
}

export async function listClients(tx: Tx): Promise<ClientRow[]> {
  return (await tx.query<ClientRow>("select id, name, framework from clients order by name")).rows;
}

/**
 * One change to the firm's list of clients at a time: the Add client form and the import both take this lock, and a second one waits here until the first
 * has committed, so each reads the clients the other added and neither adds a name twice. A transaction lock, released at commit. Held again by the same
 * transaction costs nothing.
 *
 * There is no unique index on the name, on purpose: it would fail the hosted migration for any firm that already has two clients with the same name,
 * and that cannot be seen from here. The rule is kept here, in the server.
 */
export async function lockClients(tx: Tx, firmId: string): Promise<void> {
  await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`clients:${firmId}`]);
}

/** Add a client. The name is cleaned (inner spaces collapsed), and refused when a client of this firm already has it, in any case or spacing. */
export async function createClient(tx: Tx, s: Session, name: string): Promise<string> {
  if (!canCreateClient(s.role)) throw new Error(CLIENT_REFUSAL);
  await lockClients(tx, s.firmId);
  const key = nameKey(name);
  const existing = (await tx.query<{ name: string }>("select name from clients")).rows.find((c) => nameKey(c.name) === key);
  if (existing) throw new Error(`${existing.name} is already a client.`);
  return insertClient(tx, s, name);
}

/** Insert a client with no duplicate check, for the import, which has already taken the lock and classified every name against the clients as they are. */
export async function insertClient(tx: Tx, s: Session, name: string): Promise<string> {
  name = cleanName(name);
  const { rows } = await tx.query<{ id: string }>("insert into clients (firm_id, name) values ($1, $2) returning id", [s.firmId, name]);
  await audit(tx, s, "create", "client", rows[0].id, { name });
  return rows[0].id;
}

const ENGAGEMENT_SELECT = `
  select e.id, e.client_id as "clientId", c.name as "clientName",
         to_char(e.period_start, 'YYYY-MM-DD') as "periodStart", to_char(e.period_end, 'YYYY-MM-DD') as "periodEnd",
         e.status, e.prior_engagement_id as "priorEngagementId",
         e.borrowings_current_minor::float8 as "borrowingsCurrentMinor", e.borrowings_current_prior_minor::float8 as "borrowingsCurrentPriorMinor",
         to_char(e.archived_at at time zone 'UTC', 'YYYY-MM-DD') as "archivedAt", au.name as "archivedByName"
  from engagements e join clients c on c.id = e.client_id left join users au on au.id = e.archived_by`;

export async function listEngagements(tx: Tx): Promise<EngagementRow[]> {
  return (await tx.query<EngagementRow>(`${ENGAGEMENT_SELECT} order by c.name, e.period_end desc`)).rows;
}

export async function getEngagement(tx: Tx, id: string): Promise<EngagementRow | null> {
  return (await tx.query<EngagementRow>(`${ENGAGEMENT_SELECT} where e.id = $1`, [id])).rows[0] ?? null;
}

/** Create an engagement and link it to the client's most recent earlier period, for mapping carry-forward. */
export async function createEngagement(tx: Tx, s: Session, clientId: string, periodStart: string, periodEnd: string): Promise<string> {
  if (!canCreateEngagement(s.role)) throw new Error(ENGAGEMENT_REFUSAL);
  const client = await tx.query("select 1 from clients where id = $1", [clientId]);
  if (client.rows.length === 0) throw new Error("Client not found.");
  const prior = await tx.query<{ id: string }>(
    "select id from engagements where client_id = $1 and period_end < $2 order by period_end desc limit 1",
    [clientId, periodEnd],
  );
  const { rows } = await tx.query<{ id: string }>(
    "insert into engagements (firm_id, client_id, period_start, period_end, prior_engagement_id) values ($1, $2, $3, $4, $5) returning id",
    [s.firmId, clientId, periodStart, periodEnd, prior.rows[0]?.id ?? null],
  );
  await audit(tx, s, "create", "engagement", rows[0].id, { clientId, periodStart, periodEnd });
  return rows[0].id;
}

async function mappingsByCode(tx: Tx, engagementId: string, approvedOnly = false) {
  const { rows } = await tx.query<{ code: string; groupCode: string; source: MappingSource; confidence: string; approved: boolean; reason: string | null; approvedBy: string | null; approvedAt: string | null }>(
    `select a.code, m.group_code as "groupCode", m.source, m.confidence, m.approved, m.reason, m.approved_by as "approvedBy", m.approved_at as "approvedAt"
     from mappings m join accounts a on a.id = m.account_id where a.engagement_id = $1 and (m.approved or not $2::boolean)`,
    [engagementId, approvedOnly],
  );
  return new Map(rows.map((r) => [r.code, r]));
}

/**
 * Replace the engagement's trial balance with a new import and map every account.
 * Order of preference: a mapping already made on this engagement (so re-importing a corrected
 * file keeps the preparer's work), then last year's mapping, then the rule-based suggestion.
 */
export async function importTrialBalance(
  tx: Tx,
  s: Session,
  engagementId: string,
  fileName: string,
  accounts: TbAccount[],
): Promise<{ imported: number; carriedForward: number; suggested: number; unmapped: number }> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new Error("Engagement not found.");
  if (engagement.status !== "open") throw new Error("This engagement is locked.");

  const journals = await tx.query("select 1 from journal_entries where engagement_id = $1 limit 1", [engagementId]);
  if (journals.rows.length > 0) {
    throw new Error("This engagement has journal entries. Delete them before replacing the trial balance, then re-enter them.");
  }

  const existing = await mappingsByCode(tx, engagementId);
  // Only mappings a person approved last year carry forward; unreviewed suggestions do not.
  const priorYear = engagement.priorEngagementId ? await mappingsByCode(tx, engagement.priorEngagementId, true) : new Map();

  await clearSignOffs(tx, s, engagementId, "all", "trial balance replaced");
  await tx.query("delete from accounts where engagement_id = $1", [engagementId]);
  const imp = await tx.query<{ id: string }>(
    "insert into tb_imports (firm_id, engagement_id, file_name, row_count) values ($1, $2, $3, $4) returning id",
    [s.firmId, engagementId, fileName, accounts.length],
  );

  const idByCode = new Map<string, string>();
  for (const a of accounts) {
    const { rows } = await tx.query<{ id: string }>(
      `insert into accounts (firm_id, engagement_id, tb_import_id, code, name, closing_minor, prior_minor)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [s.firmId, engagementId, imp.rows[0].id, a.code, a.name, a.closingMinor, a.priorMinor],
    );
    idByCode.set(a.code, rows[0].id);
  }

  const toPropose = accounts.filter((a) => !existing.has(a.code));
  const { suggestions, unmapped } = proposeMappings(
    toPropose,
    new Map([...priorYear].map(([code, m]) => [code, m.groupCode])),
  );

  const insert = (accountId: string, groupCode: string, source: string, confidence: number, approved: boolean, kept?: { reason: string | null; approvedBy: string | null; approvedAt: string | null }) =>
    tx.query("insert into mappings (firm_id, account_id, group_code, source, confidence, approved, reason, approved_by, approved_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)", [
      s.firmId,
      accountId,
      groupCode,
      source,
      confidence,
      approved,
      kept?.reason ?? null,
      kept?.approvedBy ?? null,
      kept?.approvedAt ?? null,
    ]);

  let kept = 0;
  for (const a of accounts) {
    const m = existing.get(a.code);
    if (m && GROUP_BY_CODE.has(m.groupCode)) {
      await insert(idByCode.get(a.code)!, m.groupCode, m.source, Number(m.confidence), m.approved, m);
      kept++;
    }
  }
  let carried = 0;
  for (const sug of suggestions) {
    if (!GROUP_BY_CODE.has(sug.groupCode)) continue;
    // Prior-year mappings were approved last year, so they arrive approved; rule suggestions need review.
    await insert(idByCode.get(sug.accountCode)!, sug.groupCode, sug.source, sug.confidence, sug.source === "prior_year");
    if (sug.source === "prior_year") carried++;
  }

  const result = {
    imported: accounts.length,
    carriedForward: carried + kept,
    suggested: suggestions.length - carried,
    unmapped: unmapped.length,
  };
  await audit(tx, s, "import", "trial_balance", engagementId, { fileName, ...result });
  return result;
}

export async function listAccounts(tx: Tx, engagementId: string): Promise<AccountRow[]> {
  const { rows } = await tx.query<{
    id: string;
    code: string;
    name: string;
    closing: string;
    prior: string | null;
    groupCode: string | null;
    source: MappingSource | null;
    confidence: string | null;
    approved: boolean | null;
    reason: string | null;
    adjustment: string;
  }>(
    `select a.id, a.code, a.name, a.closing_minor::text as closing, a.prior_minor::text as prior,
            m.group_code as "groupCode", m.source, m.confidence::text as confidence, m.approved, m.reason,
            coalesce((select sum(l.amount_minor) from journal_lines l where l.account_id = a.id), 0)::text as adjustment
     from accounts a left join mappings m on m.account_id = a.id
     where a.engagement_id = $1 order by a.code`,
    [engagementId],
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    closingMinor: Number(r.closing),
    priorMinor: r.prior === null ? null : Number(r.prior),
    groupCode: r.groupCode,
    source: r.source,
    confidence: r.confidence === null ? null : Number(r.confidence),
    approved: r.approved ?? false,
    reason: r.reason,
    adjustmentMinor: Number(r.adjustment),
  }));
}

/** Record how much of total borrowings falls due within twelve months, for presentation as current. */
export async function setBorrowingsCurrent(tx: Tx, s: Session, engagementId: string, currentMinor: number, priorMinor: number): Promise<void> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new Error("Engagement not found.");
  if (engagement.status !== "open") throw new Error("This engagement is locked.");
  if (!Number.isInteger(currentMinor) || !Number.isInteger(priorMinor) || currentMinor < 0 || priorMinor < 0) {
    throw new Error("Enter the amounts as positive numbers.");
  }
  await tx.query("update engagements set borrowings_current_minor = $2, borrowings_current_prior_minor = $3 where id = $1", [engagementId, currentMinor, priorMinor]);
  // The split changes how the borrowings lead sheet is presented, so its sign-offs no longer stand.
  await clearSignOffs(tx, s, engagementId, ["BORROW"], "current portion of borrowings changed");
  await audit(tx, s, "set_borrowings_current", "engagement", engagementId, { currentMinor, priorMinor });
}

/** The preparer sets or changes an account's group. A manual choice is approved by definition. */
export async function setMapping(tx: Tx, s: Session, accountId: string, groupCode: string | null): Promise<void> {
  const account = await tx.query<{ status: string; engagementId: string; oldGroup: string | null }>(
    `select e.status, e.id as "engagementId", m.group_code as "oldGroup"
     from accounts a join engagements e on e.id = a.engagement_id left join mappings m on m.account_id = a.id
     where a.id = $1`,
    [accountId],
  );
  if (account.rows.length === 0) throw new Error("Account not found.");
  if (account.rows[0].status !== "open") throw new Error("This engagement is locked.");
  if (groupCode === null) {
    await tx.query("delete from mappings where account_id = $1", [accountId]);
  } else {
    if (!GROUP_BY_CODE.has(groupCode)) throw new Error("Unknown group.");
    await tx.query(
      `insert into mappings (firm_id, account_id, group_code, source, confidence, approved, approved_by, approved_at) values ($1, $2, $3, 'manual', 1, true, $4, now())
       on conflict (account_id) do update set group_code = excluded.group_code, source = 'manual', confidence = 1, approved = true, reason = null, approved_by = excluded.approved_by, approved_at = excluded.approved_at`,
      [s.firmId, accountId, groupCode, s.userId],
    );
  }
  if (account.rows[0].oldGroup !== groupCode) {
    await clearSignOffs(tx, s, account.rows[0].engagementId, [account.rows[0].oldGroup, groupCode], "account mapping changed");
  }
  await audit(tx, s, "map", "account", accountId, { groupCode });
}

/** Accept every outstanding suggestion on the engagement as it stands. */
export async function approveAllMappings(tx: Tx, s: Session, engagementId: string): Promise<number> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new Error("Engagement not found.");
  if (engagement.status !== "open") throw new Error("This engagement is locked.");
  const { rows } = await tx.query(
    `update mappings set approved = true, approved_by = $2, approved_at = now()
     where approved = false and account_id in (select id from accounts where engagement_id = $1) returning id`,
    [engagementId, s.userId],
  );
  await audit(tx, s, "approve_all", "mapping", engagementId, { count: rows.length });
  return rows.length;
}

/**
 * The firm has only ever had one user. Deactivated users count, so an administrator cannot add a colleague, have
 * them do or review work, and remove them again. One rule for lead-sheet and procedure review.
 */
export async function isSolePractitioner(tx: Tx): Promise<boolean> {
  const { rows } = await tx.query<{ n: number }>("select count(*)::int as n from users");
  return rows[0].n === 1;
}
/**
 * Whether a reviewer may review audit work they performed themselves: the firm has only ever had one user, or only ever
 * had one user with reviewer-level rights (reviewer, partner or admin), who then has nobody else to review their work.
 * Deactivated users count, so a second reviewer cannot be added, used to make the rule apply, and removed again.
 * Applies to audit procedures and checklist steps. Lead-sheet sign-off keeps its own rule.
 */
export async function canSelfReviewAudit(tx: Tx): Promise<boolean> {
  if (await isSolePractitioner(tx)) return true;
  const { rows } = await tx.query<{ n: number }>("select count(*)::int as n from users where role in ('reviewer', 'partner', 'admin')");
  return rows[0].n === 1;
}
