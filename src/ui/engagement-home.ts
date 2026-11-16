import { canLock, canReview, type Role } from "../domain/signoff";
import type { Status } from "./status";
import { capitalise, count } from "./text";

/**
 * What the engagement home shows, worked out from reads the app already has: no new queries, and no rules of its own about the
 * audit. The page gathers the reads into a HomeInput; everything below is a pure function of it.
 *
 * The one thing it must get right is who the next step is for. A preparer is never sent to something only a reviewer or partner
 * can do: they are told plainly who the work is waiting on, and given the next thing that is theirs.
 */

export interface HomeInput {
  engagementId: string;
  role: Role;
  /** "open", or anything else for a locked engagement. */
  status: string;
  lockedByName: string | null;
  lockedAt: string | null;
  accounts: { total: number; unmapped: number; toAccept: number };
  audit: {
    enabled: boolean;
    materialitySet: boolean;
    materialityStale: boolean;
    areas: { assessed: boolean; procedures: number; completed: number; unreviewed: number; schedules: number; schedulesToFinish: number }[];
    approval: "none" | "current" | "lapsed";
    /** Why the assessment cannot be approved yet; null when it can be. */
    approvalNotReady: string | null;
  };
  review: {
    leadSheets: { prepared: boolean; reviewed: boolean }[];
    openPoints: number;
    ready: boolean;
    /** The lock blockers, as the review overview words them. */
    blockers: string[];
  };
  papers: { total: number; reviewed: number };
  requests: { total: number; open: number; overdue: number; received: number; notApplicable: number };
  confirmations: { total: number; notSent: number; awaitingReply: number; agreed: number; differs: number; noReply: number; prepared: number; reviewed: number };
}

export interface NextStep {
  /** "action": something for this person to do. "waiting": the work is someone else's. "ready": nothing is left but the lock. */
  kind: "action" | "waiting";
  title: string;
  description: string;
  href: string;
  label: string;
  /** Set when the very next step in the work is someone else's, with who and what. */
  waitingOn: string | null;
}

export type StageKey = "setup" | "plan" | "fieldwork" | "review" | "finish";
export interface Stage {
  key: StageKey;
  title: string;
  status: Status;
  /** Replaces the standard word for the status where a stage can say it more exactly. */
  statusLabel?: string;
  done: number;
  total: number;
  summary: string;
  href: string;
}

export interface ToDo {
  text: string;
  href: string;
  /** Who it is for when only some people can do it. */
  owner: "reviewer" | "partner" | null;
}

export interface Tile {
  key: string;
  label: string;
  value: string;
  hint: string | null;
  href: string;
}

export interface HomeModel {
  locked: boolean;
  empty: boolean;
  /** One sentence under the page title. */
  summary: string;
  nextStep: NextStep | null;
  stages: Stage[];
  toDo: ToDo[];
  /** How many things stand between the file and the lock, of which `toDo` shows the first few. */
  toDoTotal: number;
  tiles: Tile[];
}

export const MAX_TODO = 5;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const paths = (id: string) => {
  const base = `/engagements/${id}`;
  return {
    base,
    trialBalance: `${base}/trial-balance`,
    audit: `${base}/audit`,
    confirmations: `${base}/audit/confirmations`,
    journals: `${base}/audit/journals`,
    analytics: `${base}/audit/analytics`,
    requests: `${base}/requests`,
    statements: `${base}/statements`,
    review: `${base}/review`,
    papers: `${base}/papers`,
    index: `${base}/index`,
  };
};

// --- Lock blockers in plain words -----------------------------------------------------------------------------------------

