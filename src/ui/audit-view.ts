import { RISK_LEVELS, type RiskLevel } from "../domain/audit";
import { canLock, canReview, type Role } from "../domain/signoff";
import type { Tone } from "./status";
import { count } from "./text";

/**
 * How the audit planning page is read: what each area's risk and programme look like, what the planning steps are and who they
 * are waiting on, and how a checklist is summarised. Pure, from the overview the page has already loaded.
 */

export type Who = "reviewer" | "partner";

/** Can this role do work that belongs to a reviewer or a partner? */
export const mayDo = (role: Role, who: Who): boolean => (who === "partner" ? canLock(role) : canReview(role));

/** "Waiting for a reviewer" or "Waiting for a partner", for work a person cannot do. */
export const waitingFor = (who: Who): string => `Waiting for a ${who}`;

// --- Risk ------------------------------------------------------------------------------------------------------------------

const LEVEL_ORDER: RiskLevel[] = RISK_LEVELS.map((l) => l.code);
const LEVEL_LABEL = new Map(RISK_LEVELS.map((l) => [l.code, l.label]));

export interface RiskInput {
  assessed: boolean;
  fixedRisk?: RiskLevel;
  /** The rating given to each assertion. */
  risks: Partial<Record<string, RiskLevel>>;
}

export interface RiskSummary {
  kind: "fixed" | "not_assessed" | "assessed";
  tone: Tone;
  label: string;
  /** The highest rating given, for an assessed area. */
  highest: RiskLevel | null;
}

/** The highest rating among those given; null when none. */
export function highestRisk(risks: Partial<Record<string, RiskLevel>>): RiskLevel | null {
  let best = -1;
  for (const level of Object.values(risks)) if (level) best = Math.max(best, LEVEL_ORDER.indexOf(level));
  return best < 0 ? null : LEVEL_ORDER[best];
}

export function riskSummary(a: RiskInput): RiskSummary {
  if (a.fixedRisk) return { kind: "fixed", tone: "warning", label: "Significant risk on every audit", highest: a.fixedRisk };
  if (!a.assessed) return { kind: "not_assessed", tone: "neutral", label: "Not assessed", highest: null };
  const highest = highestRisk(a.risks);
  const high = highest === "high" || highest === "significant";
  return { kind: "assessed", tone: high ? "warning" : "success", label: `Assessed: highest ${highest ? LEVEL_LABEL.get(highest)!.toLowerCase() : "not given"}`, highest };
}

// --- Programme progress -----------------------------------------------------------------------------------------------------

export interface ProgressInput {
  procedures: number;
  completed: number;
  unreviewed: number;
  schedules: number;
  schedulesToFinish: number;
}

export function programmeProgress(a: ProgressInput): { loaded: boolean; done: number; total: number; label: string; toReview: string | null; toFinish: string | null } {
  const loaded = a.procedures > 0;
  return {
    loaded,
    done: a.completed,
    total: a.procedures,
    label: loaded ? `${a.completed} of ${count(a.procedures, "procedure")} completed` : "Programme not loaded",
    toReview: a.unreviewed > 0 ? `${a.unreviewed} to review` : null,
    toFinish: a.schedulesToFinish > 0 ? `${count(a.schedulesToFinish, "schedule")} to finish` : null,
  };
}

// --- The planning steps -----------------------------------------------------------------------------------------------------

export interface PlanningInput {
  role: Role;
  /** The engagement is open: a locked engagement has no work waiting on anyone. */
  open: boolean;
  materialitySet: boolean;
  materialityStale: boolean;
  areasAssessed: number;
  areasTotal: number;
  approval: "none" | "current" | "lapsed";
  approvalNotReady: string | null;
}

export type StepState = "done" | "todo" | "needs_attention" | "waiting";
export interface PlanningStep {
  key: "materiality" | "risk" | "approval";
  title: string;
  state: StepState;
  /** The words for the step's pill. */
  label: string;
  detail: string | null;
  /** Who it belongs to. */
  who: Who;
  /** Set when the person looking cannot do it. */
  waiting: string | null;
  anchor: string;
}

