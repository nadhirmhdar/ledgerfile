"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm, type Tx } from "@/server/db";
import { getSession } from "@/server/session";
import type { Session } from "@/server/repo";
import * as conf from "@/server/confirmations";
import { parseAmount } from "@/domain/money";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** An amount typed on a form: blank is null, anything unreadable is an error message. */
function amountField(form: FormData, name: string, what: string): { ok: true; minor: number | null } | { ok: false; message: string } {
  const raw = field(form, name).trim();
  if (raw === "") return { ok: true, minor: null };
  const minor = parseAmount(raw);
  if (minor === null || Number.isNaN(minor)) return { ok: false, message: `${what} is not a valid amount.` };
  return { ok: true, minor };
}

/** Run one confirmation operation as the signed-in user. Messages thrown by the rules are written for users; database errors are not shown. */
async function run<R>(work: (tx: Tx, session: Session) => Promise<R>): Promise<{ ok: true; result: R } | { ok: false; message: string }> {
  const session = await getSession();
  try {
    return { ok: true, result: await withFirm(await getDb(), session.firmId, (tx) => work(tx, session)) };
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("confirmation action failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "Something went wrong. Please try again." };
  }
}

const refresh = (engagementId: string) => revalidatePath(`/engagements/${engagementId}`, "layout");

/** Run a change on one confirmation and refresh the pages of the engagement it belongs to. */
async function onConfirmation(form: FormData, message: string, change: (tx: Tx, s: Session, id: string) => Promise<string>): Promise<FormState> {
  const id = field(form, "confirmationId");
  if (!UUID.test(id)) return { ok: false, message: "Confirmation not found." };
  const r = await run((tx, s) => change(tx, s, id));
  if (!r.ok) return r;
  refresh(r.result);
  return { ok: true, message };
}

export async function addConfirmationAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  const book = amountField(form, "book", "The book balance");
  if (!book.ok) return book;
  const r = await run((tx, s) =>
    conf.addConfirmation(tx, s, engagementId, { kind: field(form, "kind"), areaCode: field(form, "areaCode"), partyName: field(form, "partyName"), contact: field(form, "contact"), accountRef: field(form, "accountRef"), bookMinor: book.minor ?? 0 }),
  );
  if (!r.ok) return r;
  refresh(engagementId);
  return { ok: true, message: "Confirmation added." };
}

export async function editConfirmationAction(_prev: FormState, form: FormData): Promise<FormState> {
  const book = amountField(form, "book", "The book balance");
  if (!book.ok) return book;
  return onConfirmation(form, "Saved.", (tx, s, id) =>
    conf.editConfirmation(tx, s, id, { kind: field(form, "kind"), areaCode: field(form, "areaCode"), partyName: field(form, "partyName"), contact: field(form, "contact"), accountRef: field(form, "accountRef"), bookMinor: book.minor ?? 0 }),
  );
}

export async function markSentAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onConfirmation(form, "Marked sent.", (tx, s, id) => conf.markSent(tx, s, id, field(form, "sentOn")));
}
export async function clearSentAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onConfirmation(form, "Sent date cleared.", (tx, s, id) => conf.clearSent(tx, s, id));
}
export async function addReminderAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onConfirmation(form, "Reminder added.", (tx, s, id) => conf.addReminder(tx, s, id, field(form, "on")));
}
export async function removeReminderAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onConfirmation(form, "Reminder removed.", (tx, s, id) => conf.removeReminder(tx, s, id, field(form, "on")));
}

export async function recordReplyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const confirmed = amountField(form, "confirmed", "The confirmed amount");
  if (!confirmed.ok) return confirmed;
  return onConfirmation(form, "Reply recorded.", (tx, s, id) =>
    conf.recordReply(tx, s, id, { reply: field(form, "reply"), repliedOn: field(form, "repliedOn"), confirmedMinor: confirmed.minor, replyNote: field(form, "replyNote") }),
  );
}
export async function clearReplyAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onConfirmation(form, "Reply cleared.", (tx, s, id) => conf.clearReply(tx, s, id));
}
export async function saveReconciliationAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onConfirmation(form, "Saved.", (tx, s, id) => conf.saveReconciliation(tx, s, id, field(form, "text")));
}
export async function saveAlternativeProceduresAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onConfirmation(form, "Saved.", (tx, s, id) => conf.saveAlternativeProcedures(tx, s, id, field(form, "text")));
}

export async function linkConfirmationFileAction(_prev: FormState, form: FormData): Promise<FormState> {
  const fileId = field(form, "fileId");
  if (!UUID.test(fileId)) return { ok: false, message: "Choose a file to link." };
  return onConfirmation(form, "File linked.", (tx, s, id) => conf.linkFile(tx, s, id, fileId));
}
export async function unlinkConfirmationFileAction(_prev: FormState, form: FormData): Promise<FormState> {
  const fileId = field(form, "fileId");
  if (!UUID.test(fileId)) return { ok: false, message: "File not found." };
  return onConfirmation(form, "File unlinked.", (tx, s, id) => conf.unlinkFile(tx, s, id, fileId));
}

export async function prepareConfirmationAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onConfirmation(form, "Marked prepared.", (tx, s, id) => conf.prepareConfirmation(tx, s, id));
}
export async function unprepareConfirmationAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onConfirmation(form, "Preparation withdrawn.", (tx, s, id) => conf.unprepareConfirmation(tx, s, id));
}
export async function reviewConfirmationAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onConfirmation(form, "Reviewed.", (tx, s, id) => conf.reviewConfirmation(tx, s, id));
}
export async function unreviewConfirmationAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onConfirmation(form, "Review withdrawn.", (tx, s, id) => conf.unreviewConfirmation(tx, s, id));
}
export async function deleteConfirmationAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onConfirmation(form, "Deleted.", (tx, s, id) => conf.deleteConfirmation(tx, s, id));
}

export async function bringForwardConfirmationsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  const r = await run((tx, s) => conf.bringForwardConfirmations(tx, s, engagementId));
  if (!r.ok) return r;
  refresh(engagementId);
  return { ok: true, message: `Brought forward ${r.result.created} confirmation(s); ${r.result.skipped} already on the engagement or already brought forward.` };
}
