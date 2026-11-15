"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm, type Tx } from "@/server/db";
import { getSession } from "@/server/session";
import type { Session } from "@/server/repo";
import * as requests from "@/server/client-requests";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** Run one request operation as the signed-in user. Messages thrown by the rules are written for users; database errors are not shown. */
async function run<R>(work: (tx: Tx, session: Session) => Promise<R>): Promise<{ ok: true; result: R } | { ok: false; message: string }> {
  const session = await getSession();
  try {
    return { ok: true, result: await withFirm(await getDb(), session.firmId, (tx) => work(tx, session)) };
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("client request action failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "Something went wrong. Please try again." };
  }
}

const refresh = (engagementId: string) => revalidatePath(`/engagements/${engagementId}`, "layout");

/** Run a change on one request and refresh the pages of the engagement it belongs to. */
async function onRequest(form: FormData, message: string, change: (tx: Tx, s: Session, id: string) => Promise<string>): Promise<FormState> {
  const id = field(form, "requestId");
  if (!UUID.test(id)) return { ok: false, message: "Request not found." };
  const r = await run((tx, s) => change(tx, s, id));
  if (!r.ok) return r;
  refresh(r.result);
  return { ok: true, message };
}

export async function addRequestAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  const r = await run((tx, s) => requests.addRequest(tx, s, engagementId, { description: field(form, "description"), areaCode: field(form, "areaCode"), dueOn: field(form, "dueOn") }));
  if (!r.ok) return r;
  refresh(engagementId);
  return { ok: true, message: "Request added." };
}

export async function editRequestAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onRequest(form, "Saved.", (tx, s, id) => requests.editRequest(tx, s, id, { description: field(form, "description"), areaCode: field(form, "areaCode"), dueOn: field(form, "dueOn"), note: field(form, "note"), requestedOn: field(form, "requestedOn") }));
}

export async function markReceivedAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onRequest(form, "Marked received.", (tx, s, id) => requests.markReceived(tx, s, id, field(form, "receivedOn")));
}

export async function markNotApplicableAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onRequest(form, "Marked not applicable.", (tx, s, id) => requests.markNotApplicable(tx, s, id, field(form, "note")));
}

export async function reopenRequestAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onRequest(form, "Reopened.", (tx, s, id) => requests.reopenRequest(tx, s, id));
}

export async function deleteRequestAction(_prev: FormState, form: FormData): Promise<FormState> {
  return onRequest(form, "Deleted.", (tx, s, id) => requests.deleteRequest(tx, s, id));
}

export async function linkFileAction(_prev: FormState, form: FormData): Promise<FormState> {
  const fileId = field(form, "fileId");
  if (!UUID.test(fileId)) return { ok: false, message: "Choose a file to link." };
  return onRequest(form, "File linked.", (tx, s, id) => requests.linkFile(tx, s, id, fileId));
}

export async function unlinkFileAction(_prev: FormState, form: FormData): Promise<FormState> {
  const fileId = field(form, "fileId");
  if (!UUID.test(fileId)) return { ok: false, message: "File not found." };
  return onRequest(form, "File unlinked.", (tx, s, id) => requests.unlinkFile(tx, s, id, fileId));
}

export async function addStandardRequestsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  const r = await run((tx, s) => requests.addStandardRequests(tx, s, engagementId));
  if (!r.ok) return r;
  refresh(engagementId);
  return { ok: true, message: `Added ${r.result.added} request(s); ${r.result.skipped} already on the list.` };
}

export async function bringForwardRequestsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  const r = await run((tx, s) => requests.bringForwardRequests(tx, s, engagementId));
  if (!r.ok) return r;
  refresh(engagementId);
  return { ok: true, message: `Brought forward ${r.result.created} request(s); ${r.result.skipped} already on the list or already brought forward.` };
}
