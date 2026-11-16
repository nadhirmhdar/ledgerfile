import { AREA_BY_CODE } from "./audit";
import { isIsoDate } from "./client-requests";

/**
 * External confirmations: what a third party was asked, what they said, and how any difference from the books was dealt with.
 * Dates are calendar dates (YYYY-MM-DD), so they compare as text. Amounts are minor units; the reply rules here are the same ones
 * the database checks, so a rule broken in the application is refused with a message and not with a constraint error.
 */

export type ConfirmationKind = "bank" | "receivable" | "payable" | "related_party" | "legal" | "other";
export const KINDS: { code: ConfirmationKind; label: string; defaultArea: string | null }[] = [
  { code: "bank", label: "Bank", defaultArea: "C6" },
  { code: "receivable", label: "Customer (receivable)", defaultArea: "C5" },
  { code: "payable", label: "Supplier (payable)", defaultArea: "C8" },
  { code: "related_party", label: "Related party", defaultArea: "C7" },
  { code: "legal", label: "Lawyer", defaultArea: "C10" },
  { code: "other", label: "Other", defaultArea: null },
];
export const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.code, k.label])) as Record<ConfirmationKind, string>;
export const isKind = (v: string): v is ConfirmationKind => KINDS.some((k) => k.code === v);

export type Reply = "agreed" | "differs" | "no_reply";
export const REPLY_LABEL: Record<Reply, string> = { agreed: "Agreed", differs: "Differs", no_reply: "No reply" };
export const isReply = (v: string): v is Reply => v === "agreed" || v === "differs" || v === "no_reply";

export const MAX_REMINDERS = 5;
export const MAX_PARTY = 200;
export const MAX_CONTACT = 500;
export const MAX_ACCOUNT_REF = 100;
export const MAX_REPLY_NOTE = 2000;
export const MAX_WORK = 4000;
const MAX_AMOUNT = 1e13;

/** The area a kind goes to unless the user chooses another. Null for "other": the user must choose. */
export const defaultAreaFor = (kind: ConfirmationKind): string | null => KINDS.find((k) => k.code === kind)?.defaultArea ?? null;

/** Pick the area: the one given, else the kind's default. It must be one of the audit areas. */
export function resolveArea(kind: ConfirmationKind, areaCode: string | null | undefined): string {
  const code = (areaCode ?? "").trim() || defaultAreaFor(kind);
  if (!code) throw new Error("Choose the audit area this confirmation belongs to.");
  if (!AREA_BY_CODE.has(code)) throw new Error("Choose one of the audit areas.");
  return code;
}

function text(value: string | null | undefined, max: number, what: string): string | null {
  const t = (value ?? "").trim();
  if (t.length > max) throw new Error(`${what} is too long.`);
  return t === "" ? null : t;
}
export const cleanParty = (v: string | null | undefined): string => {
  const t = text(v, MAX_PARTY, "The name");
  if (!t) throw new Error("Enter who the confirmation goes to.");
  return t;
};
export const cleanContact = (v: string | null | undefined) => text(v, MAX_CONTACT, "The contact");
export const cleanAccountRef = (v: string | null | undefined) => text(v, MAX_ACCOUNT_REF, "The account reference");
export const cleanReplyNote = (v: string | null | undefined) => text(v, MAX_REPLY_NOTE, "The note on the reply");
export const cleanWork = (v: string | null | undefined, what: string) => text(v, MAX_WORK, what);

export function checkAmount(minor: number, what: string): number {
  if (!Number.isSafeInteger(minor) || Math.abs(minor) > MAX_AMOUNT) throw new Error(`${what} is not a valid amount.`);
  return minor + 0;
}

function checkDate(value: string | null | undefined, what: string): string | null {
  const t = (value ?? "").trim();
  if (t === "") return null;
  if (!isIsoDate(t)) throw new Error(`${what} is not a valid date.`);
  return t;
}

