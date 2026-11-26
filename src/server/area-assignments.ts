import type { Tx } from "./db";
import { audit, canSelfReviewAudit, type Session } from "./repo";
import { canLock, type Role } from "../domain/signoff";
import { ASSIGN_REFUSAL, LOCKED_REFUSAL, PERSON_REFUSAL, SELF_REVIEW_REFUSAL, slotBlocker } from "../domain/my-work";
import { AREA_REFUSAL, areaTitle, effectiveTeam, isAssignableArea } from "../domain/area-assignments";
import type { TeamPerson } from "./engagement-team";

/**
 * Who prepares and who reviews one audit area where that is not the engagement's own preparer or reviewer (migration 0040). An override is a current
 * setting, not a record: setting it again replaces it, clearing both places removes the row, and the audit log keeps every change with its before and
 * after. Roll-forward does not carry these (a default: next year's team is chosen again).
 */

export interface AreaAssignment {
  areaCode: string;
  preparer: TeamPerson | null;
  reviewer: TeamPerson | null;
}

interface Row {
  areaCode: string;
  preparerId: string | null;
  preparerName: string | null;
  preparerRole: Role | null;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewerRole: Role | null;
}

const toAssignment = (r: Row): AreaAssignment => ({
  areaCode: r.areaCode,
  preparer: r.preparerId ? { id: r.preparerId, name: r.preparerName ?? "", role: r.preparerRole as Role } : null,
  reviewer: r.reviewerId ? { id: r.reviewerId, name: r.reviewerName ?? "", role: r.reviewerRole as Role } : null,
});

const SELECT = `
  select a.area_code as "areaCode", p.id as "preparerId", p.name as "preparerName", p.role as "preparerRole",
         r.id as "reviewerId", r.name as "reviewerName", r.role as "reviewerRole"
  from engagement_area_assignments a
  left join users p on p.id = a.preparer_id
  left join users r on r.id = a.reviewer_id`;

/** The areas of one engagement that have their own preparer or reviewer, by area code. */
export async function listAreaAssignments(tx: Tx, engagementId: string): Promise<Map<string, AreaAssignment>> {
  const { rows } = await tx.query<Row>(`${SELECT} where a.engagement_id = $1 order by a.area_code`, [engagementId]);
  return new Map(rows.map((r) => [r.areaCode, toAssignment(r)]));
}

export interface AreaInput {
  areaCode: string;
  preparerId: string | null;
  reviewerId: string | null;
}

export interface AreaAssignResult {
  changed: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Set or clear one area's own preparer and reviewer. Every rule is checked here, on the server, whatever the page showed:
 * - the role is read again from the database, and only a partner or administrator (who may set the engagement team) may set it;
 * - the engagement must be this firm's and open (a locked or archived file refuses, with the locked-file wording the rest of the app uses);
 * - the area must be one of the audit's areas or checklists;
 * - each person must be an active user of this firm, and a reviewer must hold reviewer rights;
 * - the same person as the area's preparer and reviewer is allowed only where the firm already allows self-review;
 * - both places empty ("Same as the engagement") removes the row; a change is audit-logged with the area, the before and the after.
 */
export async function setAreaAssignment(tx: Tx, s: Session, engagementId: string, input: AreaInput): Promise<AreaAssignResult> {
  const who = await tx.query<{ role: Role; active: boolean }>("select role, active from users where id = $1 and firm_id = $2", [s.userId, s.firmId]);
  if (!who.rows[0]?.active || !canLock(who.rows[0].role)) throw new Error(ASSIGN_REFUSAL);

  const e = await tx.query<{ status: string; preparerId: string | null; reviewerId: string | null }>(
    `select status, preparer_id as "preparerId", reviewer_id as "reviewerId" from engagements where id = $1 and firm_id = $2`,
    [engagementId, s.firmId],
  );
  if (e.rows.length === 0) throw new Error("Engagement not found.");
  if (e.rows[0].status !== "open") throw new Error(LOCKED_REFUSAL);
  if (!isAssignableArea(input.areaCode)) throw new Error(AREA_REFUSAL);

  const people = new Map<string, TeamPerson>();
  for (const [slot, id] of [["preparer", input.preparerId], ["reviewer", input.reviewerId]] as const) {
    if (id === null) continue;
    if (!UUID.test(id)) throw new Error(PERSON_REFUSAL);
    const { rows } = await tx.query<TeamPerson>("select id, name, role from users where id = $1 and firm_id = $2 and active", [id, s.firmId]);
    if (rows.length === 0) throw new Error(PERSON_REFUSAL);
    const blocker = slotBlocker(slot, rows[0].role);
    if (blocker) throw new Error(blocker);
    people.set(id, rows[0]);
  }
  const effective = effectiveTeam({ preparerId: input.preparerId, reviewerId: input.reviewerId }, e.rows[0]);
  if (effective.preparerId !== null && effective.preparerId === effective.reviewerId && (input.preparerId !== null || input.reviewerId !== null) && !(await canSelfReviewAudit(tx))) {
    throw new Error(SELF_REVIEW_REFUSAL);
  }

  // One writer at a time per engagement and area, so two saves cannot race on the unique row.
  await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`area_assignment:${engagementId}:${input.areaCode}`]);
  const before = (await listAreaAssignments(tx, engagementId)).get(input.areaCode) ?? null;
  const beforeIds = { preparerId: before?.preparer?.id ?? null, reviewerId: before?.reviewer?.id ?? null };
  if (beforeIds.preparerId === input.preparerId && beforeIds.reviewerId === input.reviewerId) return { changed: false };

  if (input.preparerId === null && input.reviewerId === null) {
    await tx.query("delete from engagement_area_assignments where engagement_id = $1 and area_code = $2 and firm_id = $3", [engagementId, input.areaCode, s.firmId]);
  } else {
    await tx.query(
      `insert into engagement_area_assignments (firm_id, engagement_id, area_code, preparer_id, reviewer_id, assigned_by)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (engagement_id, area_code) do update set preparer_id = excluded.preparer_id, reviewer_id = excluded.reviewer_id, assigned_by = excluded.assigned_by, assigned_at = clock_timestamp()`,
      [s.firmId, engagementId, input.areaCode, input.preparerId, input.reviewerId, s.userId],
    );
  }
  const was = (p: TeamPerson | null | undefined) => (p ? { id: p.id, name: p.name } : null);
  const named = (id: string | null) => (id === null ? null : { id, name: people.get(id)?.name ?? "" });
  await audit(tx, s, "assign_area", "engagement", engagementId, {
    area: input.areaCode,
    areaTitle: areaTitle(input.areaCode),
    before: { preparer: was(before?.preparer), reviewer: was(before?.reviewer) },
    after: { preparer: named(input.preparerId), reviewer: named(input.reviewerId) },
  });
  return { changed: true };
}
