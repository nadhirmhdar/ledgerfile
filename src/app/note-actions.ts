"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { restoreNoteText, saveNoteText, useGeneratedWording, type WriteResult } from "@/server/note-texts";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function run(form: FormData, work: (tx: Parameters<Parameters<typeof withFirm>[2]>[0], s: Awaited<ReturnType<typeof getSession>>, id: string, key: string) => Promise<WriteResult>): Promise<FormState> {
  const id = String(form.get("engagementId") ?? "");
  const key = String(form.get("noteKey") ?? "");
  if (!UUID.test(id)) return { ok: false, message: "Engagement not found." };
  const session = await getSession();
  try {
    const r = await withFirm(await getDb(), session.firmId, (tx) => work(tx, session, id, key));
    if (r.written) revalidatePath(`/engagements/${id}/statements`);
    return { ok: true, message: r.message };
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("note edit failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "The wording was not saved." };
  }
}

/** Save the paragraphs typed for a passage as its next version. Every rule is checked again on the server. */
export async function saveNoteAction(_prev: FormState, form: FormData): Promise<FormState> {
  const paragraphs = form.getAll("paragraph").map(String);
  return run(form, (tx, s, id, key) => saveNoteText(tx, s, id, key, paragraphs));
}

export async function restoreNoteAction(_prev: FormState, form: FormData): Promise<FormState> {
  const version = Number(form.get("version"));
  if (!Number.isInteger(version)) return { ok: false, message: "That version does not exist." };
  return run(form, (tx, s, id, key) => restoreNoteText(tx, s, id, key, version));
}

export async function generatedNoteAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, (tx, s, id, key) => useGeneratedWording(tx, s, id, key));
}
