import type { Db, Tx } from "./db";
import { withFirm } from "./db";
import { audit, type Session } from "./repo";
import { AuthError, requireAdmin, type AuthSession } from "./auth";
import { withAuth } from "./db";
import type { FileStore } from "./file-store";
import { canLock, type Role } from "../domain/signoff";
import {
  checkYears,
  MAX_REASON,
  MIN_REASON,
  NAME_MISMATCH,
  NOT_PARTNER,
  NOT_SET,
  ONE_PARTNER,
  SAME_PERSON,
  type RequestState,
} from "../domain/retention";

/**
 * Retention: the firm's period, and the two-person deletion of an archived file. Every rule is checked here, and the database function
 * purge_engagement() checks them all again itself, because this is the one place client data is deleted.
 */

// --- Who ------------------------------------------------------------------------------------------------------------------

/** The partner-level rule (the same as locking and archiving: partners, and the firm administrator), from the database and not from the session. */
export async function partnerLevel(tx: Tx, s: Session): Promise<Role | null> {
  const who = await tx.query<{ role: Role; active: boolean }>("select role, active from users where id = $1 and firm_id = $2", [s.userId, s.firmId]);
  return who.rows[0]?.active && canLock(who.rows[0].role) ? who.rows[0].role : null;
}

async function requirePartner(tx: Tx, s: Session): Promise<void> {
  if (!(await partnerLevel(tx, s))) throw new Error(NOT_PARTNER);
}

// --- The period -----------------------------------------------------------------------------------------------------------

export async function getRetentionYears(tx: Tx): Promise<number | null> {
  return (await tx.query<{ years: number | null }>("select retention_years as years from firms")).rows[0]?.years ?? null;
}

/** Set or clear the firm's retention period. Administrator only, through the sign-in role; logged with the value before and after. */
export async function setRetentionYears(db: Db, admin: AuthSession, input: string | number | null): Promise<{ before: number | null; after: number | null }> {
  const checked = checkYears(input);
  return withAuth(db, async (q) => {
    await requireAdmin(q, admin);
    if (!checked.ok) throw new AuthError(checked.message);
    const before = (await q.query<{ years: number | null }>("select retention_years as years from firms where id = $1", [admin.firmId])).rows[0]?.years ?? null;
    await q.query("update firms set retention_years = $2 where id = $1", [admin.firmId, checked.years]);
    await q.query("insert into audit_log (firm_id, user_id, action, entity, entity_id, detail) values ($1, $2, 'set_retention_period', 'firm', $3, $4)", [
      admin.firmId,
      admin.userId,
      admin.firmId,
      JSON.stringify({ before, after: checked.years }),
    ]);
    return { before, after: checked.years };
  });
}

// --- The list -------------------------------------------------------------------------------------------------------------

export interface DeletionRequest {
  id: number;
  state: Exclude<RequestState, "none">;
  requester: string;
  requesterId: string;
  at: string;
  reason: string;
  counts: Record<string, number>;
  /** When cancelled: who and when. */
  cancelledBy: string | null;
  cancelledAt: string | null;
}

export interface RetentionItem {
  engagementId: string;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  archivedOn: string;
  /** The date the file becomes eligible, or null while the firm has no period. */
  eligibleFrom: string | null;
  eligible: boolean;
  /** The latest request that is still pending, or the latest one that was cancelled. */
  request: DeletionRequest | null;
}

export interface PurgedFile {
  purgeId: number;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  archivedOn: string;
  purgedOn: string;
  counts: Record<string, number>;
}

export interface PendingFile {
  id: number;
  key: string;
  purgeId: number;
  clientName: string;
}

export interface RetentionView {
  years: number | null;
  partners: number;
  items: RetentionItem[];
  purged: PurgedFile[];
  pendingFiles: PendingFile[];
}

interface ItemRow {
  engagementId: string;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  archivedOn: string;
  eligibleFrom: string | null;
  eligible: boolean;
}
interface ReqRow {
  id: number;
  engagementId: string;
  requester: string;
  requesterId: string;
  at: string;
  reason: string;
  snapshot: { counts?: Record<string, number> } | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  approved: boolean;
}

