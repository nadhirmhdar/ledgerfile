import type { Status } from "./status";
import { count } from "./text";

/** How the lead sheets page shows each sheet's sign-off, read-only. The forms to sign are on the review page. Pure. */

export interface SignOffState {
  preparer: unknown | null;
  reviewer: unknown | null;
  openPoints: number;
}

export interface SignBadge {
  status: Status;
  /** The words: the state is never colour alone. */
  label: string;
}

/** "Reviewed" once a reviewer has signed, "Prepared" once only the preparer has, otherwise "Not started". */
export function signBadge(s: Pick<SignOffState, "preparer" | "reviewer">): SignBadge {
  if (s.reviewer) return { status: "reviewed", label: "Reviewed" };
  if (s.preparer) return { status: "needs_review", label: "Prepared" };
  return { status: "not_started", label: "Not started" };
}

/** "1 open point" / "3 open points", or null when there are none. */
export const openPointsLabel = (n: number): string | null => (n > 0 ? count(n, "open point") : null);

/** One summary line for the page: how many sheets are reviewed, prepared, and how many open points there are in all. */
export function signOffSentence(sheets: SignOffState[]): string {
  if (sheets.length === 0) return "";
  const reviewed = sheets.filter((s) => s.reviewer).length;
  const prepared = sheets.filter((s) => s.preparer && !s.reviewer).length;
  const points = sheets.reduce((n, s) => n + s.openPoints, 0);
  const parts = [`${reviewed} of ${count(sheets.length, "lead sheet")} reviewed`, prepared > 0 ? `${prepared} prepared and waiting for review` : ""].filter(Boolean);
  return `${parts.join(", ")}${points > 0 ? `; ${count(points, "open point")}` : ""}.`;
}