/** Book less confirmed: positive when the books show more than the third party confirms. Null until a confirmed amount is recorded. */
export const differenceMinor = (bookMinor: number, confirmedMinor: number | null): number | null => (confirmedMinor === null ? null : bookMinor - confirmedMinor);

// --- Dates --------------------------------------------------------------------

/** The date a confirmation was sent: not in the future, and not after a reply or reminder already recorded. */
export function checkSent(input: string | null | undefined, today: string, existing: { repliedOn: string | null; reminders: string[] }): string {
  const date = checkDate(input, "The date sent") ?? today;
  if (date > today) throw new Error("The date sent cannot be in the future.");
  if (existing.repliedOn && existing.repliedOn < date) throw new Error(`The reply is dated ${existing.repliedOn}, before that. Correct the reply date first.`);
  const early = existing.reminders.find((r) => r < date);
  if (early) throw new Error(`A reminder is dated ${early}, before that. Remove it first.`);
  return date;
}

/** A reminder: after sending, not in the future, no more than five, and not on a day already recorded. */
export function checkReminder(input: string | null | undefined, today: string, sentOn: string | null, existing: string[]): string {
  if (!sentOn) throw new Error("Record when the confirmation was sent before adding a reminder.");
  const date = checkDate(input, "The reminder date") ?? today;
  if (date > today) throw new Error("A reminder cannot be dated in the future.");
  if (date < sentOn) throw new Error(`A reminder cannot be before the date sent (${sentOn}).`);
  if (existing.includes(date)) throw new Error("There is already a reminder on that date.");
  if (existing.length >= MAX_REMINDERS) throw new Error(`There can be at most ${MAX_REMINDERS} reminders.`);
  return date;
}

// --- The reply ----------------------------------------------------------------

export interface ReplyValues {
  reply: Reply;
  repliedOn: string | null;
  confirmedMinor: number | null;
}

/**
 * Check a reply against the books. Agreed takes the book balance as the confirmed amount and needs a date; differs needs a
 * confirmed amount that is not the book balance, and a date; no reply has neither.
 */
export function checkReply(
  input: { reply: string; repliedOn?: string | null; confirmedMinor?: number | null },
  ctx: { bookMinor: number; sentOn: string | null; today: string },
): ReplyValues {
  if (!isReply(input.reply)) throw new Error("Choose agreed, differs or no reply.");
  if (!ctx.sentOn) throw new Error("Record when the confirmation was sent before recording a reply.");
  if (input.reply === "no_reply") return { reply: "no_reply", repliedOn: null, confirmedMinor: null };

  const repliedOn = checkDate(input.repliedOn, "The reply date") ?? ctx.today;
  if (repliedOn > ctx.today) throw new Error("The reply date cannot be in the future.");
  if (repliedOn < ctx.sentOn) throw new Error(`The reply date cannot be before the date sent (${ctx.sentOn}).`);
  if (input.reply === "agreed") return { reply: "agreed", repliedOn, confirmedMinor: ctx.bookMinor };

  if (input.confirmedMinor === null || input.confirmedMinor === undefined) throw new Error("Enter the amount the reply confirms.");
  const confirmed = checkAmount(input.confirmedMinor, "The confirmed amount");
  if (confirmed === ctx.bookMinor) throw new Error("The confirmed amount equals the book balance. Record the reply as agreed.");
  return { reply: "differs", repliedOn, confirmedMinor: confirmed };
}

// --- State and lock readiness -------------------------------------------------

export type ConfirmationState = "not_sent" | "awaiting_reply" | "to_prepare" | "prepared" | "reviewed";
export const STATE_LABEL: Record<ConfirmationState, string> = {
  not_sent: "Not sent",
  awaiting_reply: "Awaiting reply",
  to_prepare: "To prepare",
  prepared: "Prepared",
  reviewed: "Reviewed",
};