type Where = keyof ReturnType<typeof paths>;
const RULES: { re: RegExp; where: Where; owner?: "reviewer" | "partner"; say: (m: RegExpMatchArray) => string }[] = [
  { re: /^No trial balance has been imported\.$/, where: "trialBalance", say: () => "Import the trial balance" },
  { re: /^Statement check failed: (.+?)\.?$/, where: "statements", say: (m) => `Fix a failed statement check: ${m[1]}` },
  { re: /^(\d+) lead sheet\(s\) are not signed as prepared\.$/, where: "review", say: (m) => `${count(+m[1], "lead sheet")} to sign as prepared` },
  { re: /^(\d+) lead sheet\(s\) are not signed as reviewed\.$/, where: "review", owner: "reviewer", say: (m) => `${count(+m[1], "lead sheet")} to review` },
  { re: /^(\d+) review point\(s\) are still open\.$/, where: "review", say: (m) => `${count(+m[1], "review point")} to clear` },
  { re: /^Audit: materiality has not been set\.$/, where: "audit", owner: "reviewer", say: () => "Set materiality" },
  { re: /^Audit: the benchmark figure has changed since materiality was set\./, where: "audit", owner: "reviewer", say: () => "Revise or confirm materiality again" },
  { re: /^Audit: risk has not been assessed for (\d+) area\(s\)\.$/, where: "audit", owner: "reviewer", say: (m) => `Assess risk in ${count(+m[1], "area")}` },
  { re: /^Audit: the programme has not been loaded for (\d+) area\(s\)\.$/, where: "audit", owner: "reviewer", say: (m) => `Load the audit programme for ${count(+m[1], "area")}` },
  { re: /^Audit: the partner has not approved the risk assessment\.$/, where: "audit", owner: "partner", say: () => "Get the risk assessment approved by a partner" },
  { re: /^Audit: the risk assessment has changed since the partner approved it\./, where: "audit", owner: "partner", say: () => "Approve the risk assessment again" },
  { re: /^Audit: (\d+) procedure\(s\) and checklist step\(s\) are not yet completed\.$/, where: "audit", say: (m) => `${count(+m[1], "audit procedure or checklist step", "audit procedures or checklist steps")} to complete` },
  { re: /^Audit: (\d+) completed procedure\(s\) and checklist step\(s\) have not been reviewed\.$/, where: "audit", owner: "reviewer", say: (m) => `${count(+m[1], "completed procedure or checklist step", "completed procedures or checklist steps")} to review` },
  { re: /^Audit: (\d+) journal entry\(ies\) selected for testing have no conclusion\.$/, where: "journals", say: (m) => `${count(+m[1], "journal entry", "journal entries")} to conclude on` },
  { re: /^Audit: (\d+) confirmation\(s\) have not been sent\./, where: "confirmations", say: (m) => `${count(+m[1], "confirmation")} to send` },
  { re: /^Audit: (\d+) confirmation\(s\) are awaiting a reply\.$/, where: "confirmations", say: (m) => `${count(+m[1], "confirmation")} waiting for a reply` },
  { re: /^Audit: (\d+) confirmation\(s\) have a reply but are not prepared\.$/, where: "confirmations", say: (m) => `${count(+m[1], "confirmation")} with a reply to prepare` },
  { re: /^Audit: (\d+) confirmation\(s\) have not been reviewed\.$/, where: "confirmations", owner: "reviewer", say: (m) => `${count(+m[1], "confirmation")} to review` },
  { re: /^Audit: (\d+) significant movement\(s\) in the analytical review have no explanation\.$/, where: "analytics", say: (m) => `${count(+m[1], "movement")} to explain in the analytical review` },
  { re: /^Audit: (\d+) test schedule\(s\) have no conclusion\.$/, where: "audit", say: (m) => `${count(+m[1], "test schedule")} to conclude on` },
  { re: /^Audit: (\d+) test schedule\(s\) have not been reviewed\.$/, where: "audit", owner: "reviewer", say: (m) => `${count(+m[1], "test schedule")} to review` },
  { re: /^Audit: (\d+) test schedule\(s\) do not agree to the balance/, where: "audit", say: (m) => `${count(+m[1], "test schedule")} with a difference to explain` },
  { re: /^Audit: uncorrected misstatements reach overall materiality\./, where: "audit", say: () => "Have the uncorrected misstatements corrected" },
];

/** Put one lock blocker into plain words and say where it is dealt with. A blocker it does not know is shown as written, tidied, and sent to Review and sign-off. */
export function explainBlocker(blocker: string, engagementId: string): ToDo {
  const p = paths(engagementId);
  for (const r of RULES) {
    const m = blocker.match(r.re);
    if (m) return { text: r.say(m), href: p[r.where], owner: r.owner ?? null };
  }
  const tidy = blocker.replace(/^Audit: /, "").replace(/y\(ies\)/g, "ies").replace(/\(s\)/g, "s");
  return { text: capitalise(tidy), href: p.review, owner: null };
}

