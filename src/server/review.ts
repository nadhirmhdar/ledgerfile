import type { Tx } from "./db";
import { audit, getEngagement, isSolePractitioner, listAccounts } from "./repo";
import { getAuditOverview } from "./audit";
import { getAdoption } from "./methodology-adoption";
import { lockAdoption } from "../domain/methodology-adoption";
import { buildLeadSheets } from "../domain/leadsheet";
import { buildStatements } from "../domain/statements";
import { GROUP_BY_CODE } from "../domain/groups";
import { canLock, canReview, lockReadiness, signOffBlocker, type Level, type LockReadiness, type Role } from "../domain/signoff";

/** The signed-in user, with the role read from the database for this request. */
export interface Actor {
  firmId: string;
  userId: string;
  role: Role;
}

/** Review points may also be raised on the engagement as a whole. */
export const GENERAL = "GENERAL";

export interface LeadSheetReview {
  groupCode: string;
  groupName: string;
  closingMinor: number;
  preparer: { userId: string; name: string; at: string } | null;
  reviewer: { userId: string; name: string; at: string } | null;
  openPoints: number;
}

/** One reply in a review point's thread, oldest first. A response written before threads existed is read from the point itself and shown first, with no date. */
export interface ThreadReply {
  id: string;
  authorName: string;
  body: string;
  /** YYYY-MM-DD; null for a response written before the date was kept. */
  writtenAt: string | null;
  legacy: boolean;
}

export interface ReviewPoint {
  id: string;
  authorId: string;
  target: string;
  targetName: string;
  body: string;
  authorName: string;
  createdAt: string;
  response: string | null;
  responderName: string | null;
  /** The reply thread. When the point has no replies yet but has a single older response, that response is the one entry. */
  thread: ThreadReply[];
  status: "open" | "cleared";
  clearedByName: string | null;
}

export interface ReviewOverview {
  status: string;
  /** Audit procedures marked not applicable, shown to the partner before locking. */
  auditNotApplicable?: number;
  /** The firm has exactly one user, so that user may review their own lead sheets. */
  solePractitioner: boolean;
  lockedByName: string | null;
  lockedAt: string | null;
  /** The day the file was archived and by whom (the permanent lock), or null. */
  archivedAt: string | null;
  archivedByName: string | null;
  /** The audit is on, an opinion is recorded, and its report date: what the archiving rules and the file assembly deadline need. */
  audited: boolean;
  hasOpinion: boolean;
  reportDate: string | null;
  leadSheets: LeadSheetReview[];
  points: ReviewPoint[];
  readiness: LockReadiness;
}

async function requireOpen(tx: Tx, engagementId: string) {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new Error("Engagement not found.");
  if (engagement.status !== "open") throw new Error("This engagement is locked.");
}

const targetName = (target: string) => (target === GENERAL ? "General" : (GROUP_BY_CODE.get(target)?.name ?? target));

