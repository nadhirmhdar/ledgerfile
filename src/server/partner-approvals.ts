import type { Tx } from "./db";
import { audit, type Session } from "./repo";
import { canLock, type Role } from "../domain/signoff";
import { APPROVAL_LABEL, ASSIGN_PARTNER_FIRST, ONLY_ENGAGEMENT_PARTNER, type Approval, type ApprovalKind, type Approvals } from "../domain/partner-approvals";

/**
 * The engagement partner's approval of acceptance and planning (migration 0043): columns on engagements, so it is a current setting; the audit log keeps
 * every approval and withdrawal. The planning approval counts only while the latest materiality revision and the risk ratings are the ones it was given
 * for. Every rule is checked here, on the server.
 */

/** A fingerprint of every risk rating of the engagement named by `$e`. */
export const RISK_DIGEST = (e: string) => `(select md5(coalesce(string_agg(area_code || ':' || assertion || ':' || level, ',' order by area_code, assertion), '')) from risk_assessments where engagement_id = ${e})`;
/** The latest materiality revision of the engagement named by `$e` (null when none). */
export const LATEST_MATERIALITY = (e: string) => `(select id from materiality where engagement_id = ${e} order by created_at desc, id desc limit 1)`;

interface Row {
  engagementId: string;
  acceptanceBy: string | null;
  acceptanceAt: string | null;
  planningBy: string | null;
  planningAt: string | null;
  materialityChanged: boolean;
  riskChanged: boolean;
}

const SELECT = `
  select e.id as "engagementId", ab.name as "acceptanceBy", to_char(e.acceptance_approved_at at time zone 'UTC', 'YYYY-MM-DD') as "acceptanceAt",
         pb.name as "planningBy", to_char(e.planning_approved_at at time zone 'UTC', 'YYYY-MM-DD') as "planningAt",
         e.planning_approved_materiality_id is distinct from ${LATEST_MATERIALITY("e.id")} as "materialityChanged",
         e.planning_approved_risk_digest is distinct from ${RISK_DIGEST("e.id")} as "riskChanged"
  from engagements e
  left join users ab on ab.id = e.acceptance_approved_by
  left join users pb on pb.id = e.planning_approved_by`;

const toApprovals = (r: Row): Approvals => ({
  acceptance: r.acceptanceAt ? { by: r.acceptanceBy ?? "Unknown", at: r.acceptanceAt, stale: null } : null,
  planning: r.planningAt ? ({ by: r.planningBy ?? "Unknown", at: r.planningAt, stale: r.materialityChanged ? "materiality" : r.riskChanged ? "risk" : null } satisfies Approval) : null,
});

export async function getApprovals(tx: Tx, engagementId: string): Promise<Approvals> {
  const { rows } = await tx.query<Row>(`${SELECT} where e.id = $1`, [engagementId]);
  return rows[0] ? toApprovals(rows[0]) : { acceptance: null, planning: null };
}

/** The approvals of several engagements at once, for My work. */
export async function listApprovals(tx: Tx, engagementIds: string[]): Promise<Map<string, Approvals>> {
  const { rows } = await tx.query<Row>(`${SELECT} where e.id = any($1::uuid[])`, [engagementIds]);
  return new Map(rows.map((r) => [r.engagementId, toApprovals(r)]));
}

/**
 * Only the engagement partner may approve or withdraw: the role, whether they are active and the engagement's partner are read again from the database.
 * The engagement must be this firm's, open and audited.
 */
async function authorise(tx: Tx, s: Session, engagementId: string): Promise<void> {
  const e = await tx.query<{ status: string; partnerId: string | null; audited: boolean }>('select status, partner_id as "partnerId", audit_enabled as audited from engagements where id = $1 and firm_id = $2', [engagementId, s.firmId]);
  if (e.rows.length === 0) throw new Error("Engagement not found.");
  // A locked file is read-only, and an archived one is locked.
  if (e.rows[0].status !== "open") throw new Error("This engagement is locked.");
  if (!e.rows[0].audited) throw new Error("Turn the audit on for this engagement first.");
  if (e.rows[0].partnerId === null) throw new Error(ASSIGN_PARTNER_FIRST);
  const who = await tx.query<{ role: Role; active: boolean }>("select role, active from users where id = $1 and firm_id = $2", [s.userId, s.firmId]);
  if (e.rows[0].partnerId !== s.userId || !who.rows[0]?.active || !canLock(who.rows[0].role)) throw new Error(ONLY_ENGAGEMENT_PARTNER);
}

const isKind = (v: string): v is ApprovalKind => v === "acceptance" || v === "planning";

export async function approve(tx: Tx, s: Session, engagementId: string, kind: string): Promise<void> {
  if (!isKind(kind)) throw new Error("Choose acceptance or planning.");
  await authorise(tx, s, engagementId);
  const now = (await getApprovals(tx, engagementId))[kind];
  if (now && now.stale === null) throw new Error(`${APPROVAL_LABEL[kind]} is already approved.`);
  if (kind === "acceptance") {
    await tx.query("update engagements set acceptance_approved_by = $2, acceptance_approved_at = clock_timestamp() where id = $1 and firm_id = $3", [engagementId, s.userId, s.firmId]);
  } else {
    await tx.query(
      `update engagements e set planning_approved_by = $2, planning_approved_at = clock_timestamp(),
         planning_approved_materiality_id = ${LATEST_MATERIALITY("e.id")}, planning_approved_risk_digest = ${RISK_DIGEST("e.id")}
       where e.id = $1 and e.firm_id = $3`,
      [engagementId, s.userId, s.firmId],
    );
  }
  await audit(tx, s, "partner_approve", "engagement", engagementId, { approval: kind, again: now !== null });
}

export async function withdrawApproval(tx: Tx, s: Session, engagementId: string, kind: string): Promise<void> {
  if (!isKind(kind)) throw new Error("Choose acceptance or planning.");
  await authorise(tx, s, engagementId);
  const now = (await getApprovals(tx, engagementId))[kind];
  if (!now) throw new Error(`${APPROVAL_LABEL[kind]} is not approved.`);
  const sql =
    kind === "acceptance"
      ? "update engagements set acceptance_approved_by = null, acceptance_approved_at = null where id = $1 and firm_id = $2"
      : "update engagements set planning_approved_by = null, planning_approved_at = null, planning_approved_materiality_id = null, planning_approved_risk_digest = null where id = $1 and firm_id = $2";
  await tx.query(sql, [engagementId, s.firmId]);
  await audit(tx, s, "partner_withdraw", "engagement", engagementId, { approval: kind, approvedBy: now.by, approvedAt: now.at });
}
