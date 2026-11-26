"use server";

import { getDb } from "@/server/db";
import { getSession } from "@/server/session";
import { blobOps } from "@/server/blob-file-store";
import { IMPORT_PURPOSES, type ImportPurpose } from "@/server/config";
import { beginImportUpload } from "@/server/direct-import";
import { directUploadAvailable } from "@/server/direct-upload";
import { engagementOfSchedule } from "@/server/import-source";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BeginImport {
  purpose: string;
  /** The engagement; for a schedule listing the schedule says which, so this is ignored. */
  engagementId?: string;
  scheduleId?: string;
  fileName: string;
  sizeBytes: number;
}

export type BeginImportResult = { ok: true; key: string } | { ok: false; message: string };

/** The server decides the one key the browser may write for an import, after checking who is asking and for what. */
export async function beginImportAction(input: BeginImport): Promise<BeginImportResult> {
  const session = await getSession();
  const fail = (message: string): BeginImportResult => ({ ok: false, message });
  if (!directUploadAvailable()) return fail("Large uploads are not available here.");
  if (!(IMPORT_PURPOSES as readonly string[]).includes(input.purpose)) return fail("This upload is not allowed.");
  const purpose = input.purpose as ImportPurpose;
  const scheduleId = purpose === "schedule_listing" ? String(input.scheduleId ?? "") : null;
  const engagementId = scheduleId !== null ? await engagementOfSchedule(session, scheduleId) : String(input.engagementId ?? "");
  if (!engagementId || !UUID.test(engagementId)) return fail("Engagement not found.");
  try {
    const { key } = await beginImportUpload(await getDb(), session, blobOps(), { engagementId, purpose, target: scheduleId, fileName: String(input.fileName), sizeBytes: Number(input.sizeBytes) });
    return { ok: true, key };
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("direct import failed:", e instanceof Error ? e.message : "unknown error");
    return fail(known ? e.message : "The upload could not be started.");
  }
}