export async function getOverview(tx: Tx, engagementId: string): Promise<ReviewOverview | null> {
  const lock = await tx.query<{ status: string; lockedByName: string | null; lockedAt: string | null; archivedAt: string | null; archivedByName: string | null; splitCurrent: number; splitPrior: number }>(
    `select e.status, e.borrowings_current_minor::float8 as "splitCurrent", e.borrowings_current_prior_minor::float8 as "splitPrior", u.name as "lockedByName", to_char(e.locked_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC' as "lockedAt",
            to_char(e.archived_at at time zone 'UTC', 'YYYY-MM-DD') as "archivedAt", au.name as "archivedByName"
     from engagements e left join users u on u.id = e.locked_by left join users au on au.id = e.archived_by where e.id = $1`,
    [engagementId],
  );
  if (lock.rows.length === 0) return null;

  const accounts = (await listAccounts(tx, engagementId)).map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor }));
  const sheets = buildLeadSheets(accounts).sheets;
  const statements = buildStatements(accounts, { borrowingsCurrent: { current: lock.rows[0].splitCurrent, prior: lock.rows[0].splitPrior } });

  const signOffs = await tx.query<{ target: string; level: Level; userId: string; name: string; at: string }>(
    `select s.target, s.level, s.user_id as "userId", u.name, to_char(s.signed_at, 'YYYY-MM-DD') as at
     from sign_offs s join users u on u.id = s.user_id where s.engagement_id = $1`,
    [engagementId],
  );
  const pointRows = await tx.query<Omit<ReviewPoint, "targetName" | "thread">>(
    `select p.id, p.author_id as "authorId", p.target, p.body, a.name as "authorName", to_char(p.created_at, 'YYYY-MM-DD') as "createdAt",
            p.response, r.name as "responderName", p.status, c.name as "clearedByName"
     from review_points p
     join users a on a.id = p.author_id
     left join users r on r.id = p.responded_by
     left join users c on c.id = p.cleared_by
     where p.engagement_id = $1
     order by (p.status = 'cleared'), p.created_at`,
    [engagementId],
  );

  const replies = await tx.query<{ pointId: string; id: string; authorName: string; body: string; writtenAt: string; legacy: boolean }>(
    `select r.point_id as "pointId", r.id::text as id, u.name as "authorName", r.body, to_char(r.written_at, 'YYYY-MM-DD') as "writtenAt", r.legacy
     from review_point_replies r join users u on u.id = r.author_id where r.engagement_id = $1 order by r.id`,
    [engagementId],
  );
  const points = {
    rows: pointRows.rows.map((p): Omit<ReviewPoint, "targetName"> => {
      const own = replies.rows.filter((r) => r.pointId === p.id).map((r) => ({ id: r.id, authorName: r.authorName, body: r.body, legacy: r.legacy, writtenAt: r.legacy ? null : r.writtenAt }));
      // No backfill: an older single response is read from the column and shown as the first reply until the point is first replied to.
      const thread: ThreadReply[] = own.length === 0 && p.response ? [{ id: "legacy", authorName: p.responderName ?? "Unknown", body: p.response, writtenAt: null, legacy: true }] : own;
      return { ...p, thread };
    }),
  };

  const solePractitioner = await isSolePractitioner(tx);

  const find = (target: string, level: Level) => {
    const s = signOffs.rows.find((r) => r.target === target && r.level === level);
    return s ? { userId: s.userId, name: s.name, at: s.at } : null;
  };
  const openFor = (target: string) => points.rows.filter((p) => p.target === target && p.status === "open").length;

  const leadSheets: LeadSheetReview[] = sheets.map((sh) => ({
    groupCode: sh.groupCode,
    groupName: sh.groupName,
    closingMinor: sh.closingMinor,
    preparer: find(sh.groupCode, "preparer"),
    reviewer: find(sh.groupCode, "reviewer"),
    openPoints: openFor(sh.groupCode),
  }));

  // Once an engagement is being audited, unfinished audit work also blocks the lock.
  const auditOverview = await getAuditOverview(tx, engagementId);
  const auditBlockers = auditOverview?.blockers ?? [];
  const opinion = await tx.query<{ reportDate: string | null }>("select to_char(report_date, 'YYYY-MM-DD') as \"reportDate\" from audit_opinions where engagement_id = $1", [engagementId]);
  const overview: ReviewOverview = {
    status: lock.rows[0].status,
    lockedByName: lock.rows[0].lockedByName,
    lockedAt: lock.rows[0].lockedAt,
    archivedAt: lock.rows[0].archivedAt,
    archivedByName: lock.rows[0].archivedByName,
    audited: auditOverview?.enabled ?? false,
    hasOpinion: opinion.rows.length > 0,
    reportDate: opinion.rows[0]?.reportDate ?? null,
    solePractitioner,
    leadSheets,
    points: points.rows.map((p) => ({ ...p, targetName: targetName(p.target) })),
    readiness: lockReadiness({
      statementsClean: statements.clean,
      failedChecks: statements.checks.filter((c) => !c.passed).map((c) => c.label),
      leadSheets: leadSheets.map((l) => ({ name: l.groupName, prepared: !!l.preparer, reviewed: !!l.reviewer })),
      openPoints: points.rows.filter((p) => p.status === "open").length,
    }),
  };
  overview.readiness = { ready: overview.readiness.ready && auditBlockers.length === 0, blockers: [...overview.readiness.blockers, ...auditBlockers] };
  overview.auditNotApplicable = auditOverview?.enabled ? auditOverview.notApplicable : 0;
  return overview;
}

