import { formatAmount } from "../domain/money";
import { canReview, type Role } from "../domain/signoff";
import type { Tone } from "./status";
import { count } from "./text";

/** How the test schedule page words its facts and decides which sign-off controls show. Pure: the figures come from the domain helpers. */

export interface ScheduleFacts {
  lineCount: number;
  totalMinor: number;
  /** Share of the listing tested, or null when there is no listing total. */
  testedPct: number | null;
  /** Listing against the balance; null when the schedule has no balance to agree to. */
  differenceMinor: number | null;
  explained: boolean;
  reviewedByName: string | null;
  selfReviewed: boolean;
}

/** "5 lines totalling 962,200.25; 87.3% tested. Differs from the balance by 1,250.00 (explained). Not yet reviewed." */
export function scheduleSentence(f: ScheduleFacts): string {
  const review = f.reviewedByName ? (f.selfReviewed ? "Self-reviewed." : "Reviewed.") : "Not yet reviewed.";
  if (f.lineCount === 0) return `No lines yet. ${review}`;
  const tested = f.testedPct === null ? "" : `; ${f.testedPct.toFixed(1)}% tested`;
  const parts = [`${count(f.lineCount, "line")} totalling ${formatAmount(f.totalMinor)}${tested}.`];
  if (f.differenceMinor !== null) {
    parts.push(f.differenceMinor === 0 ? "Agrees to the balance." : `Differs from the balance by ${formatAmount(f.differenceMinor)} (${f.explained ? "explained" : "not explained"}).`);
  }
  parts.push(review);
  return parts.join(" ");
}

export interface ReviewBadge {
  tone: Tone;
  label: string;
}

/** The reviewed-by state as a badge: reviewed (success), self-reviewed (warning) or not yet reviewed (neutral). The words carry it. */
export function reviewBadge(s: { reviewedByName: string | null; reviewedAt: string | null; selfReviewed: boolean }): ReviewBadge {
  if (!s.reviewedByName) return { tone: "neutral", label: "Not yet reviewed" };
  const on = s.reviewedAt ? ` on ${s.reviewedAt}` : "";
  return s.selfReviewed ? { tone: "warning", label: `Self-reviewed by ${s.reviewedByName}${on}` } : { tone: "success", label: `Reviewed by ${s.reviewedByName}${on}` };
}

/** Why the schedule cannot be changed, in one sentence; null when it can. */
export function readOnlyReason(s: { open: boolean; auditOn: boolean; reviewed: boolean }): string | null {
  if (!s.open) return "This engagement is locked, so this schedule is read-only.";
  if (!s.auditOn) return "The audit is off for this engagement, so this schedule is read-only.";
  if (s.reviewed) return "This schedule has been reviewed, so it cannot be changed. A reviewer withdraws the review first.";
  return null;
}

export interface SignOffControls {
  /** "review" or "withdraw" for a reviewer or partner; null for anyone else. */
  review: "review" | "withdraw" | null;
  delete: boolean;
}

/** What the sign-off section shows. Nothing when the engagement is locked or the audit is off. */
export function signOffControls(s: { role: Role; open: boolean; auditOn: boolean; reviewed: boolean; hasConclusion: boolean }): SignOffControls {
  if (!s.open || !s.auditOn) return { review: null, delete: false };
  const reviewer = canReview(s.role);
  return {
    review: reviewer ? (s.reviewed ? "withdraw" : "review") : null,
    delete: !s.reviewed && (reviewer || !s.hasConclusion),
  };
}

/** "3 unsaved changes" / "1 unsaved change". */
export const unsavedLabel = (n: number): string => `${count(n, "unsaved change")}`;

/** "2 key items not tested: lines at or above 5,000.00 that are not marked tested." with the reviewer's cue. */
export function keyItemsSentence(untested: number, thresholdMinor: number): string {
  return `${count(untested, "key item")} not tested: lines at or above ${formatAmount(thresholdMinor)} that are not marked tested. This does not stop the schedule being reviewed, so the reviewer should look at ${untested === 1 ? "it" : "them"}.`;
}
