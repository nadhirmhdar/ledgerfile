/**
 * The optional engagement quality review (owner decision B2, 2026-11-26). Pure: it reads nothing and changes nothing, so the server, the Team panel,
 * the lock and My work use the same words and the same rule. Off by default; when on, the file cannot be locked until the named reviewer signs.
 */

export const EQ_LOCK_LABEL = "The engagement quality reviewer has signed";
export const NO_EQ_REVIEWER = "No EQ reviewer chosen";
export const EQ_SET_REFUSAL = "Only a partner or administrator can set the engagement quality review.";
export const EQ_NOT_REVIEWER = "The EQ reviewer must be a reviewer, partner or administrator.";
export const EQ_ON_TEAM = "The EQ reviewer cannot be on the engagement team (preparer, reviewer, partner, or an area's preparer or reviewer).";
export const EQ_ONLY_NAMED = "Only the named EQ reviewer can sign or withdraw.";
export const EQ_NOT_ON = "Engagement quality review is off for this engagement.";
export const EQ_OTHER_CHECKS = "Every other lock check must pass before the EQ reviewer signs.";
export const EQ_NOTE_TOO_LONG = "The note is too long: the most is 2,000 characters.";
export const MAX_EQ_NOTE = 2000;

export interface EqReview {
  required: boolean;
  reviewer: { id: string; name: string } | null;
  /** The reviewer is now somebody on the engagement team: the lock fails with that reason, and nothing is cleared silently. */
  reviewerOnTeam: boolean;
  signed: { by: string; at: string; note: string | null } | null;
}

/** "Engagement quality review: off", or "on, reviewer NAME, signed DATE / not yet signed". */
export function eqSummary(r: EqReview): string {
  if (!r.required) return "Engagement quality review: off";
  const who = r.reviewer ? `reviewer ${r.reviewer.name}` : "no reviewer chosen";
  return `Engagement quality review: on, ${who}, ${r.signed ? `signed ${r.signed.at}` : "not yet signed"}`;
}

/** The lock blocker, worded like the other error checks, or null (always null while off). */
export function eqBlocker(r: EqReview): string | null {
  if (!r.required) return null;
  if (!r.reviewer) return `${EQ_LOCK_LABEL}: ${NO_EQ_REVIEWER}.`;
  if (r.reviewerOnTeam) return `${EQ_LOCK_LABEL}: ${r.reviewer.name} is now on the engagement team, so cannot be its EQ reviewer.`;
  return r.signed ? null : `${EQ_LOCK_LABEL}: ${r.reviewer.name} has not signed.`;
}