export async function signOff(tx: Tx, actor: Actor, engagementId: string, groupCode: string, level: Level): Promise<void> {
  await requireOpen(tx, engagementId);
  const overview = await getOverview(tx, engagementId);
  const sheet = overview?.leadSheets.find((l) => l.groupCode === groupCode);
  if (!sheet) throw new Error("That lead sheet does not exist on this engagement.");
  const blocker = signOffBlocker(level, { id: actor.userId, role: actor.role }, {
    preparerId: sheet.preparer?.userId ?? null,
    reviewerId: sheet.reviewer?.userId ?? null,
    openPoints: sheet.openPoints,
    solePractitioner: overview!.solePractitioner,
  });
  if (blocker) throw new Error(blocker);
  await tx.query("insert into sign_offs (firm_id, engagement_id, target, level, user_id) values ($1, $2, $3, $4, $5)", [
    actor.firmId,
    engagementId,
    groupCode,
    level,
    actor.userId,
  ]);
  // A self-review is recorded as such, so it can be identified in the file afterwards.
  const selfReview = level === "reviewer" && sheet.preparer?.userId === actor.userId;
  await audit(tx, actor, "sign_off", "lead_sheet", engagementId, { groupCode, level, ...(selfReview ? { selfReview: true } : {}) });
}

/** Withdraw your own sign-off. Withdrawing the preparer's also removes the review that relied on it. */
export async function withdrawSignOff(tx: Tx, actor: Actor, engagementId: string, groupCode: string, level: Level): Promise<void> {
  await requireOpen(tx, engagementId);
  const removed = await tx.query(
    "delete from sign_offs where engagement_id = $1 and target = $2 and level = $3 and user_id = $4 returning id",
    [engagementId, groupCode, level, actor.userId],
  );
  if (removed.rows.length === 0) throw new Error("You can only withdraw your own sign-off.");
  if (level === "preparer") {
    await tx.query("delete from sign_offs where engagement_id = $1 and target = $2 and level = 'reviewer'", [engagementId, groupCode]);
  }
  await audit(tx, actor, "withdraw_sign_off", "lead_sheet", engagementId, { groupCode, level });
}

export async function addReviewPoint(tx: Tx, actor: Actor, engagementId: string, target: string, body: string): Promise<string> {
  await requireOpen(tx, engagementId);
  if (!canReview(actor.role)) throw new Error("Only a reviewer or partner can raise review points.");
  if (target !== GENERAL && !GROUP_BY_CODE.has(target)) throw new Error("Choose what the review point relates to.");
  const text = body.trim();
  if (text.length < 3) throw new Error("Write the review point.");
  if (text.length > 2000) throw new Error("The review point is too long.");
  const { rows } = await tx.query<{ id: string }>(
    "insert into review_points (firm_id, engagement_id, target, author_id, body) values ($1, $2, $3, $4, $5) returning id",
    [actor.firmId, engagementId, target, actor.userId, text],
  );
  // A new query on a lead sheet means its review is no longer complete.
  if (target !== GENERAL) {
    await tx.query("delete from sign_offs where engagement_id = $1 and target = $2 and level = 'reviewer'", [engagementId, target]);
  }
  await audit(tx, actor, "raise", "review_point", rows[0].id, { engagementId, target });
  return rows[0].id;
}

async function openPoint(tx: Tx, pointId: string) {
  const { rows } = await tx.query<{ engagementId: string; status: string; authorId: string }>(
    'select engagement_id as "engagementId", status, author_id as "authorId" from review_points where id = $1',
    [pointId],
  );
  if (rows.length === 0) throw new Error("Review point not found.");
  await requireOpen(tx, rows[0].engagementId);
  if (rows[0].status !== "open") throw new Error("This review point is already cleared.");
  return rows[0];
}