export function planningSteps(i: PlanningInput): PlanningStep[] {
  const wait = (who: Who, state: StepState) => (i.open && state !== "done" && !mayDo(i.role, who) ? waitingFor(who) : null);

  const mState: StepState = !i.materialitySet ? "todo" : i.materialityStale ? "needs_attention" : "done";
  const rState: StepState = i.areasTotal > 0 && i.areasAssessed === i.areasTotal ? "done" : "todo";
  const aState: StepState = i.approval === "current" ? "done" : i.approval === "lapsed" ? "needs_attention" : "todo";

  return [
    {
      key: "materiality",
      title: "Materiality",
      state: mState,
      label: !i.materialitySet ? "Not set" : i.materialityStale ? "Needs revising" : "Set",
      detail: null,
      who: "reviewer",
      waiting: wait("reviewer", mState),
      anchor: "#materiality",
    },
    {
      key: "risk",
      title: "Risk assessed",
      state: rState,
      label: `${i.areasAssessed} of ${i.areasTotal} areas`,
      detail: null,
      who: "reviewer",
      waiting: wait("reviewer", rState),
      anchor: "#areas",
    },
    {
      key: "approval",
      title: "Partner approval",
      state: aState,
      label: i.approval === "current" ? "Approved" : i.approval === "lapsed" ? "Needs approving again" : i.approvalNotReady ? "Not ready" : "Not approved",
      detail: aState === "done" ? null : i.approvalNotReady,
      who: "partner",
      // Nothing waits on a partner until the assessment is ready for approval.
      waiting: i.approvalNotReady ? null : wait("partner", aState),
      anchor: "#approval",
    },
  ];
}

/** The tone of a step's pill. */
export const stepTone = (s: PlanningStep): Tone => (s.state === "done" ? "success" : s.state === "needs_attention" ? "warning" : "neutral");

/** One sentence for the top of the page. */
export function planningSentence(i: { enabled: boolean; materialitySet: boolean; materialityStale: boolean; areasAssessed: number; areasTotal: number; approval: "none" | "current" | "lapsed" }): string {
  if (!i.enabled) return "The audit is off for this engagement.";
  const parts = [
    !i.materialitySet ? "Materiality not set." : i.materialityStale ? "Materiality needs revising." : "Materiality set.",
    `Risk assessed in ${i.areasAssessed} of ${i.areasTotal} areas.`,
    i.approval === "current" ? "Approved by a partner." : i.approval === "lapsed" ? "Approval needs renewing." : "Not yet approved by a partner.",
  ];
  return parts.join(" ");
}

// --- Partner approval ------------------------------------------------------------------------------------------------------

export interface ApprovalView {
  tone: Tone;
  label: string;
  /** What the viewer can do: approve it, wait for a partner, or nothing. */
  action: "approve" | "waiting" | "none";
  note: string | null;
}

export function approvalView(a: { state: "none" | "current" | "lapsed"; notReady: string | null; open: boolean; role: Role }): ApprovalView {
  const label = a.state === "current" ? "Approved" : a.state === "lapsed" ? "Needs approving again" : a.notReady ? "Not ready" : "Not approved";
  const tone: Tone = a.state === "current" ? "success" : a.state === "lapsed" ? "warning" : "neutral";
  if (a.state === "current" || !a.open) return { tone, label, action: "none", note: null };
  if (a.notReady) return { tone, label, action: "none", note: a.notReady };
  return { tone, label, action: canLock(a.role) ? "approve" : "waiting", note: null };
}

// --- Checklists ------------------------------------------------------------------------------------------------------------

export function checklistPill(c: { steps: number; completed: number; unreviewed: number }): { tone: Tone; label: string } | null {
  if (c.unreviewed > 0) return { tone: "warning", label: `${c.unreviewed} to review` };
  if (c.steps > 0 && c.completed === c.steps) return { tone: "success", label: "Done" };
  return null;
}
