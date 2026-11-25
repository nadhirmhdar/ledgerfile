import type { Tx } from "./db";
import { audit, canSelfReviewAudit, type Session } from "./repo";
import { canLock, type Role } from "../domain/signoff";
import {
  ASSIGN_REFUSAL,
  DATE_REFUSAL,
  isRealDate,
  LOCKED_REFUSAL,
  PERSON_REFUSAL,
  SELF_REVIEW_REFUSAL,
  SLOT_LABEL,
  SLOTS,
  slotBlocker,
  type Slot,
} from "../domain/my-work";

/**
 * Who is assigned to an engagement (preparer, reviewer, partner) and when its report is due. Engagement level only: assigning people to
 * a single audit area is a later item. Nothing here changes what a person may do; it records who should.
 */

export interface TeamPerson {
  id: string;
  name: string;
  role: Role;
}

export interface EngagementTeam {
  preparer: TeamPerson | null;
  reviewer: TeamPerson | null;
  partner: TeamPerson | null;
  reportDueOn: string | null;
}

const PEOPLE = `
  select e.id as "engagementId", to_char(e.report_due_on, 'YYYY-MM-DD') as "reportDueOn",
         p.id as "preparerId", p.name as "preparerName", p.role as "preparerRole",
         r.id as "reviewerId", r.name as "reviewerName", r.role as "reviewerRole",
         a.id as "partnerId", a.name as "partnerName", a.role as "partnerRole"
  from engagements e
  left join users p on p.id = e.preparer_id
  left join users r on r.id = e.reviewer_id
  left join users a on a.id = e.partner_id`;

interface PeopleRow {
  engagementId: string;
  reportDueOn: string | null;
  preparerId: string | null;
  preparerName: string | null;
  preparerRole: Role | null;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewerRole: Role | null;
  partnerId: string | null;
  partnerName: string | null;
  partnerRole: Role | null;
}

const person = (r: PeopleRow, slot: Slot): TeamPerson | null => {
  const id = r[`${slot}Id`];
  return id ? { id, name: r[`${slot}Name`] ?? "", role: r[`${slot}Role`] as Role } : null;
};

const teamOf = (r: PeopleRow): EngagementTeam => ({ preparer: person(r, "preparer"), reviewer: person(r, "reviewer"), partner: person(r, "partner"), reportDueOn: r.reportDueOn });

export async function getEngagementTeam(tx: Tx, engagementId: string): Promise<EngagementTeam | null> {
  const { rows } = await tx.query<PeopleRow>(`${PEOPLE} where e.id = $1`, [engagementId]);
  return rows[0] ? teamOf(rows[0]) : null;
}

/** Every engagement's team, for the list on the home page. One query. */
export async function listEngagementTeams(tx: Tx): Promise<Map<string, EngagementTeam>> {
  const { rows } = await tx.query<PeopleRow>(PEOPLE);
  return new Map(rows.map((r) => [r.engagementId, teamOf(r)]));
}

/** The people who can be assigned: the firm's active users, with their role. */
export async function listAssignable(tx: Tx): Promise<TeamPerson[]> {
  const { rows } = await tx.query<TeamPerson>("select id, name, role from users where active order by name, id");
  return rows;
}

export interface TeamInput {
  preparerId: string | null;
  reviewerId: string | null;
  partnerId: string | null;
  reportDueOn: string | null;
}

export interface AssignResult {
  /** What changed, by label ("Preparer", "Report due"), empty when the request matched what was already saved. */
  changed: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (p: TeamPerson | null) => p?.id ?? null;

/**
 * Assign the team and the report due date. Every rule is checked here, on the server, whatever the page showed:
 * - the role is read again from the database (not taken from the session), and only a partner or administrator may assign;
 * - the engagement must be open (a locked or archived file refuses, with the locked-file wording the rest of the app uses);
 * - each person must be an active user of this firm, and a reviewer or partner must hold the rights the place needs;
 * - the same person as preparer and reviewer is allowed only where the firm already allows self-review (`canSelfReviewAudit`);
 * - the change is audit-logged with the before and after.
 */
export async function assignTeam(tx: Tx, s: Session, engagementId: string, input: TeamInput): Promise<AssignResult> {
  const who = await tx.query<{ role: Role; active: boolean }>("select role, active from users where id = $1 and firm_id = $2", [s.userId, s.firmId]);
  if (!who.rows[0]?.active || !canLock(who.rows[0].role)) throw new Error(ASSIGN_REFUSAL);

  const state = await tx.query<{ status: string }>("select status from engagements where id = $1 and firm_id = $2", [engagementId, s.firmId]);
  if (state.rows.length === 0) throw new Error("Engagement not found.");
  if (state.rows[0].status !== "open") throw new Error(LOCKED_REFUSAL);

  const chosen: Record<Slot, string | null> = { preparer: input.preparerId, reviewer: input.reviewerId, partner: input.partnerId };
  const people = new Map<string, TeamPerson>();
  for (const slot of SLOTS) {
    const id = chosen[slot];
    if (id === null) continue;
    if (!UUID.test(id)) throw new Error(PERSON_REFUSAL);
    const { rows } = await tx.query<TeamPerson>("select id, name, role from users where id = $1 and firm_id = $2 and active", [id, s.firmId]);
    if (rows.length === 0) throw new Error(PERSON_REFUSAL);
    const blocker = slotBlocker(slot, rows[0].role);
    if (blocker) throw new Error(blocker);
    people.set(id, rows[0]);
  }
  if (chosen.preparer !== null && chosen.preparer === chosen.reviewer && !(await canSelfReviewAudit(tx))) throw new Error(SELF_REVIEW_REFUSAL);

  const due = input.reportDueOn === null || input.reportDueOn === "" ? null : input.reportDueOn;
  if (due !== null && !isRealDate(due)) throw new Error(DATE_REFUSAL);

  const before = (await getEngagementTeam(tx, engagementId))!;
  const changed = SLOTS.filter((slot) => idOf(before[slot]) !== chosen[slot]).map((slot) => SLOT_LABEL[slot]);
  if (before.reportDueOn !== due) changed.push("Report due");
  if (changed.length === 0) return { changed };

  const done = await tx.query(
    "update engagements set preparer_id = $2, reviewer_id = $3, partner_id = $4, report_due_on = $5 where id = $1 and firm_id = $6 and status = 'open' returning id",
    [engagementId, chosen.preparer, chosen.reviewer, chosen.partner, due, s.firmId],
  );
  if (done.rows.length === 0) throw new Error(LOCKED_REFUSAL);

  const named = (id: string | null) => (id === null ? null : { id, name: people.get(id)?.name ?? "" });
  const was = (p: TeamPerson | null) => (p ? { id: p.id, name: p.name } : null);
  await audit(tx, s, "assign_team", "engagement", engagementId, {
    changed,
    before: { preparer: was(before.preparer), reviewer: was(before.reviewer), partner: was(before.partner), reportDueOn: before.reportDueOn },
    after: { preparer: named(chosen.preparer), reviewer: named(chosen.reviewer), partner: named(chosen.partner), reportDueOn: due },
  });
  return { changed };
}