/** Archived engagements, eligible ones first, with the state of any deletion request; what has been deleted; and the files still to remove. */
export async function getRetention(tx: Tx): Promise<RetentionView> {
  const years = await getRetentionYears(tx);
  const partners = (await tx.query<{ n: number }>("select count(*)::int as n from users where active and role in ('partner', 'admin')")).rows[0].n;
  const items = (
    await tx.query<ItemRow>(
      `select e.id as "engagementId", c.name as "clientName", to_char(e.period_start, 'YYYY-MM-DD') as "periodStart", to_char(e.period_end, 'YYYY-MM-DD') as "periodEnd",
              to_char(e.archived_at at time zone 'UTC', 'YYYY-MM-DD') as "archivedOn",
              case when f.retention_years is null then null else to_char((e.archived_at + make_interval(years => f.retention_years)) at time zone 'UTC', 'YYYY-MM-DD') end as "eligibleFrom",
              coalesce(e.archived_at + make_interval(years => f.retention_years) <= clock_timestamp(), false) as eligible
       from engagements e join clients c on c.id = e.client_id join firms f on f.id = e.firm_id
       where e.archived_at is not null`,
    )
  ).rows;
  const reqs = (
    await tx.query<ReqRow>(
      `select r.id::float8 as id, r.engagement_id as "engagementId", u.name as requester, r.actor_id as "requesterId", to_char(r.at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as at, r.reason, r.snapshot,
              cu.name as "cancelledBy", to_char(x.at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as "cancelledAt",
              exists (select 1 from retention_deletions a where a.request_id = r.id and a.kind = 'approved') as approved
       from retention_deletions r join users u on u.id = r.actor_id
       left join retention_deletions x on x.request_id = r.id and x.kind = 'cancelled' left join users cu on cu.id = x.actor_id
       where r.kind = 'requested' order by r.id`,
    )
  ).rows;
  const latest = new Map<string, ReqRow>();
  for (const r of reqs) if (!r.approved) latest.set(r.engagementId, r);
  const list: RetentionItem[] = items.map((i) => {
    const r = latest.get(i.engagementId);
    const request: DeletionRequest | null = r
      ? { id: r.id, state: r.cancelledAt ? "cancelled" : "pending", requester: r.requester, requesterId: r.requesterId, at: r.at, reason: r.reason, counts: r.snapshot?.counts ?? {}, cancelledBy: r.cancelledBy, cancelledAt: r.cancelledAt }
      : null;
    return { ...i, request };
  });
  // Eligible first, then the earliest eligible date, then by client.
  list.sort((a, b) => Number(b.eligible) - Number(a.eligible) || (a.eligibleFrom ?? "9999").localeCompare(b.eligibleFrom ?? "9999") || a.clientName.localeCompare(b.clientName));
  const purged = (
    await tx.query<PurgedFile & { counts: Record<string, number> }>(
      `select id::float8 as "purgeId", client_name as "clientName", to_char(period_start, 'YYYY-MM-DD') as "periodStart", to_char(period_end, 'YYYY-MM-DD') as "periodEnd",
              to_char(archived_at at time zone 'UTC', 'YYYY-MM-DD') as "archivedOn", to_char(purged_at at time zone 'UTC', 'YYYY-MM-DD') as "purgedOn", counts
       from retention_purges order by id desc`,
    )
  ).rows;
  const pendingFiles = (
    await tx.query<PendingFile>(
      `select f.id::float8 as id, f.key, f.purge_id::float8 as "purgeId", p.client_name as "clientName"
       from retention_files f join retention_purges p on p.id = f.purge_id
       where not exists (select 1 from retention_file_removals r where r.file_id = f.id) order by f.id`,
    )
  ).rows;
  return { years, partners, items: list, purged, pendingFiles };
}

