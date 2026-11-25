"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { getFileStore } from "@/server/file-store";
import { approveDeletion, cancelDeletion, partnerLevel, removePendingFiles, requestDeletion, setRetentionYears } from "@/server/retention";
import { NOT_PARTNER } from "@/domain/retention";
import type { FormState } from "./actions";

const field = (form: FormData, name: string) => String(form.get(name) ?? "");
const num = (form: FormData, name: string) => Number(field(form, name));

async function run(work: () => Promise<string>, failure: string): Promise<FormState> {
  try {
    const message = await work();
    revalidatePath("/firm/retention");
    revalidatePath("/firm");
    return { ok: true, message };
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("retention action failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : failure };
  }
}

/** Set or clear the firm's retention period. Administrator only; the role is read again from the database. */
export async function setRetentionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  return run(async () => {
    const r = await setRetentionYears(await getDb(), session, field(form, "years"));
    return r.after === null ? "The retention period is cleared: no file is past it and nothing can be deleted." : `The retention period is ${r.after} ${r.after === 1 ? "year" : "years"}, counted from the day a file was archived.`;
  }, "The period was not saved.");
}

/** A partner-level person asks for an eligible archived file to be deleted. Nothing is deleted yet. */
export async function requestDeletionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  return run(async () => {
    await withFirm(await getDb(), session.firmId, (tx) => requestDeletion(tx, session, field(form, "engagementId"), field(form, "reason")));
    return "Deletion requested. A different partner has to approve it before anything is deleted.";
  }, "The request was not recorded.");
}

export async function cancelDeletionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  return run(async () => {
    await withFirm(await getDb(), session.firmId, (tx) => cancelDeletion(tx, session, num(form, "requestId")));
    return "The request is cancelled. Nothing was deleted.";
  }, "The request was not cancelled.");
}

/** A different partner-level person approves by typing the client's name. The file is deleted in one transaction; its files are removed after it commits. */
export async function approveDeletionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  return run(async () => {
    const db = await getDb();
    const out = await withFirm(db, session.firmId, (tx) => approveDeletion(tx, session, num(form, "requestId"), field(form, "typedName")));
    // After the commit. A failure here is listed on the page with a retry, never swallowed.
    const files = await removePendingFiles(db, session.firmId, getFileStore(), out.keys);
    return files.failed.length === 0
      ? `Deleted ${out.clientName}'s file.`
      : `Deleted ${out.clientName}'s file. ${files.failed.length === 1 ? "One file" : `${files.failed.length} files`} could not be removed from storage yet: they are listed below with a retry.`;
  }, "The file was not deleted.");
}

/** Try again to remove the files of deleted engagements that are still in storage. */
export async function retryFilesAction(): Promise<FormState> {
  const session = await getSession();
  return run(async () => {
    const db = await getDb();
    if (!(await withFirm(db, session.firmId, (tx) => partnerLevel(tx, session)))) throw new Error(NOT_PARTNER);
    const files = await removePendingFiles(db, session.firmId, getFileStore());
    if (files.failed.length > 0) throw new Error(`${files.failed.length === 1 ? "One file" : `${files.failed.length} files`} could not be removed again: ${files.failed[0].message}.`);
    return files.removed === 0 ? "No files are waiting to be removed." : `Removed ${files.removed} ${files.removed === 1 ? "file" : "files"}.`;
  }, "The files were not removed.");
}
