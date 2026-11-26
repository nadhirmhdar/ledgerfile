import { getDb, withFirm } from "./db";
import { blobOps } from "./blob-file-store";
import { IMPORT_DIRECT_BYTES, type ImportPurpose } from "./config";
import { directUploadAvailable } from "./direct-upload";
import { IMPORT_NOT_FOUND, takeImportFile } from "./direct-import";
import type { Session } from "./repo";

/**
 * Where an import action's file comes from: the form itself (the ordinary upload), or, when the form carries an `uploadKey`, the direct upload it names.
 * Either way the action gets a File and the size limit to read it with, and the rest of the import is the same.
 */
export interface ImportFile {
  file: File;
  /** The limit for the reader; undefined means the ordinary upload limit. */
  maxBytes: number | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function importFileFrom(form: FormData, session: Session, purpose: ImportPurpose, engagementId: string, target: string | null = null): Promise<ImportFile | null> {
  const key = form.get("uploadKey");
  if (typeof key === "string" && key !== "") {
    if (!directUploadAvailable() || !UUID.test(engagementId)) throw new Error(IMPORT_NOT_FOUND);
    const file = await takeImportFile(await getDb(), session, blobOps(), key, { engagementId, purpose, target });
    return { file, maxBytes: IMPORT_DIRECT_BYTES };
  }
  const file = form.get("file");
  return file instanceof File && file.size > 0 ? { file, maxBytes: undefined } : null;
}

/** The engagement of a test schedule, for the schedule listing's direct upload. */
export async function engagementOfSchedule(session: Session, scheduleId: string): Promise<string | null> {
  if (!UUID.test(scheduleId)) return null;
  return withFirm(await getDb(), session.firmId, async (tx) => (await tx.query<{ id: string }>("select engagement_id as id from test_schedules where id = $1", [scheduleId])).rows[0]?.id ?? null);
}