export function confirmationState(c: { sentOn: string | null; reply: Reply | null; prepared: boolean; reviewed: boolean }): ConfirmationState {
  if (c.reviewed) return "reviewed";
  if (c.prepared) return "prepared";
  if (c.reply) return "to_prepare";
  return c.sentOn ? "awaiting_reply" : "not_sent";
}

/** What confirmations still hold up the lock. A reply of "no reply" with its alternative work counts as a reply here. */
export function confirmationBlockers(states: ConfirmationState[]): string[] {
  const n = (s: ConfirmationState) => states.filter((x) => x === s).length;
  const out: string[] = [];
  if (n("not_sent") > 0) out.push(`Audit: ${n("not_sent")} confirmation(s) have not been sent. Send them, or delete those that will not be sent.`);
  if (n("awaiting_reply") > 0) out.push(`Audit: ${n("awaiting_reply")} confirmation(s) are awaiting a reply.`);
  if (n("to_prepare") > 0) out.push(`Audit: ${n("to_prepare")} confirmation(s) have a reply but are not prepared.`);
  const unreviewed = states.filter((s) => s !== "reviewed").length;
  if (unreviewed > 0) out.push(`Audit: ${unreviewed} confirmation(s) have not been reviewed.`);
  return out;
}

/** What a confirmation needs before it can be prepared; null when it is ready. */
export function prepareBlocker(c: { sentOn: string | null; reply: Reply | null; reconciliation: string | null; alternativeProcedures: string | null }): string | null {
  if (!c.sentOn) return "Record when the confirmation was sent first.";
  if (!c.reply) return "Record the reply first.";
  if (c.reply === "differs" && !c.reconciliation?.trim()) return "Record how the difference was reconciled first.";
  if (c.reply === "no_reply" && !c.alternativeProcedures?.trim()) return "Record the alternative procedures performed first.";
  return null;
}

// --- Summary ------------------------------------------------------------------

export interface SummaryRow {
  count: number;
  notSent: number;
  awaitingReply: number;
  agreed: number;
  differs: number;
  noReply: number;
  prepared: number;
  reviewed: number;
  bookMinor: number;
  confirmedMinor: number;
  /** Book less confirmed over the confirmations that have a confirmed amount. */
  differenceMinor: number;
}
const empty = (): SummaryRow => ({ count: 0, notSent: 0, awaitingReply: 0, agreed: 0, differs: 0, noReply: 0, prepared: 0, reviewed: 0, bookMinor: 0, confirmedMinor: 0, differenceMinor: 0 });

export function summarise(rows: { areaCode: string; bookMinor: number; confirmedMinor: number | null; reply: Reply | null; state: ConfirmationState }[]): { overall: SummaryRow; byArea: Map<string, SummaryRow> } {
  const overall = empty();
  const byArea = new Map<string, SummaryRow>();
  for (const r of rows) {
    const a = byArea.get(r.areaCode) ?? empty();
    byArea.set(r.areaCode, a);
    for (const t of [a, overall]) {
      t.count++;
      t.bookMinor += r.bookMinor;
      if (r.confirmedMinor !== null) {
        t.confirmedMinor += r.confirmedMinor;
        t.differenceMinor += r.bookMinor - r.confirmedMinor;
      }
      if (r.state === "not_sent") t.notSent++;
      if (r.state === "awaiting_reply") t.awaitingReply++;
      if (r.reply === "agreed") t.agreed++;
      if (r.reply === "differs") t.differs++;
      if (r.reply === "no_reply") t.noReply++;
      if (r.state === "prepared") t.prepared++;
      if (r.state === "reviewed") t.reviewed++;
    }
  }
  return { overall, byArea };
}

/** Area codes in numeric order (C2 before C10). */
export const compareAreas = (a: string, b: string): number => (Number(a.replace(/\D/g, "")) || 0) - (Number(b.replace(/\D/g, "")) || 0) || a.localeCompare(b);