/** The date an archived engagement became past retention, or null (not archived, no period, or not yet). For the calm line on the engagement pages. */
export async function pastRetentionSince(tx: Tx, engagementId: string): Promise<string | null> {
  const { rows } = await tx.query<{ since: string | null }>(
    `select case when e.archived_at is not null and f.retention_years is not null and e.archived_at + make_interval(years => f.retention_years) <= clock_timestamp()
                 then to_char((e.archived_at + make_interval(years => f.retention_years)) at time zone 'UTC', 'YYYY-MM-DD') end as since
     from engagements e join firms f on f.id = e.firm_id where e.id = $1`,
    [engagementId],
  );
  return rows[0]?.since ?? null;
}

// --- Request, cancel, approve ---------------------------------------------------------------------------------------------

interface Subject {
  id: string;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  archivedAt: string;
  eligible: boolean;
}

async function subject(tx: Tx, s: Session, engagementId: string): Promise<Subject> {
  const { rows } = await tx.query<Subject & { years: number | null }>(
    `select e.id, c.name as "clientName", to_char(e.period_start, 'YYYY-MM-DD') as "periodStart", to_char(e.period_end, 'YYYY-MM-DD') as "periodEnd",
            to_char(e.archived_at at time zone 'UTC', 'YYYY-MM-DD') as "archivedAt", f.retention_years as years,
            coalesce(e.archived_at + make_interval(years => f.retention_years) <= clock_timestamp(), false) as eligible
     from engagements e join clients c on c.id = e.client_id join firms f on f.id = e.firm_id
     where e.id = $1 and e.firm_id = $2 and e.archived_at is not null`,
    [engagementId, s.firmId],
  );
  if (rows.length === 0) throw new Error("Only an archived file of this firm can be deleted.");
  if (rows[0].years === null) throw new Error(NOT_SET);
  if (!rows[0].eligible) throw new Error("This file is not yet past the firm's retention period.");
  return rows[0];
}

/** A pending request (not approved, not cancelled), with its requester. Throws when there is none. */
async function pendingRequest(tx: Tx, requestId: number): Promise<{ id: number; engagementId: string; requesterId: string }> {
  const { rows } = await tx.query<{ id: number; engagementId: string; requesterId: string; outcome: boolean }>(
    `select r.id::float8 as id, r.engagement_id as "engagementId", r.actor_id as "requesterId",
            exists (select 1 from retention_deletions o where o.request_id = r.id and o.kind in ('approved', 'cancelled')) as outcome
     from retention_deletions r where r.id = $1 and r.kind = 'requested'`,
    [requestId],
  );
  if (rows.length === 0) throw new Error("That deletion request does not exist.");
  if (rows[0].outcome) throw new Error("That deletion request has already been approved or cancelled.");
  return rows[0];
}

/** A partner-level person asks for an eligible archived file to be deleted, with a reason. Nothing is deleted. */
export async function requestDeletion(tx: Tx, s: Session, engagementId: string, reason: string): Promise<number> {
  await requirePartner(tx, s);
  const why = reason.trim();
  if (why.length < MIN_REASON) throw new Error("Give the reason for deleting this file; it is recorded.");
  if (why.length > MAX_REASON) throw new Error(`The reason is too long: the most is ${MAX_REASON.toLocaleString("en-GB")} characters.`);
  await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`retention:${engagementId}`]);
  const e = await subject(tx, s, engagementId);
  const open = await tx.query(
    "select 1 from retention_deletions r where r.engagement_id = $1 and r.kind = 'requested' and not exists (select 1 from retention_deletions o where o.request_id = r.id and o.kind in ('approved', 'cancelled'))",
    [engagementId],
  );
  if (open.rows.length > 0) throw new Error("A deletion has already been requested for this file. Cancel it first to ask again.");
  const counts = (await tx.query<{ c: Record<string, number> }>("select retention_counts($1) as c", [engagementId])).rows[0].c;
  const snapshot = { clientName: e.clientName, periodStart: e.periodStart, periodEnd: e.periodEnd, archivedOn: e.archivedAt, counts };
  const { rows } = await tx.query<{ id: number }>(
    "insert into retention_deletions (firm_id, engagement_id, kind, actor_id, reason, snapshot) values ($1, $2, 'requested', $3, $4, $5) returning id::float8 as id",
    [s.firmId, engagementId, s.userId, why, JSON.stringify(snapshot)],
  );
  await audit(tx, s, "retention_request", "engagement", engagementId, { requestId: rows[0].id, reason: why, clientName: e.clientName, counts });
  return rows[0].id;
}

