/**
 * Who may do what in the review process.
 *
 * Roles rank preparer < reviewer < partner. The firm administrator is treated as
 * partner-level, because in a small firm the person who registers the firm is usually
 * its owner. This is a product decision that can be tightened per firm later.
 */
export type Role = "admin" | "partner" | "reviewer" | "preparer";
export type Level = "preparer" | "reviewer";

const RANK: Record<Role, number> = { preparer: 1, reviewer: 2, partner: 3, admin: 3 };

export const canReview = (role: Role) => RANK[role] >= 2;
export const canLock = (role: Role) => RANK[role] >= 3;

export interface SignOffState {
  /** User who signed as preparer, if anyone. */
  preparerId: string | null;
  reviewerId: string | null;
  openPoints: number;
  /** True when the firm has exactly one user, who must then be able to review their own work. */
  solePractitioner?: boolean;
}

/** Why this user cannot sign this lead sheet at this level; null when they can. */
export function signOffBlocker(level: Level, user: { id: string; role: Role }, state: SignOffState): string | null {
  if (level === "preparer") {
    if (state.preparerId) return "This lead sheet is already signed as prepared.";
    return null;
  }
  if (!canReview(user.role)) return "Only a reviewer or partner can sign as reviewer.";
  if (state.reviewerId) return "This lead sheet is already signed as reviewed.";
  if (!state.preparerId) return "The lead sheet must be signed as prepared before it is reviewed.";
  // Two people are required wherever the firm has two people. A sole practitioner has nobody else.
  if (state.preparerId === user.id && !state.solePractitioner) return "The reviewer must be a different person from the preparer.";
  if (state.openPoints > 0) return `Clear the ${state.openPoints} open review point(s) on this lead sheet first.`;
  return null;
}

export interface LockReadiness {
  ready: boolean;
  blockers: string[];
}

/** What still stands between an engagement and partner lock. */
export function lockReadiness(input: {
  statementsClean: boolean;
  failedChecks: string[];
  leadSheets: { name: string; prepared: boolean; reviewed: boolean }[];
  openPoints: number;
}): LockReadiness {
  const blockers: string[] = [];
  if (input.leadSheets.length === 0) blockers.push("No trial balance has been imported.");
  if (!input.statementsClean) blockers.push(...input.failedChecks.map((c) => `Statement check failed: ${c}.`));
  const unprepared = input.leadSheets.filter((l) => !l.prepared).length;
  const unreviewed = input.leadSheets.filter((l) => !l.reviewed).length;
  if (unprepared > 0) blockers.push(`${unprepared} lead sheet(s) are not signed as prepared.`);
  if (unreviewed > 0) blockers.push(`${unreviewed} lead sheet(s) are not signed as reviewed.`);
  if (input.openPoints > 0) blockers.push(`${input.openPoints} review point(s) are still open.`);
  return { ready: blockers.length === 0, blockers };
}