// --- The next step ----------------------------------------------------------------------------------------------------------

type Who = "any" | "reviewer" | "partner";
interface Action {
  who: Who;
  title: string;
  description: string;
  href: string;
  label: string;
  /** What to say when the action is someone else's. */
  waiting: string;
}

const canDo = (role: Role, who: Who) => who === "any" || (who === "reviewer" && canReview(role)) || (who === "partner" && canLock(role));
const whoIs = (who: Who) => (who === "partner" ? "a partner" : "a reviewer");

/** What is still to be done, in the order the work goes. */
function pendingActions(i: HomeInput): Action[] {
  const p = paths(i.engagementId);
  const out: Action[] = [];
  const a = i.audit;
  const c = i.confirmations;

  if (i.accounts.total === 0) {
    out.push({ who: "any", title: "Import the trial balance", description: "Everything else is built from the client's trial balance, so start there.", href: p.trialBalance, label: "Import the trial balance", waiting: "" });
    return out;
  }
  if (i.accounts.unmapped > 0)
    out.push({ who: "any", title: `Map ${count(i.accounts.unmapped, "account")}`, description: "Each account needs a lead sheet group before the lead sheets and statements are right.", href: p.trialBalance, label: "Map the accounts", waiting: "" });
  if (i.accounts.toAccept > 0)
    out.push({ who: "any", title: `Check ${count(i.accounts.toAccept, "suggested mapping")}`, description: "Suggested mappings are only suggestions until someone accepts them.", href: p.trialBalance, label: "Check the suggestions", waiting: "" });

  if (a.enabled) {
    const unassessed = a.areas.filter((x) => !x.assessed).length;
    if (!a.materialitySet || a.materialityStale)
      out.push({ who: "reviewer", title: a.materialitySet ? "Revise materiality" : "Set materiality", description: "Materiality sets how much a misstatement can matter, and the planning builds on it.", href: p.audit, label: "Go to planning", waiting: `Waiting for ${whoIs("reviewer")} to ${a.materialitySet ? "revise" : "set"} materiality.` });
    if (unassessed > 0)
      out.push({ who: "reviewer", title: `Assess risk in ${count(unassessed, "area")}`, description: "Rate the risk for each area so the right audit procedures are loaded.", href: p.audit, label: "Assess the risks", waiting: `Waiting for ${whoIs("reviewer")} to assess risk in ${count(unassessed, "area")}.` });
    if (a.approval !== "current" && a.approvalNotReady === null)
      out.push({ who: "partner", title: a.approval === "lapsed" ? "Approve the risk assessment again" : "Approve the risk assessment", description: "A partner approves the planning before fieldwork is relied on.", href: p.audit, label: "Review and approve", waiting: `Waiting for ${whoIs("partner")} to approve the risk assessment.` });
    const procLeft = sum(a.areas.map((x) => x.procedures - x.completed));
    if (procLeft > 0) out.push({ who: "any", title: `Complete ${count(procLeft, "audit procedure")}`, description: "Work through the procedures area by area and record what was done.", href: p.audit, label: "Open the audit", waiting: "" });
    const schedLeft = sum(a.areas.map((x) => x.schedulesToFinish));
    if (schedLeft > 0) out.push({ who: "any", title: `Finish ${count(schedLeft, "test schedule")}`, description: "Each schedule needs a conclusion, and any difference explained.", href: p.audit, label: "Open the audit", waiting: "" });
    if (c.notSent > 0) out.push({ who: "any", title: `Send ${count(c.notSent, "confirmation")}`, description: "Record when each request went out so replies can be chased.", href: p.confirmations, label: "Open confirmations", waiting: "" });
    const toPrepare = c.agreed + c.differs + c.noReply - c.prepared - c.reviewed;
    if (toPrepare > 0) out.push({ who: "any", title: `Prepare ${count(toPrepare, "confirmation")} that ${toPrepare === 1 ? "has" : "have"} a reply`, description: "Record how any difference was settled, then mark each one prepared.", href: p.confirmations, label: "Open confirmations", waiting: "" });
  }
  if (i.requests.open > 0) out.push({ who: "any", title: `Follow up ${count(i.requests.open, "open client request")}`, description: i.requests.overdue > 0 ? `${i.requests.overdue} of them ${i.requests.overdue === 1 ? "is" : "are"} overdue.` : "Chase what the client has not sent yet.", href: p.requests, label: "Open client requests", waiting: "" });

  const unprepared = i.review.leadSheets.filter((l) => !l.prepared).length;
  if (unprepared > 0) out.push({ who: "any", title: `Sign ${count(unprepared, "lead sheet")} as prepared`, description: "Sign a lead sheet once its accounts are mapped and the figures are checked.", href: p.review, label: "Go to sign-off", waiting: "" });
  if (i.review.openPoints > 0) out.push({ who: "reviewer", title: `Clear ${count(i.review.openPoints, "review point")}`, description: "Open review points stop the lead sheets being signed as reviewed.", href: p.review, label: "Go to review", waiting: `Waiting for ${whoIs("reviewer")} to clear ${count(i.review.openPoints, "review point")}.` });
  const toReview = i.review.leadSheets.filter((l) => l.prepared && !l.reviewed).length;
  if (toReview > 0) out.push({ who: "reviewer", title: `Review ${count(toReview, "lead sheet")}`, description: "A reviewer, who did not prepare them, signs each lead sheet as reviewed.", href: p.review, label: "Go to sign-off", waiting: `Waiting for ${whoIs("reviewer")} to review ${count(toReview, "lead sheet")}.` });
  if (a.enabled) {
    const unreviewed = sum(a.areas.map((x) => x.unreviewed));
    if (unreviewed > 0) out.push({ who: "reviewer", title: `Review ${count(unreviewed, "completed procedure")}`, description: "Completed procedures need a reviewer's sign-off.", href: p.audit, label: "Open the audit", waiting: `Waiting for ${whoIs("reviewer")} to review ${count(unreviewed, "completed procedure")}.` });
    if (c.prepared > 0) out.push({ who: "reviewer", title: `Review ${count(c.prepared, "prepared confirmation")}`, description: "A reviewer signs each prepared confirmation off.", href: p.confirmations, label: "Open confirmations", waiting: `Waiting for ${whoIs("reviewer")} to review ${count(c.prepared, "confirmation")}.` });
  }
  if (i.review.ready) out.push({ who: "partner", title: "Lock the engagement", description: "Everything is prepared and reviewed. A partner locks the file.", href: p.review, label: "Go to sign-off", waiting: `Waiting for ${whoIs("partner")} to lock the engagement.` });
  return out;
}

