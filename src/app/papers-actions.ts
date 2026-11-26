"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { getFileStore } from "@/server/file-store";
import { uploadTooLargeMessage } from "@/server/config";
import * as papers from "@/server/working-papers";
import { beginDirectUpload, directUploadAvailable, finishDirectUpload } from "@/server/direct-upload";
import { blobOps } from "@/server/blob-file-store";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

function failure(e: unknown, fallback: string): FormState {
  // Messages thrown by the working paper rules are written for users. Other errors are not shown.
  const known = e instanceof Error && !("code" in e);
  if (!known) console.error("working paper action failed:", e instanceof Error ? e.message : "unknown error");
  return { ok: false, message: known ? e.message : fallback };
}

export async function uploadWorkingPaperAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a file to upload." };
  if (file.size > papers.MAX_FILE_BYTES) return { ok: false, message: uploadTooLargeMessage() };

  // The form names what the file supports as "engagement", "lead_sheet:CASH" or "procedure:<id>". A new version names the paper it replaces instead.
  const [targetKind, target] = field(form, "supports").split(":");
  const replacesId = field(form, "replacesId");
  if (replacesId && !UUID.test(replacesId)) return { ok: false, message: "Working paper not found." };
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    await withFirm(await getDb(), session.firmId, async (tx) => {
      if (replacesId) {
        const made = await papers.addWorkingPaperVersion(tx, session, getFileStore(), replacesId, { fileName: file.name, data, description: field(form, "description") });
        if (made.engagementId !== engagementId) throw new Error("Working paper not found.");
        return;
      }
      await papers.addWorkingPaper(tx, session, getFileStore(), engagementId, { targetKind, target: target || null, fileName: file.name, data, description: field(form, "description") });
    });
  } catch (e) {
    return failure(e, "The file was not uploaded.");
  }
  revalidatePath(`/engagements/${engagementId}`, "layout");
  return { ok: true, message: `Uploaded ${papers.cleanFileName(file.name)}.` };
}

export async function removeWorkingPaperAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  const id = field(form, "paperId");
  if (!UUID.test(id)) return { ok: false, message: "Working paper not found." };
  let engagementId: string;
  try {
    const removed = await withFirm(await getDb(), session.firmId, (tx) => papers.removeWorkingPaper(tx, session, id));
    engagementId = removed.engagementId;
    // The record is gone and committed; now the bytes can go too.
    await getFileStore().remove(removed.storageKey);
  } catch (e) {
    return failure(e, "The file was not removed.");
  }
  revalidatePath(`/engagements/${engagementId}`, "layout");
  return { ok: true, message: "" };
}

export async function fileWorkingPaperAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  const id = field(form, "paperId");
  if (!UUID.test(id)) return { ok: false, message: "Working paper not found." };
  let engagementId: string;
  try {
    engagementId = await withFirm(await getDb(), session.firmId, (tx) => papers.setFileFiling(tx, session, id, { reference: field(form, "reference"), sectionCode: field(form, "sectionCode") }));
  } catch (e) {
    return failure(e, "The reference was not saved.");
  }
  revalidatePath(`/engagements/${engagementId}`, "layout");
  return { ok: true, message: "Saved." };
}

// --- Direct upload to the private Blob store (hosted, FILE_STORE=vercel-blob) --------------------------------------------------

export type BeginUploadResult = { ok: true; key: string } | { ok: false; message: string };

/** Step 1: check the file's declared name, size and purpose, and get the one key the browser may write. */
export async function beginUploadAction(input: { engagementId: string; supports: string; fileName: string; sizeBytes: number; description: string; replacesId?: string }): Promise<BeginUploadResult> {
  const session = await getSession();
  if (!directUploadAvailable()) return { ok: false, message: "This deployment cannot take large uploads." };
  if (!UUID.test(String(input?.engagementId))) return { ok: false, message: "Engagement not found." };
  if (typeof input.fileName !== "string" || typeof input.supports !== "string" || typeof input.description !== "string") return { ok: false, message: "Choose a file to upload." };
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) return { ok: false, message: "Choose a file to upload." };
  const [targetKind, target] = input.supports.split(":");
  const replacesId = input.replacesId ? String(input.replacesId) : null;
  if (replacesId && !UUID.test(replacesId)) return { ok: false, message: "Working paper not found." };
  try {
    const begun = await beginDirectUpload(await getDb(), session, blobOps(), { engagementId: input.engagementId, targetKind, target: target || null, fileName: input.fileName, sizeBytes: input.sizeBytes, description: input.description, replacesId });
    return { ok: true, key: begun.key };
  } catch (e) {
    return { ok: false, message: failure(e, "The file was not uploaded.").message };
  }
}

/** Step 3: the server reads what arrived, checks it against the declaration and only then makes it a working paper. */
export async function finishUploadAction(key: string): Promise<FormState> {
  const session = await getSession();
  if (!directUploadAvailable()) return { ok: false, message: "This deployment cannot take large uploads." };
  try {
    const done = await finishDirectUpload(await getDb(), session, blobOps(), String(key));
    revalidatePath(`/engagements/${done.engagementId}`, "layout");
    return { ok: true, message: `Uploaded ${done.fileName}.` };
  } catch (e) {
    return failure(e, "The file was not uploaded.");
  }
}
