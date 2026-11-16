import { canReview, type Role } from "../domain/signoff";
import type { Tone } from "./status";

/**
 * How one audit procedure is shown: its work and review pills, which of the programme's filters it falls under, and which
 * controls the viewer is offered. Pure; the server still refuses anything the rules do not allow.
 */

export interface ProcedureLike {
  status: "open" | "done" | "na";
  reviewedAt: string | null;
  reviewedByName: string | null;
  selfReviewed: boolean;
  partnerStep: boolean;
}

export type ProcedureShow = "all" | "open" | "waiting" | "done";

/** Completed or not applicable, and a reviewer still has to sign it off. A partner's own sign-off needs no review. */
export const isWaiting = (p: ProcedureLike): boolean => p.status !== "open" && !p.reviewedAt && !p.partnerStep;

export function parseProcedureShow(v: string | string[] | undefined): ProcedureShow {
  const one = Array.isArray(v) ? v[0] : v;
  return one === "open" || one === "waiting" || one === "done" ? one : "all";
}

export interface ProcedureCounts {
  all: number;
  open: number;
  waiting: number;
  done: number;
}

export function countProcedures(rows: ProcedureLike[]): ProcedureCounts {
  const c: ProcedureCounts = { all: rows.length, open: 0, waiting: 0, done: 0 };
  for (const p of rows) {
    if (p.status === "open") c.open++;
    else if (isWaiting(p)) c.waiting++;
    else c.done++;
  }
  return c;
}

/** The procedures a filter leaves, in their own order. */
export function filterProcedures<T extends ProcedureLike>(rows: T[], show: ProcedureShow): { rows: T[]; shown: number; total: number; counts: ProcedureCounts } {
  const kept = rows.filter((p) => show === "all" || (show === "open" ? p.status === "open" : show === "waiting" ? isWaiting(p) : p.status !== "open" && !isWaiting(p)));
  return { rows: kept, shown: kept.length, total: rows.length, counts: countProcedures(rows) };
}

export const procedureResults = (shown: number, total: number, noun: string): string => `Showing ${shown} of ${total} ${noun}.`;

// --- Pills -----------------------------------------------------------------------------------------------------------------

export const WORK_LABEL: Record<ProcedureLike["status"], string> = { open: "Open", done: "Completed", na: "Not applicable" };

export function workPill(p: ProcedureLike): { tone: Tone; label: string } {
  return { tone: p.status === "open" ? "neutral" : p.status === "done" ? "success" : "muted", label: WORK_LABEL[p.status] };
}

/** The review pill; none for an open procedure, which has nothing to review yet. */
export function reviewPill(p: ProcedureLike): { tone: Tone; label: string } | null {
  if (p.status === "open") return null;
  if (p.partnerStep) return { tone: "neutral", label: "Partner sign-off" };
  if (p.reviewedAt) return p.selfReviewed ? { tone: "warning", label: `Self-reviewed by ${p.reviewedByName} on ${p.reviewedAt}` } : { tone: "success", label: `Reviewed by ${p.reviewedByName} on ${p.reviewedAt}` };
  return { tone: "warning", label: "Waiting for review" };
}

// --- Controls --------------------------------------------------------------------------------------------------------------

export interface ControlsInput {
  /** The engagement is open. */
  open: boolean;
  /** The audit is on for the engagement. */
  auditOn: boolean;
  role: Role;
  userId: string;
}

export interface Controls {
  /** The work-done and conclusion fields and their buttons. */
  edit: boolean;
  /** A reviewed procedure cannot be changed until the review is withdrawn. */
  lockedByReview: boolean;
  review: "review" | "withdraw" | null;
  attach: boolean;
  /** Whether this viewer may remove an attached file uploaded by `uploadedBy`. */
  canRemove: (uploadedBy: string) => boolean;
}

export function procedureControls(p: ProcedureLike, c: ControlsInput): Controls {
  const live = c.open && c.auditOn;
  return {
    edit: live && !p.reviewedAt,
    lockedByReview: live && !!p.reviewedAt,
    review: live && canReview(c.role) && p.status !== "open" && !p.partnerStep ? (p.reviewedAt ? "withdraw" : "review") : null,
    attach: live,
    canRemove: (uploadedBy) => live && (uploadedBy === c.userId || canReview(c.role)),
  };
}