export function nextStepFor(i: HomeInput): NextStep | null {
  if (i.status !== "open") return null;
  const pending = pendingActions(i);
  const p = paths(i.engagementId);
  if (pending.length === 0) {
    // Nothing the home can name, yet the file is not ready: send them to the first blocker, in plain words.
    if (i.review.blockers.length > 0) {
      const t = explainBlocker(i.review.blockers[0], i.engagementId);
      return { kind: "action", title: t.text, description: "This is the first thing between the file and the lock.", href: t.href, label: "Go there", waitingOn: null };
    }
    return null;
  }
  const first = pending[0];
  const own = pending.find((x) => canDo(i.role, x.who));
  if (!own) {
    return { kind: "waiting", title: "Nothing is waiting for you", description: first.waiting, href: p.review, label: "See what is outstanding", waitingOn: first.waiting };
  }
  return { kind: "action", title: own.title, description: own.description, href: own.href, label: own.label, waitingOn: own === first ? null : first.waiting || null };
}

// --- The stages -------------------------------------------------------------------------------------------------------------

function stageStatus(done: number, total: number): Status {
  if (total === 0) return "not_started";
  if (done >= total) return "done";
  return done > 0 ? "in_progress" : "not_started";
}

export function stagesFor(i: HomeInput): Stage[] {
  const p = paths(i.engagementId);
  const a = i.audit;
  const locked = i.status !== "open";
  const accounts = i.accounts;

  // Set up: imported, mapped, accepted.
  const imported = accounts.total > 0;
  const setupDone = (imported ? 1 : 0) + (imported && accounts.unmapped === 0 ? 1 : 0) + (imported && accounts.toAccept === 0 && accounts.unmapped === 0 ? 1 : 0);
  const setup: Stage = {
    key: "setup",
    title: "Set up",
    status: stageStatus(setupDone, 3),
    done: setupDone,
    total: 3,
    summary: !imported
      ? "No trial balance yet. Import it to begin."
      : setupDone === 3
        ? `${count(accounts.total, "account")} imported, mapped and checked.`
        : [accounts.unmapped > 0 && `${accounts.unmapped} not mapped`, accounts.toAccept > 0 && `${count(accounts.toAccept, "suggested mapping")} to check`].filter(Boolean).join(", ") + ".",
    href: p.trialBalance,
  };

  // Plan: the audit's planning steps. Not being audited is not a problem and blocks nothing.
  let plan: Stage;
  if (!a.enabled) {
    plan = { key: "plan", title: "Plan", status: "not_applicable", statusLabel: "Not being audited", done: 0, total: 0, summary: "The audit is turned off for this engagement, so there is no planning to do.", href: p.audit };
  } else {
    const assessed = a.areas.length > 0 && a.areas.every((x) => x.assessed);
    const planDone = 1 + (a.materialitySet && !a.materialityStale ? 1 : 0) + (assessed ? 1 : 0) + (a.approval === "current" ? 1 : 0);
    const missing = [!a.materialitySet ? "materiality not set" : a.materialityStale ? "materiality needs revising" : null, !assessed ? `risk assessed in ${a.areas.filter((x) => x.assessed).length} of ${a.areas.length} areas` : null, a.approval !== "current" ? (a.approval === "lapsed" ? "approval needs renewing" : "not approved by a partner") : null].filter(Boolean) as string[];
    plan = { key: "plan", title: "Plan", status: stageStatus(planDone, 4), done: planDone, total: 4, summary: missing.length === 0 ? "Materiality set, risks assessed and approved." : `${capitalise(missing.join(", "))}.`, href: p.audit };
  }

  // Fieldwork: procedures, schedules, confirmations, client requests. The audit-only parts are left out when the audit is off.
  const parts: { done: number; total: number }[] = [];
  if (a.enabled) {
    parts.push({ done: sum(a.areas.map((x) => x.completed)), total: sum(a.areas.map((x) => x.procedures)) });
    parts.push({ done: sum(a.areas.map((x) => x.schedules - x.schedulesToFinish)), total: sum(a.areas.map((x) => x.schedules)) });
    parts.push({ done: i.confirmations.agreed + i.confirmations.differs + i.confirmations.noReply, total: i.confirmations.total });
  }
  parts.push({ done: i.requests.received + i.requests.notApplicable, total: i.requests.total });
  const fwDone = sum(parts.map((x) => x.done));
  const fwTotal = sum(parts.map((x) => x.total));
  const bits: string[] = [];
  if (a.enabled) {
    const proc = parts[0];
    if (proc.total > 0) bits.push(`${proc.done} of ${count(proc.total, "procedure")} done`);
    if (i.confirmations.total > 0) bits.push(`${i.confirmations.agreed + i.confirmations.differs + i.confirmations.noReply} of ${count(i.confirmations.total, "confirmation")} answered`);
  }
  if (i.requests.total > 0) bits.push(`${i.requests.received + i.requests.notApplicable} of ${count(i.requests.total, "client request")} received`);
  const fieldwork: Stage =
    fwTotal === 0 && !a.enabled
      ? { key: "fieldwork", title: "Fieldwork", status: "not_applicable", statusLabel: "Not being audited", done: 0, total: 0, summary: "No client requests yet, and the audit is off.", href: p.requests }
      : { key: "fieldwork", title: "Fieldwork", status: stageStatus(fwDone, fwTotal), done: fwDone, total: fwTotal, summary: bits.length > 0 ? `${bits.join(", ")}.` : "No procedures, confirmations or client requests recorded yet.", href: a.enabled ? p.audit : p.requests };

  // Review: lead sheets prepared and reviewed, procedures reviewed, review points cleared.
  const sheets = i.review.leadSheets;
  const sheetsPrepared = sheets.filter((l) => l.prepared).length;
  const sheetsReviewed = sheets.filter((l) => l.reviewed).length;
  const procCompleted = a.enabled ? sum(a.areas.map((x) => x.completed)) : 0;
  const procReviewed = a.enabled ? procCompleted - sum(a.areas.map((x) => x.unreviewed)) : 0;
  const rvTotal = sheets.length * 2 + procCompleted;
  const rvDone = sheetsPrepared + sheetsReviewed + procReviewed;
  const rvComplete = rvTotal > 0 && rvDone >= rvTotal && i.review.openPoints === 0;
  const rvStatus: Status = rvComplete ? "done" : rvTotal === 0 ? "not_started" : sheets.length > 0 && sheetsPrepared === sheets.length && rvDone > 0 ? "needs_review" : rvDone > 0 ? "in_progress" : "not_started";
  const review: Stage = {
    key: "review",
    title: "Review",
    status: rvStatus,
    done: rvDone,
    total: rvTotal,
    summary:
      sheets.length === 0
        ? "Lead sheets appear here once the trial balance is mapped."
        : `${sheetsPrepared} of ${count(sheets.length, "lead sheet")} prepared, ${sheetsReviewed} reviewed${i.review.openPoints > 0 ? `, ${count(i.review.openPoints, "review point")} open` : ""}.`,
    href: p.review,
  };

  // Finish: ready to lock, or locked.
  const finish: Stage = locked
    ? { key: "finish", title: "Finish", status: "locked", done: 1, total: 1, summary: `Locked${i.lockedAt ? ` on ${i.lockedAt}` : ""}${i.lockedByName ? ` by ${i.lockedByName}` : ""}.`, href: p.review }
    : i.review.ready
      ? { key: "finish", title: "Finish", status: "done", statusLabel: "Ready to lock", done: 1, total: 1, summary: "Everything is prepared and reviewed. A partner can lock the file.", href: p.review }
      : { key: "finish", title: "Finish", status: "not_started", done: 0, total: 1, summary: `${count(i.review.blockers.length, "thing")} still open before the file can be locked.`, href: p.review };

  return [setup, plan, fieldwork, review, finish];
}

