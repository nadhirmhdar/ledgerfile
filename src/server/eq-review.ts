import type { Tx } from "./db";
import { audit, type Session } from "./repo";
import { canLock, canReview, type Role } from "../domain/signoff";
import { EQ_NOT_ON, EQ_NOT_REVIEWER, EQ_NOTE_TOO_LONG, EQ_ONLY_NAMED, EQ_ON_TEAM, EQ_SET_REFUSAL, MAX_EQ_NOTE, type EqReview } from "../domain/eq-review";
import { PERSON_REFUSAL } from "../domain/my-work";

/**
 * The optional engagement quality review (migration 0044): columns on engagements, so it is a current setting and the audit log keeps every change.
 * Every rule is checked here, on the server. Reading is not restricted: the EQ reviewer reads the engagement as any firm user can.
 */

const LOCKED = "This engagement is locked.";

/** Everyone on the engagement team: its three roles and every area preparer or reviewer who is set. `$e` is the engagement. */
export const TEAM_IDS = (e: string) => `(
  select preparer_id from engagements where id = ${e} union select reviewer_id from engagements where id = ${e} union select partner_id from engagements where id = ${e}
  union select preparer_id from engagement_area_assignments where engagement_id = ${e} union select reviewer_id from engagement_area_assignments where engagement_id = ${e})`;

interface Row {
  required: boolean;
  reviewerId: string | null;
  reviewerName: string | null;
  onTeam: boolean;
  signedBy: string | null;
  signedAt: string | null;
  note: string | null;
}

export async function getEqReview(tx: Tx, engagementId: string): Promise<EqReview> {
  const { rows } = await tx.query<Row>(
    `select e.eq_review_required as required, e.eq_reviewer_id as "reviewerId", u.name as "reviewerName",
            coalesce(e.eq_reviewer_id in (select t from ${TEAM_IDS("e.id")} as x(t) where t is not null), false) as "onTeam",
            sb.name as "signedBy", to_char(e.eq_signed_at at time zone 'UTC', 'YYYY-MM-DD') as "signedAt", e.eq_note as note
     from engagements e left join users u on u.id = e.eq_reviewer_id left join users sb on sb.id = e.eq_signed_by where e.id = $1`,
    [engagementId],
  );
  const r = rows[0];
  if (!r) return { required: false, reviewer: null, reviewerOnTeam: false, signed: null };
  return {
    required: r.required,
    reviewer: r.reviewerId ? { id: r.reviewerId, name: r.reviewerName ?? "Unknown" } : null,
    reviewerOnTeam: r.onTeam,
    signed: r.signedAt ? { by: r.signedBy ?? "Unknown", at: r.signedAt, note: r.note } : null,
  };
}

