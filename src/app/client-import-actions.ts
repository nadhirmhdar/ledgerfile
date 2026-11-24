"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { readGrid } from "@/server/excel";
import { importClients, previewClientImport } from "@/server/client-import";
import { gridFromPastedNames, MAX_IMPORT_ROWS, type ImportEntry, type ImportPreview } from "@/domain/client-import";
import type { FormState } from "./actions";

export interface PreviewResult {
  ok: boolean;
  message: string;
  preview: ImportPreview | null;
}

const known = (e: unknown, fallback: string): string => (e instanceof Error && !("code" in e) ? e.message : fallback);

/** Read a file or pasted text and say what an import would do. Nothing is saved. */
export async function previewClientImportAction(form: FormData): Promise<PreviewResult> {
  const session = await getSession();
  const fail = (message: string): PreviewResult => ({ ok: false, message, preview: null });
  const file = form.get("file");
  const pasted = String(form.get("pasted") ?? "");
  let grid: unknown[][];
  if (file instanceof File && file.size > 0) {
    try {
      // A little over the row limit is read, so a longer file is refused and never silently cut short.
      grid = await readGrid(file.name, await file.arrayBuffer(), MAX_IMPORT_ROWS + 200);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "The file could not be read.");
    }
  } else if (pasted.trim() !== "") {
    if (pasted.length > 500_000) return fail("The pasted text is too long.");
    grid = gridFromPastedNames(pasted);
  } else {
    return fail("Paste a list of names, or choose a file.");
  }
  try {
    const preview = await withFirm(await getDb(), session.firmId, (tx) => previewClientImport(tx, session, grid));
    if (preview.refused) return { ok: false, message: preview.refused, preview: null };
    return { ok: true, message: "", preview };
  } catch (e) {
    return fail(known(e, "The list could not be read."));
  }
}

/** Add the previewed names. The server classifies them again against the clients as they are now. */
export async function importClientsAction(names: (string | ImportEntry)[]): Promise<FormState> {
  const session = await getSession();
  try {
    const result = await withFirm(await getDb(), session.firmId, (tx) => importClients(tx, session, names));
    revalidatePath("/");
    return { ok: true, message: result.added === 0 ? "No new clients were added: every name was already a client." : `Added ${result.added.toLocaleString("en-US")} ${result.added === 1 ? "client" : "clients"}.` };
  } catch (e) {
    return { ok: false, message: known(e, "The clients were not added.") };
  }
}
