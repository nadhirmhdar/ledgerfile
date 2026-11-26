import { randomUUID } from "node:crypto";
import { withFirm, type Db, type Tx } from "./db";
import { IMPORT_DIRECT_BYTES, IMPORT_DIRECT_LABEL, IMPORT_DIRECT_ROWS, PENDING_UPLOAD_MINUTES, type ImportPurpose } from "./config";
import { claimPending, loadPending, sweepExpired, type BlobOps, type ImportBlobOps, type PendingRow } from "./direct-upload";
import { FILE_KEY } from "./file-store";
import type { Session } from "./repo";
import { countRows } from "./row-count";

/**
 * Spreadsheet imports larger than a function request may carry, on a hosted site with a Blob store. The browser sends the file to a key the server issued
 * for ONE purpose on ONE engagement; the server then reads it, hands it to the same parser and import as an ordinary upload, and deletes it. An import
 * upload never becomes a working paper, and a working paper upload can never be read as an import. Unfinished ones expire and are swept like any other.
 */

export const IMPORT_NOT_FOUND = "This upload was not found. It may already have been used, or it may have expired. Choose the file again.";
const LOCKED = "This engagement is locked.";
const MAX_PENDING_PER_USER = 20;

export const tooManyRows = (limit: number) => `The file has more than ${limit.toLocaleString("en-US")} rows. Split it and import the parts, or remove blank or unused rows.`;

export interface ImportTarget {
  engagementId: string;
  purpose: ImportPurpose;
  /** The test schedule, for a schedule listing; otherwise null. */
  target: string | null;
}

/** The engagement must be this firm's and open, and the user active. The import itself applies its own rules again when it runs. */
async function mayImport(tx: Tx, s: Session, t: ImportTarget): Promise<void> {
  const who = await tx.query<{ active: boolean }>("select active from users where id = $1 and firm_id = $2", [s.userId, s.firmId]);
  if (!who.rows[0]?.active) throw new Error("Engagement not found.");
  const e = await tx.query<{ status: string }>("select status from engagements where id = $1 and firm_id = $2", [t.engagementId, s.firmId]);
  if (e.rows.length === 0) throw new Error("Engagement not found.");
  if (e.rows[0].status !== "open") throw new Error(LOCKED);
  if (t.purpose === "schedule_listing") {
    const sch = t.target ? await tx.query("select 1 from test_schedules where id::text = $1 and engagement_id::text = $2", [t.target, t.engagementId]) : { rows: [] };
    if (sch.rows.length === 0) throw new Error("Schedule not found.");
  }
}

const sizeProblem = (size: number): string | null => {
  if (!Number.isInteger(size) || size <= 0) return "The file is empty.";
  return size > IMPORT_DIRECT_BYTES ? `The file is larger than ${IMPORT_DIRECT_LABEL}.` : null;
};

async function removeQuietly(ops: BlobOps, keys: string[]) {
  for (const key of keys) {
    try {
      await ops.remove(key);
    } catch {
      console.error("direct import: a blob could not be removed");
    }
  }
}

/** Begin an import upload: check who, what and how big, sweep expired rows and record the one key the browser may write. */
export async function beginImportUpload(db: Db, s: Session, ops: BlobOps, input: ImportTarget & { fileName: string; sizeBytes: number }, now: Date = new Date()): Promise<{ key: string }> {
  const problem = sizeProblem(input.sizeBytes);
  if (problem) throw new Error(problem);
  const fileName = input.fileName.split(/[\\/]/).pop()?.trim().slice(0, 200) ?? "";
  if (!/\.(xlsx|csv)$/i.test(fileName)) throw new Error("Upload an Excel (.xlsx) or CSV (.csv) file.");
  const { key, swept } = await withFirm(db, s.firmId, async (tx) => {
    const swept = await sweepExpired(tx, now);
    await mayImport(tx, s, input);
    const open = await tx.query<{ n: number }>("select count(*)::int as n from pending_uploads where user_id = $1", [s.userId]);
    if (open.rows[0].n >= MAX_PENDING_PER_USER) throw new Error("Too many uploads are in progress. Wait a few minutes and try again.");
    const key = `${s.firmId}/${randomUUID()}`;
    await tx.query(
      `insert into pending_uploads (key, firm_id, engagement_id, user_id, target_kind, target, file_name, size_bytes, purpose, created_at, expires_at)
       values ($1, $2, $3, $4, 'engagement', $5, $6, $7, $8, $9::timestamptz, $10::timestamptz)`,
      [key, s.firmId, input.engagementId, s.userId, input.target, fileName, input.sizeBytes, input.purpose, now.toISOString(), new Date(now.getTime() + PENDING_UPLOAD_MINUTES * 60_000).toISOString()],
    );
    return { key, swept };
  });
  await removeQuietly(ops, swept);
  return { key };
}

const matches = (row: PendingRow, s: Session, t: ImportTarget) => row.userId === s.userId && row.purpose === t.purpose && row.engagementId === t.engagementId && (row.target ?? null) === t.target;

/**
 * Read an import upload as a file, once. The key must be this user's pending upload for exactly this purpose, engagement and target, unexpired, on an
 * open engagement. The row is taken (so it cannot be used twice), the object is read within the limit, compared with the declared size, checked for too many
 * rows before it is parsed, and DELETED whether or not it could be used.
 */
export async function takeImportFile(db: Db, s: Session, ops: ImportBlobOps, key: string, t: ImportTarget, now: Date = new Date()): Promise<File> {
  if (!FILE_KEY.test(key)) throw new Error(IMPORT_NOT_FOUND);
  const row = await withFirm(db, s.firmId, async (tx) => {
    const found = await loadPending(tx, s, key);
    // A key for anything else (a working paper, another engagement or purpose) is not taken, so it stays what it was.
    if (!found || !matches(found, s, t) || found.expiresAt.getTime() <= now.getTime()) throw new Error(IMPORT_NOT_FOUND);
    await mayImport(tx, s, t);
    const claimed = await claimPending(tx, s, key, now);
    if (!claimed) throw new Error(IMPORT_NOT_FOUND);
    return claimed;
  });
  try {
    const data = await ops.read(key, IMPORT_DIRECT_BYTES);
    if (!data) throw new Error("The file did not arrive. Try uploading it again.");
    const problem = sizeProblem(data.length);
    if (problem) throw new Error(problem);
    if (data.length !== row.sizeBytes) throw new Error("The file that arrived is not the size that was declared, so it was not used. Try uploading it again.");
    const limit = IMPORT_DIRECT_ROWS[t.purpose];
    if ((await countRows(row.fileName, data, limit)) > limit) throw new Error(tooManyRows(limit));
    return new File([data as BlobPart], row.fileName);
  } finally {
    await removeQuietly(ops, [key]);
  }
}