/** Cancel a pending request. The requester or any other partner-level person may. */
export async function cancelDeletion(tx: Tx, s: Session, requestId: number): Promise<void> {
  await requirePartner(tx, s);
  const r = await pendingRequest(tx, requestId);
  await tx.query("insert into retention_deletions (firm_id, engagement_id, kind, request_id, actor_id) values ($1, $2, 'cancelled', $3, $4)", [s.firmId, r.engagementId, requestId, s.userId]);
  await audit(tx, s, "retention_cancel", "engagement", r.engagementId, { requestId });
}

export interface PurgeResult {
  purgeId: number;
  keys: string[];
  counts: Record<string, number>;
  clientName: string;
}

/**
 * A DIFFERENT partner-level person approves by typing the client's name exactly, and the file is deleted in the same transaction by
 * purge_engagement(), which checks everything again. If anything is wrong nothing is deleted, and the approval is not recorded either.
 * The files in the file store are removed after the commit (`removePendingFiles`).
 */
export async function approveDeletion(tx: Tx, s: Session, requestId: number, typedName: string): Promise<PurgeResult> {
  await requirePartner(tx, s);
  const r = await pendingRequest(tx, requestId);
  if (r.requesterId === s.userId) throw new Error(SAME_PERSON);
  const e = await subject(tx, s, r.engagementId);
  if (typedName.trim() !== e.clientName) throw new Error(NAME_MISMATCH);
  const partners = (await tx.query<{ n: number }>("select count(*)::int as n from users where active and role in ('partner', 'admin')")).rows[0].n;
  if (partners < 2) throw new Error(ONE_PARTNER);
  await tx.query("insert into retention_deletions (firm_id, engagement_id, kind, request_id, actor_id, confirmed_name) values ($1, $2, 'approved', $3, $4, $5)", [s.firmId, r.engagementId, requestId, s.userId, e.clientName]);
  const out = (await tx.query<{ r: { purgeId: number; keys: string[]; counts: Record<string, number> } }>("select purge_engagement($1, $2) as r", [r.engagementId, requestId])).rows[0].r;
  await audit(tx, s, "retention_purge", "engagement", r.engagementId, { requestId, purgeId: out.purgeId, clientName: e.clientName, periodStart: e.periodStart, periodEnd: e.periodEnd, counts: out.counts, files: out.keys.length });
  return { ...out, clientName: e.clientName };
}

// --- The files ------------------------------------------------------------------------------------------------------------

export interface RemoveOutcome {
  removed: number;
  failed: { key: string; message: string }[];
}

/**
 * Remove, from the file store, the files of purged engagements that are still there. Each success is recorded (insert-only); a failure is logged, left
 * on the list and reported, never swallowed. Safe to run again: this is the retry.
 */
export async function removePendingFiles(db: Db, firmId: string, store: FileStore, keys?: string[]): Promise<RemoveOutcome> {
  const pending = await withFirm(db, firmId, async (tx) => (await getRetention(tx)).pendingFiles);
  const out: RemoveOutcome = { removed: 0, failed: [] };
  for (const f of pending) {
    if (keys && !keys.includes(f.key)) continue;
    try {
      await store.remove(f.key);
      await withFirm(db, firmId, (tx) => tx.query("insert into retention_file_removals (file_id, firm_id) values ($1, $2) on conflict (file_id) do nothing", [f.id, firmId]));
      out.removed++;
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";
      console.error(`retention: a file of a deleted engagement could not be removed (${f.key}): ${message}`);
      out.failed.push({ key: f.key, message });
    }
  }
  return out;
}
