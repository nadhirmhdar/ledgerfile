import { canLock, canReview, signOffBlocker, type Role } from "../domain/signoff";
import type { Tone } from "./status";
import { count } from "./text";

/**
 * What the review and sign-off page offers each person: the readiness state, who can lock or unlock, and what each cell of the
 * lead sheet table shows. Pure; the server still enforces every rule.
 */

export type Readiness = "locked" | "ready" | "not_ready";

export interface ReadinessInput {
  /** The engagement is open. */
  open: boolean;
  ready: boolean;
  blockers: number;
  role: Role;
  lockedByName?: string | null;
  lockedAt?: string | null;
}

export interface ReadinessView {
  state: Readiness;
  /** The one sentence under the page title. */
  sentence: string;
  /** Lock needs a partner: they get the button, others a waiting pill. Nothing once locked or while not ready. */
  lock: "lock" | "waiting" | "none";
  canUnlock: boolean;
}

export function readinessView(i: ReadinessInput): ReadinessView {
  if (!i.open) {
    return {
      state: "locked",
      sentence: `Locked${i.lockedAt ? ` on ${i.lockedAt}` : ""}${i.lockedByName ? ` by ${i.lockedByName}` : ""}.`,
      lock: "none",
      canUnlock: canLock(i.role),
    };
  }
  if (i.ready) return { state: "ready", sentence: "Ready to lock.", lock: canLock(i.role) ? "lock" : "waiting", canUnlock: false };
  return { state: "not_ready", sentence: `${count(i.blockers, "thing")} still open before the file can be locked.`, lock: "none", canUnlock: false };
}

// --- The lead sheet table -----------------------------------------------------------------------------------------------

export type Level = "preparer" | "reviewer";

export type SignCell =
  | { kind: "signed"; name: string; at: string; canWithdraw: boolean }
  | { kind: "sign"; label: string }
  | { kind: "waiting"; label: string }
  | { kind: "blocked"; label: string }
  | { kind: "none"; label: string };

type Signature = { userId: string; name: string; at: string } | null;

/**
 * What one cell of the table shows. A sign button appears only when the rules would accept the click: the domain's own
 * signOffBlocker decides that, and when it refuses, the cell says why in a pill instead.
 */
export function signCell(c: {
  level: Level;
  preparer: Signature;
  reviewer: Signature;
  openPoints: number;
  solePractitioner: boolean;
  open: boolean;
  role: Role;
  userId: string;
}): SignCell {
  const signed = c.level === "preparer" ? c.preparer : c.reviewer;
  if (signed) return { kind: "signed", name: signed.name, at: signed.at, canWithdraw: c.open && signed.userId === c.userId };
  if (!c.open) return { kind: "none", label: "Not signed" };
  if (c.level === "reviewer" && !canReview(c.role)) return { kind: "waiting", label: "Waiting for a reviewer" };

  const blocker = signOffBlocker(c.level, { id: c.userId, role: c.role }, { preparerId: c.preparer?.userId ?? null, reviewerId: c.reviewer?.userId ?? null, openPoints: c.openPoints, solePractitioner: c.solePractitioner });
  if (blocker === null) return { kind: "sign", label: c.level === "preparer" ? "Sign as prepared" : "Sign as reviewed" };
  if (!c.preparer) return { kind: "waiting", label: "Waiting for preparation" };
  if (c.preparer.userId === c.userId && !c.solePractitioner) return { kind: "waiting", label: "Needs another reviewer" };
  if (c.openPoints > 0) return { kind: "blocked", label: `Clear ${count(c.openPoints, "open point")} first` };
  return { kind: "none", label: "Not signed" };
}

/** How many lead sheets are prepared and reviewed, for the summary above the table. */
export function signOffProgress(sheets: { preparer: unknown | null; reviewer: unknown | null }[]): { total: number; prepared: number; reviewed: number; text: string } {
  const total = sheets.length;
  const prepared = sheets.filter((s) => s.preparer).length;
  const reviewed = sheets.filter((s) => s.reviewer).length;
  return { total, prepared, reviewed, text: `${prepared} of ${total} prepared, ${reviewed} of ${total} reviewed.` };
}

/** Open review points on a lead sheet: a warning pill when there are some, nothing to show (the page says "None") when not. */
export const openPointsPill = (n: number): { tone: Tone; label: string } | null => (n > 0 ? { tone: "warning", label: `${n} open` } : null);

// --- Review points -------------------------------------------------------------------------------------------------------

/** Anyone can reply to an open point while the engagement is open; clearing one is for a reviewer or partner. */
export function pointControls(c: { open: boolean; role: Role }): { respond: boolean; clear: boolean; raise: boolean } {
  return { respond: c.open, clear: c.open && canReview(c.role), raise: c.open && canReview(c.role) };
}