async function openEngagement(tx: Tx, s: Session, engagementId: string): Promise<{ role: Role; active: boolean }> {
  const e = await tx.query<{ status: string }>("select status from engagements where id = $1 and firm_id = $2", [engagementId, s.firmId]);
  if (e.rows.length === 0) throw new Error("Engagement not found.");
  // A locked file is read-only, and an archived one is locked.
  if (e.rows[0].status !== "open") throw new Error(LOCKED);
  const who = await tx.query<{ role: Role; active: boolean }>("select role, active from users where id = $1 and firm_id = $2", [s.userId, s.firmId]);
  return who.rows[0] ?? { role: "preparer", active: false };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EqSettingInput {
  required: boolean;
  reviewerId: string | null;
}

/**
 * Turn the review on or off and choose the reviewer. A partner or administrator only (role re-read). The reviewer must be an active user of this firm
 * with reviewer rights, not on the engagement team. Turning it off clears the reviewer and any sign-off; choosing a different reviewer clears the
 * sign-off, which belongs to the person who gave it.
 */
export async function setEqReview(tx: Tx, s: Session, engagementId: string, input: EqSettingInput): Promise<{ changed: boolean }> {
  const who = await openEngagement(tx, s, engagementId);
  if (!who.active || !canLock(who.role)) throw new Error(EQ_SET_REFUSAL);
  const reviewerId = input.required ? input.reviewerId : null;
  if (reviewerId !== null) {
    if (!UUID.test(reviewerId)) throw new Error(PERSON_REFUSAL);
    const { rows } = await tx.query<{ role: Role }>("select role from users where id = $1 and firm_id = $2 and active", [reviewerId, s.firmId]);
    if (rows.length === 0) throw new Error(PERSON_REFUSAL);
    if (!canReview(rows[0].role)) throw new Error(EQ_NOT_REVIEWER);
    const on = await tx.query(`select 1 where $2::uuid in (select t from ${TEAM_IDS("$1")} as x(t) where t is not null)`, [engagementId, reviewerId]);
    if (on.rows.length > 0) throw new Error(EQ_ON_TEAM);
  }
  const before = await getEqReview(tx, engagementId);
  if (before.required === input.required && (before.reviewer?.id ?? null) === reviewerId) return { changed: false };
  const keepSignature = input.required && (before.reviewer?.id ?? null) === reviewerId;
  await tx.query(
    `update engagements set eq_review_required = $2, eq_reviewer_id = $3,
       eq_signed_by = case when $4 then eq_signed_by else null end, eq_signed_at = case when $4 then eq_signed_at else null end, eq_note = case when $4 then eq_note else null end
     where id = $1 and firm_id = $5`,
    [engagementId, input.required, reviewerId, keepSignature, s.firmId],
  );
  const after = await getEqReview(tx, engagementId);
  const shape = (r: EqReview) => ({ required: r.required, reviewer: r.reviewer, signedAt: r.signed?.at ?? null });
  await audit(tx, s, "eq_review_set", "engagement", engagementId, { before: shape(before), after: shape(after) });
  return { changed: true };
}

async function namedReviewer(tx: Tx, s: Session, engagementId: string): Promise<EqReview> {
  const who = await openEngagement(tx, s, engagementId);
  const r = await getEqReview(tx, engagementId);
  if (!r.required) throw new Error(EQ_NOT_ON);
  if (r.reviewer?.id !== s.userId || !who.active || !canReview(who.role)) throw new Error(EQ_ONLY_NAMED);
  return r;
}

/**
 * The named reviewer signs, with an optional note. `othersPass` is the caller's answer to "does every other error lock check pass?", asked after the
 * rules above, so the answer is only computed for the person who may sign.
 */
export async function signEqReview(tx: Tx, s: Session, engagementId: string, note: string, othersPass: () => Promise<string | null>): Promise<void> {
  const r = await namedReviewer(tx, s, engagementId);
  if (r.reviewerOnTeam) throw new Error(EQ_ON_TEAM);
  if (r.signed) throw new Error("The engagement quality review is already signed.");
  const text = note.trim();
  if (text.length > MAX_EQ_NOTE) throw new Error(EQ_NOTE_TOO_LONG);
  const refusal = await othersPass();
  if (refusal) throw new Error(refusal);
  await tx.query("update engagements set eq_signed_by = $2, eq_signed_at = clock_timestamp(), eq_note = $3 where id = $1 and firm_id = $4", [engagementId, s.userId, text === "" ? null : text, s.firmId]);
  await audit(tx, s, "eq_review_sign", "engagement", engagementId, { note: text === "" ? null : text });
}

export async function withdrawEqReview(tx: Tx, s: Session, engagementId: string): Promise<void> {
  const r = await namedReviewer(tx, s, engagementId);
  if (!r.signed) throw new Error("The engagement quality review is not signed.");
  await tx.query("update engagements set eq_signed_by = null, eq_signed_at = null, eq_note = null where id = $1 and firm_id = $2", [engagementId, s.firmId]);
  await audit(tx, s, "eq_review_withdraw", "engagement", engagementId, { signedAt: r.signed.at });
}

/** Roll-forward carries whether the review is required and who reviews, never the sign-off (firms choose it per client). */
export async function carryEqSetting(tx: Tx, s: { firmId: string }, priorEngagementId: string, engagementId: string): Promise<void> {
  await tx.query(
    `update engagements e set eq_review_required = p.eq_review_required, eq_reviewer_id = p.eq_reviewer_id
     from engagements p where p.id = $1 and p.firm_id = $3 and e.id = $2 and e.firm_id = $3 and p.eq_review_required`,
    [priorEngagementId, engagementId, s.firmId],
  );
}
