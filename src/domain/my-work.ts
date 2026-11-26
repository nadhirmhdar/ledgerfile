import { daysBetween } from "./archiving";
import { canLock, canReview, type Role } from "./signoff";

/**
 * Who is on an engagement, when its report is due, and what waits for each person. Pure: it reads nothing and changes nothing, so the
 * server, the Team panel and the My work page use the same words and the same dates.
 */

export type Slot = "preparer" | "reviewer" | "partner";
export const SLOTS: Slot[] = ["preparer", "reviewer", "partner"];
export const SLOT_LABEL: Record<Slot, string> = { preparer: "Preparer", reviewer: "Reviewer", partner: "Partner" };

export const NOT_ASSIGNED = "Not assigned";
export const NO_DATE = "No date";

/** The words the app already uses when a reviewer is also the person who did the work (domain: assertMayReview). */
export const SELF_REVIEW_REFUSAL = "The reviewer must be a different person from the one who did the work.";
export const ASSIGN_REFUSAL = "Only a partner can assign the team.";
export const LOCKED_REFUSAL = "This engagement is locked.";
export const PERSON_REFUSAL = "Choose a person from your firm's active team.";
export const DATE_REFUSAL = "Enter the report due date as a real date.";

/** Who can fill each place: the reviewer needs reviewer rights, the partner needs partner rights. A preparer can be anyone. */
export function slotBlocker(slot: Slot, role: Role): string | null {
  if (slot === "reviewer" && !canReview(role)) return "The reviewer must be a reviewer, partner or administrator.";
  if (slot === "partner" && !canLock(role)) return "The partner must be a partner or administrator.";
  return null;
}

/** A calendar date as YYYY-MM-DD, and a real one (not 31 February). */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    daysBetween(value, value);
    return true;
  } catch {
    return false;
  }
}

/** How far ahead My work looks for a report that is coming due. */
export const DUE_WINDOW_DAYS = 30;

export type DueState =
  | { kind: "none" }
  /** Beyond the window: known, but not shown on My work. */
  | { kind: "later"; days: number }
  /** Due today or within the window. */
  | { kind: "soon"; days: number }
  | { kind: "overdue"; days: number };

export function reportDueState(dueOn: string | null, today: string): DueState {
  if (!dueOn) return { kind: "none" };
  const days = daysBetween(today, dueOn);
  if (days < 0) return { kind: "overdue", days: -days };
  return days <= DUE_WINDOW_DAYS ? { kind: "soon", days } : { kind: "later", days };
}

/** Whether My work lists it: within the window, or past. */
export const isShownDue = (s: DueState): boolean => s.kind === "soon" || s.kind === "overdue";

const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** "Overdue by 3 days", "Due today", "Due in 12 days", "No date". Words first: the tone never carries the meaning alone. */
export function dueWords(s: DueState): string {
  switch (s.kind) {
    case "none":
      return NO_DATE;
    case "overdue":
      return `Overdue by ${plural(s.days)}`;
    case "soon":
      return s.days === 0 ? "Due today" : `Due in ${plural(s.days)}`;
    case "later":
      return `Due in ${plural(s.days)}`;
  }
}

// --- My work ----------------------------------------------------------------------------------------------------------------

export type LineKind = "prepare" | "review" | "yours" | "due" | "confirm";

/** Which part of the brief the line belongs to, as the short label shown beside it. */
export const LINE_KIND_LABEL: Record<LineKind, string> = { prepare: "To prepare", review: "To review", yours: "Your review point", due: "Report due", confirm: "To confirm" };

export interface WorkLine {
  key: string;
  kind: LineKind;
  /** What waits, in words with its count: "3 procedures still open". */
  label: string;
  count: number;
  /** The existing page where the work is done. */
  href: string;
}

export interface WorkGroup {
  engagementId: string;
  clientName: string;
  periodEnd: string;
  reportDueOn: string | null;
  due: DueState;
  /** The places the person holds on this engagement, in words: "Preparer", "Reviewer, Partner". Empty for a group that is there only for a review point they raised. */
  roles: string[];
  lines: WorkLine[];
}

export const groupTotal = (g: WorkGroup): number => g.lines.reduce((n, l) => n + l.count, 0);

/** Earliest report date first (past dates on top), engagements with no date last, then by client name, then by period end (latest first). */
export function sortGroups(groups: WorkGroup[]): WorkGroup[] {
  return [...groups].sort((a, b) => {
    const da = a.reportDueOn ?? "9999-12-31";
    const db = b.reportDueOn ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    const byName = a.clientName.localeCompare(b.clientName);
    if (byName !== 0) return byName;
    return a.periodEnd < b.periodEnd ? 1 : a.periodEnd > b.periodEnd ? -1 : 0;
  });
}

export interface SlotOption {
  id: string;
  name: string;
  role: Role;
  /** The saved person no longer holds the rights this place needs (their role changed). Kept so the partner sees why. */
  stale: boolean;
}

/** The people a select for this place offers: only those the server would accept, plus the saved person even when they no longer qualify. */
export function slotOptions(slot: Slot, people: { id: string; name: string; role: Role }[], selectedId: string | null): SlotOption[] {
  return people.flatMap((p) => {
    const ok = slotBlocker(slot, p.role) === null;
    return ok || p.id === selectedId ? [{ ...p, stale: !ok }] : [];
  });
}
