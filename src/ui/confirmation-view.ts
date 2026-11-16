import { prepareBlocker, REPLY_LABEL, type ConfirmationState, type Reply } from "../domain/confirmations";
import { formatAmount } from "../domain/money";
import { canReview, type Role } from "../domain/signoff";
import type { Tone } from "./status";
import { count } from "./text";

/**
 * How the confirmations page is read: which confirmations a filter and a search leave, the pills and the line of facts on each
 * row, the four-step tracker, and the one next action a person is offered. Pure; the server still enforces every rule.
 */

export interface ConfirmationLike {
  reference: string;
  partyName: string;
  accountRef: string | null;
  state: ConfirmationState;
  reply: Reply | null;
}

// --- Filters ---------------------------------------------------------------------------------------------------------------

export type ConfirmationShow = "" | "notsent" | "awaiting" | "toprepare" | "waiting" | "reviewed" | "differs" | "unreviewed";

const SHOWS: ConfirmationShow[] = ["notsent", "awaiting", "toprepare", "waiting", "reviewed", "differs", "unreviewed"];

/** The ?show= value. The older values (awaiting, differs, unreviewed) keep working; anything else means all. */
export function parseConfirmationShow(v: string | string[] | undefined): ConfirmationShow {
  const one = (Array.isArray(v) ? v[0] : v) ?? "";
  return (SHOWS as string[]).includes(one) ? (one as ConfirmationShow) : "";
}

export const parseConfirmationSearch = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? "").trim().slice(0, 100);

const matchesShow = (c: ConfirmationLike, show: ConfirmationShow): boolean => {
  switch (show) {
    case "notsent":
      return c.state === "not_sent";
    case "awaiting":
      return c.state === "awaiting_reply";
    case "toprepare":
      return c.state === "to_prepare";
    case "waiting":
      return c.state === "prepared";
    case "reviewed":
      return c.state === "reviewed";
    case "differs":
      return c.reply === "differs";
    case "unreviewed":
      return c.state !== "reviewed";
    default:
      return true;
  }
};

const matchesSearch = (c: ConfirmationLike, q: string) => {
  const t = q.trim().toLowerCase();
  return t === "" || c.partyName.toLowerCase().includes(t) || (c.accountRef ?? "").toLowerCase().includes(t) || c.reference.toLowerCase().includes(t);
};

export interface ShowCounts {
  all: number;
  notsent: number;
  awaiting: number;
  toprepare: number;
  waiting: number;
  reviewed: number;
  differs: number;
}

/** Counts for the chips, with the search applied, whichever chip is chosen. */
export function showCounts(rows: ConfirmationLike[], q = ""): ShowCounts {
  const c: ShowCounts = { all: 0, notsent: 0, awaiting: 0, toprepare: 0, waiting: 0, reviewed: 0, differs: 0 };
  for (const r of rows) {
    if (!matchesSearch(r, q)) continue;
    c.all++;
    if (r.state === "not_sent") c.notsent++;
    if (r.state === "awaiting_reply") c.awaiting++;
    if (r.state === "to_prepare") c.toprepare++;
    if (r.state === "prepared") c.waiting++;
    if (r.state === "reviewed") c.reviewed++;
    if (r.reply === "differs") c.differs++;
  }
  return c;
}

export function filterConfirmations<T extends ConfirmationLike>(rows: T[], opts: { show?: ConfirmationShow; q?: string } = {}): { rows: T[]; shown: number; total: number } {
  const kept = rows.filter((r) => matchesShow(r, opts.show ?? "") && matchesSearch(r, opts.q ?? ""));
  return { rows: kept, shown: kept.length, total: rows.length };
}

export const confirmationResults = (shown: number, total: number): string => `Showing ${shown} of ${count(total, "confirmation")}.`;

// --- Words ---------------------------------------------------------------------------------------------------------------

export interface SummaryCounts {
  count: number;
  notSent: number;
  awaitingReply: number;
  agreed: number;
  differs: number;
  noReply: number;
  prepared: number;
  reviewed: number;
}

/** "8 confirmations: 3 agreed, 1 differs, 1 no reply, 2 awaiting a reply, 1 not sent." */
export function confirmationsSentence(s: SummaryCounts): string {
  if (s.count === 0) return "No confirmations yet.";
  const parts = [s.agreed > 0 && `${s.agreed} agreed`, s.differs > 0 && `${s.differs} differs`, s.noReply > 0 && `${s.noReply} no reply`, s.awaitingReply > 0 && `${s.awaitingReply} awaiting a reply`, s.notSent > 0 && `${s.notSent} not sent`].filter(Boolean);
  return parts.length === 0 ? `${count(s.count, "confirmation")}.` : `${count(s.count, "confirmation")}: ${parts.join(", ")}.`;
}