/**
 * Reply on a review point. Anyone in the firm may reply, as anyone may respond today; the reviewer or partner who raised the point answers back the
 * same way. Only on an open point of an open engagement. The thread is append-only.
 *
 * "Answered" keeps its meaning everywhere (review_points.response is not null): a reply by someone other than the point's author sets response and
 * responded_by to that reply, as respond always did; a reply by the author, asking again, clears both, so the point waits for a response again.
 */
export async function replyToReviewPoint(tx: Tx, actor: Actor, pointId: string, reply: string): Promise<void> {
  const point = await openPoint(tx, pointId);
  const text = reply.trim();
  if (text.length < 2) throw new Error("Write a reply.");
  if (text.length > 2000) throw new Error("The reply is too long.");
  // A response written before threads existed would be overwritten below, so it is first kept in the thread as its own entry.
  const earlier = await tx.query<{ n: number; response: string | null; respondedBy: string | null }>(
    `select (select count(*)::int from review_point_replies where point_id = $1) as n, response, responded_by as "respondedBy" from review_points where id = $1`,
    [pointId],
  );
  if (earlier.rows[0].n === 0 && earlier.rows[0].response && earlier.rows[0].respondedBy) {
    await tx.query("insert into review_point_replies (firm_id, engagement_id, point_id, author_id, body, legacy) values ($1, $2, $3, $4, $5, true)", [
      actor.firmId,
      point.engagementId,
      pointId,
      earlier.rows[0].respondedBy,
      earlier.rows[0].response,
    ]);
  }
  await tx.query("insert into review_point_replies (firm_id, engagement_id, point_id, author_id, body) values ($1, $2, $3, $4, $5)", [actor.firmId, point.engagementId, pointId, actor.userId, text]);
  const byAuthor = actor.userId === point.authorId;
  if (byAuthor) await tx.query("update review_points set response = null, responded_by = null where id = $1", [pointId]);
  else await tx.query("update review_points set response = $2, responded_by = $3 where id = $1", [pointId, text, actor.userId]);
  await audit(tx, actor, "reply", "review_point", pointId, { engagementId: point.engagementId, byAuthor, answered: !byAuthor, reply: text });
}

/** The name the form and older callers use: responding is replying. */
export const respondToReviewPoint = replyToReviewPoint;

export async function clearReviewPoint(tx: Tx, actor: Actor, pointId: string): Promise<void> {
  const point = await openPoint(tx, pointId);
  if (!canReview(actor.role)) throw new Error("Only a reviewer or partner can clear review points.");
  await tx.query("update review_points set status = 'cleared', cleared_by = $2, cleared_at = now() where id = $1", [pointId, actor.userId]);
  await audit(tx, actor, "clear", "review_point", pointId, { engagementId: point.engagementId });
}

export async function lockEngagement(tx: Tx, actor: Actor, engagementId: string): Promise<void> {
  await requireOpen(tx, engagementId);
  if (!canLock(actor.role)) throw new Error("Only a partner can lock an engagement.");
  const overview = await getOverview(tx, engagementId);
  if (!overview!.readiness.ready) throw new Error(`The engagement is not ready to lock. ${overview!.readiness.blockers.join(" ")}`);
  await tx.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [engagementId, actor.userId]);
  // Which adoption of the methodology was current when the file was locked, or "none". Recorded only: it changes nothing about locking.
  await audit(tx, actor, "lock", "engagement", engagementId, { methodologyAdoption: lockAdoption((await getAdoption(tx)).state) });
}

export async function unlockEngagement(tx: Tx, actor: Actor, engagementId: string, reason: string): Promise<void> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new Error("Engagement not found.");
  if (engagement.archivedAt) throw new Error("This file is archived. Archived files cannot be unlocked.");
  if (engagement.status !== "locked") throw new Error("This engagement is not locked.");
  if (!canLock(actor.role)) throw new Error("Only a partner can unlock an engagement.");
  if (reason.trim().length < 5) throw new Error("Give the reason for unlocking; it is recorded in the audit log.");
  await tx.query("update engagements set status = 'open', locked_by = null, locked_at = null where id = $1", [engagementId]);
  await audit(tx, actor, "unlock", "engagement", engagementId, { reason: reason.trim() });
}