// --- The whole model --------------------------------------------------------------------------------------------------------

export function buildHomeModel(i: HomeInput): HomeModel {
  const p = paths(i.engagementId);
  const locked = i.status !== "open";
  const empty = i.accounts.total === 0;
  const blockers = i.review.blockers;
  const toDo = locked ? [] : blockers.slice(0, MAX_TODO).map((b) => explainBlocker(b, i.engagementId));

  let summary: string;
  if (locked) summary = `Locked${i.lockedAt ? ` on ${i.lockedAt}` : ""}${i.lockedByName ? ` by ${i.lockedByName}` : ""}. Nothing can be changed until a partner unlocks it.`;
  else if (empty) summary = "Start by importing the trial balance.";
  else if (i.review.ready) summary = "Ready to lock.";
  else summary = `${count(blockers.length, "thing")} still open before the file can be locked.`;

  const tiles: Tile[] = [
    { key: "papers", label: "Papers reviewed", value: `${i.papers.reviewed} of ${i.papers.total}`, hint: i.papers.total === 0 ? "No papers yet" : null, href: p.index },
    { key: "requests", label: "Open client requests", value: String(i.requests.open), hint: i.requests.overdue > 0 ? `${i.requests.overdue} overdue` : null, href: p.requests },
  ];
  if (i.audit.enabled || i.confirmations.total > 0)
    tiles.push({ key: "confirmations", label: "Confirmations awaiting a reply", value: String(i.confirmations.awaitingReply), hint: i.confirmations.notSent > 0 ? `${i.confirmations.notSent} not sent yet` : null, href: p.confirmations });
  tiles.push({ key: "points", label: "Open review points", value: String(i.review.openPoints), hint: null, href: p.review });

  return {
    locked,
    empty,
    summary,
    nextStep: nextStepFor(i),
    stages: stagesFor(i),
    toDo,
    toDoTotal: locked ? 0 : blockers.length,
    tiles,
  };
}

/** For the to-do list heading: "See all 12" or nothing when everything is already shown. */
export const seeAllLabel = (total: number): string | null => (total > MAX_TODO ? `See all ${total}` : null);