/** The tiles: what is still to do at each step. A confirmation with a reply that is not yet prepared is "to prepare". */
export function summaryTiles(s: SummaryCounts): { notSent: number; awaiting: number; toPrepare: number; waitingForReview: number; reviewed: number } {
  return { notSent: s.notSent, awaiting: s.awaitingReply, toPrepare: s.agreed + s.differs + s.noReply - s.prepared - s.reviewed, waitingForReview: s.prepared, reviewed: s.reviewed };
}

// --- Pills and the line of facts --------------------------------------------------------------------------------------

export function statePill(c: { state: ConfirmationState; selfReviewed: boolean }): { tone: Tone; label: string } {
  switch (c.state) {
    case "not_sent":
      return { tone: "neutral", label: "Not sent" };
    case "awaiting_reply":
      return { tone: "info", label: "Awaiting reply" };
    case "to_prepare":
      return { tone: "warning", label: "To prepare" };
    case "prepared":
      return { tone: "warning", label: "Prepared, waiting for review" };
    case "reviewed":
      return c.selfReviewed ? { tone: "warning", label: "Self-reviewed" } : { tone: "success", label: "Reviewed" };
  }
}

/** A second pill for the kind of reply that needs attention. */
export function replyPill(reply: Reply | null): { tone: Tone; label: string } | null {
  if (reply === "differs") return { tone: "danger", label: "Differs" };
  if (reply === "no_reply") return { tone: "warning", label: "No reply" };
  return null;
}

/** The muted line under a row: the books, the reply's amounts, and the dates. */
export function confirmationLine(c: { bookMinor: number; confirmedMinor: number | null; differenceMinor: number | null; sentOn: string | null; reminders: string[]; reply: Reply | null; repliedOn: string | null }): string {
  const parts = [`Book ${formatAmount(c.bookMinor)}`];
  if (c.confirmedMinor !== null) parts.push(`confirmed ${formatAmount(c.confirmedMinor)}`);
  if (c.differenceMinor !== null && c.differenceMinor !== 0) parts.push(`difference ${formatAmount(c.differenceMinor)}`);
  parts.push(c.sentOn ? `sent ${c.sentOn}` : "not sent");
  if (c.reminders.length > 0) parts.push(count(c.reminders.length, "reminder"));
  if (c.reply) parts.push(`${REPLY_LABEL[c.reply].toLowerCase()}${c.repliedOn ? ` ${c.repliedOn}` : ""}`);
  return parts.join(", ");
}

// --- The four steps --------------------------------------------------------------------------------------------------

export interface TrackerStep {
  key: "sent" | "reply" | "prepared" | "reviewed";
  label: string;
  /** done, the next one to do, or not yet. */
  state: "done" | "current" | "todo";
  text: string;
}

export function stepTracker(c: { sentOn: string | null; reply: Reply | null; preparedByName: string | null; reviewedByName: string | null }): TrackerStep[] {
  const done = [!!c.sentOn, !!c.reply, !!c.preparedByName, !!c.reviewedByName];
  const first = done.indexOf(false);
  const label = ["Sent", "Reply", "Prepared", "Reviewed"] as const;
  const key = ["sent", "reply", "prepared", "reviewed"] as const;
  return label.map((l, i) => ({ key: key[i], label: l, state: done[i] ? "done" : i === first ? "current" : "todo", text: done[i] ? "Done" : i === first ? "Next" : "Not yet" }));
}

// --- The one next action ---------------------------------------------------------------------------------------------------

export type NextAction =
  | { kind: "mark_sent" }
  | { kind: "record_reply" }
  | { kind: "add_work"; reason: string }
  | { kind: "prepare" }
  | { kind: "review" }
  | { kind: "waiting_review" }
  | { kind: "none" };

/**
 * The single thing to offer inline on a row. Nothing on a locked engagement, with the audit off, or once reviewed. Reviewing is for
 * a reviewer or partner; a preparer sees that it is waiting. The page cannot know whether a reviewer also did the work, so a
 * reviewer is offered the button and the server refuses a self-review where the firm has another reviewer.
 */
export function nextAction(
  c: { state: ConfirmationState; sentOn: string | null; reply: Reply | null; reconciliation: string | null; alternativeProcedures: string | null },
  role: Role,
  locked: boolean,
  auditOn: boolean,
): NextAction {
  if (locked || !auditOn || c.state === "reviewed") return { kind: "none" };
  if (!c.sentOn) return { kind: "mark_sent" };
  if (!c.reply) return { kind: "record_reply" };
  if (c.state === "prepared") return canReview(role) ? { kind: "review" } : { kind: "waiting_review" };
  const reason = prepareBlocker({ sentOn: c.sentOn, reply: c.reply, reconciliation: c.reconciliation, alternativeProcedures: c.alternativeProcedures });
  return reason ? { kind: "add_work", reason } : { kind: "prepare" };
}
