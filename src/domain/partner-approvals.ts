/**
 * Partner approval of acceptance and planning (owner decision B1, 2026-11-26). Pure: it reads nothing and changes nothing, so the server, the audit
 * overview, the lock and My work use the same words and the same rule.
 *
 * Fieldwork is not blocked by a missing approval. A warning shows on the overview, and only the final lock requires both, on an audited engagement.
 */

export type ApprovalKind = "acceptance" | "planning";
export const APPROVAL_KINDS: ApprovalKind[] = ["acceptance", "planning"];
export const APPROVAL_LABEL: Record<ApprovalKind, string> = { acceptance: "Acceptance", planning: "Planning" };

export const LOCK_CHECK_LABEL = "The partner has approved acceptance and planning";
export const ASSIGN_PARTNER_FIRST = "Assign a partner first.";
export const ONLY_ENGAGEMENT_PARTNER = "Only the engagement partner can approve or withdraw an approval.";
export const NOT_YET = "Not yet approved by the partner";

/** Why a planning approval no longer counts. */
export type Staleness = "materiality" | "risk" | null;

export interface Approval {
  by: string;
  /** YYYY-MM-DD, UTC. */
  at: string;
  /** Planning only: why it no longer counts. */
  stale: Staleness;
}

export interface Approvals {
  acceptance: Approval | null;
  planning: Approval | null;
}

export function staleWords(a: Approval): string | null {
  if (a.stale === "materiality") return `Materiality revised since planning was approved on ${a.at}`;
  if (a.stale === "risk") return `A risk rating changed since planning was approved on ${a.at}`;
  return null;
}

/** "Approved by NAME on DATE", the stale sentence, or "Not yet approved by the partner". */
export function approvalWords(a: Approval | null): string {
  if (!a) return NOT_YET;
  return staleWords(a) ?? `Approved by ${a.by} on ${a.at}`;
}

export const isCurrent = (a: Approval | null): boolean => !!a && a.stale === null;

/** What is missing, in the lock's words, or null when both approvals count. */
export function missingApprovals(approvals: Approvals): string[] {
  return APPROVAL_KINDS.flatMap((k) => {
    const a = approvals[k];
    if (isCurrent(a)) return [];
    const stale = a ? staleWords(a) : null;
    return [stale ?? `${APPROVAL_LABEL[k].toLowerCase()} is not approved`];
  });
}

/** The lock blocker, worded like the other error checks, or null. */
export function approvalsBlocker(approvals: Approvals): string | null {
  const missing = missingApprovals(approvals);
  return missing.length === 0 ? null : `${LOCK_CHECK_LABEL}: ${missing.join("; ")}.`;
}
